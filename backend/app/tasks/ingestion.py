"""Async document ingestion via Celery."""
from __future__ import annotations

import traceback
from pathlib import Path

from app.tasks.worker import celery_app
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def ingest_document(self, document_id: int, file_path: str, original_filename: str) -> dict:
    """Process a document: extract text, chunk, embed, store in vector DB."""
    from app.services.storage import storage
    from app.ingestion.processor import process_file
    from app.ingestion.chunker import chunk_text
    from app.embeddings.vector_store import get_vector_store
    from app.db.database import AsyncSessionLocal
    from app.models.document import Document
    from sqlalchemy import select

    logger.info("Starting document ingestion", doc_id=document_id, file=original_filename)

    try:
        # Read raw content
        raw = storage.read(file_path)

        # Extract text
        ext = Path(original_filename).suffix.lower()
        text = process_file(raw, ext)
        if not text or not text.strip():
            raise ValueError("No extractable text found")

        # Chunk
        from app.ingestion.chunker import RecursiveCharacterChunker
        chunker = RecursiveCharacterChunker(
            chunk_size=settings.CHUNK_SIZE,
            chunk_overlap=settings.CHUNK_OVERLAP,
        )
        chunks = chunker.split_text(text)

        # Embed + store in vector DB
        vs = get_vector_store()
        metadata = {
            "document_id": document_id,
            "filename": original_filename,
            "source": "upload",
        }
        chunk_ids = vs.add_texts(chunks, metadatas=[{**metadata, "chunk_index": i} for i in range(len(chunks))])

        # Update DB status
        async def _update_status():
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(Document).where(Document.id == document_id))
                doc = result.scalar_one_or_none()
                if doc:
                    doc.status = "ready"
                    doc.chunk_count = len(chunks)
                    await session.commit()

        import asyncio
        asyncio.run(_update_status())

        logger.info("Ingestion complete", doc_id=document_id, chunks=len(chunks))
        return {"status": "success", "document_id": document_id, "chunks": len(chunks)}

    except Exception as exc:
        logger.error("Ingestion failed", doc_id=document_id, error=str(exc))

        async def _mark_failed():
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(Document).where(Document.id == document_id))
                doc = result.scalar_one_or_none()
                if doc:
                    doc.status = "failed"
                    await session.commit()

        import asyncio
        asyncio.run(_mark_failed())

        raise self.retry(exc=exc)
