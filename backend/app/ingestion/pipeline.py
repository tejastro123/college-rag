"""Document ingestion pipeline orchestrator."""
from __future__ import annotations

import hashlib
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.database import AsyncSessionLocal
from app.models.document import Document, Chunk
from app.ingestion.parser import parse_document
from app.ingestion.chunker import chunk_document
from app.embeddings.vector_store import get_vector_store

logger = get_logger(__name__)


def _compute_checksum(file_path: Path) -> str:
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            sha.update(block)
    return sha.hexdigest()


async def ingest_document(
    document_id: str,
    file_path: str,
    db: Optional[AsyncSession] = None,
) -> dict:
    """
    Full ingestion pipeline:
    1. Parse document (text + structure extraction)
    2. Semantic chunking
    3. Embedding generation
    4. Vector store indexing
    5. Update DB record
    """
    close_db = db is None
    if close_db:
        db = AsyncSessionLocal()

    try:
        # Load document record
        result = await db.execute(select(Document).where(Document.id == document_id))
        doc = result.scalar_one_or_none()
        if not doc:
            raise ValueError(f"Document {document_id} not found")

        # Mark as processing
        doc.status = "processing"
        await db.commit()

        path = Path(file_path)
        logger.info("Starting ingestion", doc_id=document_id, filename=doc.original_filename)

        # ── 1. Parse ───────────────────────────────────────────
        parsed = parse_document(path)
        total_pages = len(parsed.pages)

        # ── 2. Chunk ───────────────────────────────────────────
        doc_metadata = {
            "document_id": document_id,
            "filename": doc.original_filename,
            "course_id": doc.course_id,
            "subject": doc.subject,
            "semester": doc.semester,
            "unit": doc.unit,
            "doc_type": doc.doc_type,
            "author": doc.author or parsed.metadata.get("author", ""),
        }
        chunks = chunk_document(parsed.pages, doc_metadata=doc_metadata)

        if not chunks:
            doc.status = "failed"
            doc.error_message = "No content extracted from document"
            await db.commit()
            return {"success": False, "error": "No content extracted"}

        # ── 3. Save chunks to DB ───────────────────────────────
        chunk_records = []
        for chunk in chunks:
            record = Chunk(
                id=str(uuid.uuid4()),
                document_id=document_id,
                content=chunk.content,
                chunk_index=chunk.chunk_index,
                chunk_type=chunk.chunk_type,
                page_number=chunk.page_number,
                section=chunk.section,
                heading=chunk.heading,
                token_count=chunk.token_count,
                char_count=chunk.char_count,
                meta={**doc_metadata, **chunk.metadata},
            )
            db.add(record)
            chunk_records.append(record)

        await db.flush()

        # ── 4. Embed & index ───────────────────────────────────
        vector_store = await get_vector_store()
        chunk_texts = [c.content for c in chunks]
        chunk_ids = [r.id for r in chunk_records]
        chunk_metas = []
        for chunk, record in zip(chunks, chunk_records):
            chunk_metas.append({
                "document_id": document_id,
                "chunk_id": record.id,
                "filename": doc.original_filename,
                "chunk_type": chunk.chunk_type,
                "page_number": chunk.page_number or 0,
                "section": chunk.section or "",
                "heading": chunk.heading or "",
                "course_id": doc.course_id or "",
                "subject": doc.subject or "",
                "semester": doc.semester or "",
                "unit": doc.unit or "",
                "doc_type": doc.doc_type or "",
            })

        await vector_store.add_documents(chunk_texts, chunk_ids, chunk_metas)

        # Update vector_id on chunks
        for record, vid in zip(chunk_records, chunk_ids):
            record.vector_id = vid

        # Rebuild BM25 index with new chunks
        try:
            from app.retrieval.bm25_index import rebuild_index_from_db
            await rebuild_index_from_db(db)
        except Exception as e:
            logger.warning("BM25 index rebuild failed", error=str(e))

        # Invalidate semantic cache for this course
        try:
            from app.services.semantic_cache import invalidate_course_cache
            await invalidate_course_cache(doc.course_id)
        except Exception as e:
            logger.warning("Cache invalidation failed", error=str(e))

        # ── 5. Finalise document ───────────────────────────────
        doc.status = "indexed"
        doc.total_pages = total_pages
        doc.total_chunks = len(chunks)
        doc.indexed_at = datetime.utcnow()
        doc.is_ocr_processed = parsed.metadata.get("ocr", False)
        if parsed.metadata.get("title"):
            doc.title = doc.title or parsed.metadata["title"]
        if parsed.metadata.get("author"):
            doc.author = doc.author or parsed.metadata["author"]

        await db.commit()
        logger.info("Ingestion complete", doc_id=document_id, chunks=len(chunks))
        return {"success": True, "chunks": len(chunks), "pages": total_pages}

    except Exception as e:
        logger.error("Ingestion failed", doc_id=document_id, error=str(e))
        if doc:
            doc.status = "failed"
            doc.error_message = str(e)
            await db.commit()
        raise
    finally:
        if close_db:
            await db.close()


async def reindex_all_documents(db: Optional[AsyncSession] = None) -> dict:
    """Re-chunk and re-embed all documents from scratch."""
    close_db = db is None
    if close_db:
        db = AsyncSessionLocal()

    try:
        # Load all indexed documents
        result = await db.execute(
            select(Document).where(Document.status.in_(["indexed", "failed"]))
        )
        docs = result.scalars().all()
        logger.info("Reindexing all documents", count=len(docs))

        # Clear existing chunks and vector store
        for doc in docs:
            await db.execute(
                select(Chunk).where(Chunk.document_id == doc.id)
            )
            existing = (await db.execute(
                select(Chunk).where(Chunk.document_id == doc.id)
            )).scalars().all()
            for c in existing:
                await db.delete(c)
            doc.status = "pending"

        await db.commit()

        # Clear vector store entirely
        try:
            from app.embeddings.vector_store import get_vector_store
            vs = await get_vector_store()
            # Delete all vectors by getting all IDs first
            all_ids = vs._collection.get()["ids"]
            if all_ids:
                vs._collection.delete(ids=all_ids)
            logger.info("Vector store cleared", deleted=len(all_ids))
        except Exception as e:
            logger.warning("Vector store clear failed", error=str(e))

        # Clear BM25 index
        try:
            import shutil
            bm25_dir = Path(settings.BM25_INDEX_DIR)
            if bm25_dir.exists():
                shutil.rmtree(bm25_dir)
                bm25_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning("BM25 index clear failed", error=str(e))

        # Re-ingest each document
        results = []
        for doc in docs:
            file_path = os.path.abspath(doc.file_path) if os.path.isabs(doc.file_path) else os.path.join(os.getcwd(), doc.file_path)
            if not os.path.exists(file_path):
                logger.warning("File not found, skipping", doc_id=doc.id, path=file_path)
                doc.status = "failed"
                doc.error_message = "File not found"
                await db.commit()
                results.append({"document_id": doc.id, "success": False, "error": "File not found"})
                continue
            try:
                r = await ingest_document(doc.id, file_path, db=db)
                results.append({"document_id": doc.id, **r})
            except Exception as e:
                logger.error("Re-ingest failed", doc_id=doc.id, error=str(e))
                results.append({"document_id": doc.id, "success": False, "error": str(e)})

        return {"success": True, "total": len(docs), "results": results}

    except Exception as e:
        logger.error("Reindex all failed", error=str(e))
        return {"success": False, "error": str(e)}
    finally:
        if close_db:
            await db.close()
