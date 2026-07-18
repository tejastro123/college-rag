"""Document ingestion pipeline orchestrator."""
from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

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


async def append_pipeline_log(document_id: str, stage: str, message: str, level: str = "info"):
    from app.services.cache import cache_get, cache_set
    try:
        key = f"pipeline_logs:{document_id}"
        logs = await cache_get(key) or []
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "stage": stage,
            "message": message,
            "level": level
        }
        logs.append(entry)
        await cache_set(key, logs, ttl=604800)  # keep for 7 days
    except Exception as e:
        logger.warning("Failed to write pipeline log to cache", doc_id=document_id, error=str(e))


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

        await append_pipeline_log(document_id, "upload", f"Ingestion triggered for file {doc.original_filename} ({doc.file_type})", "info")

        # Mark as processing:parsing
        doc.status = "processing:parsing"
        await db.commit()

        # Clear old chunks from vector store and SQLite database to avoid duplication
        try:
            await append_pipeline_log(document_id, "upload", "Cleaning up previously indexed chunks and vector embeddings...", "info")
            vector_store = await get_vector_store()
            await vector_store.delete_document(document_id)
        except Exception as e:
            logger.warning("Failed to clear vector store before ingestion", error=str(e))
        
        await db.execute(delete(Chunk).where(Chunk.document_id == document_id))
        await db.commit()

        path = Path(file_path)
        logger.info("Starting ingestion", doc_id=document_id, filename=doc.original_filename)

        # Emit parsing started event
        try:
            from app.services.event_bus import emit_ingestion_event
            await emit_ingestion_event(doc.id, doc.original_filename, "processing:parsing", course_id=doc.course_id)
        except Exception:
            pass

        # ── 1. Parse ───────────────────────────────────────────
        await append_pipeline_log(document_id, "parse", "Initializing parser. Extracting text content, pages, and metadata structure...", "info")
        parsed = await asyncio.to_thread(parse_document, path)
        total_pages = len(parsed.pages)
        await append_pipeline_log(document_id, "parse", f"Parsed {total_pages} page(s). OCR processed: {parsed.metadata.get('ocr', False)}", "info")

        # Mark as processing:chunking
        doc.status = "processing:chunking"
        await db.commit()
        try:
            from app.services.event_bus import emit_ingestion_event
            await emit_ingestion_event(doc.id, doc.original_filename, "processing:chunking", course_id=doc.course_id)
        except Exception:
            pass

        # ── 2. Chunk ───────────────────────────────────────────
        await append_pipeline_log(document_id, "chunk", "Starting hierarchical layout-aware semantic chunking...", "info")
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
        chunks = await asyncio.to_thread(chunk_document, parsed.pages, doc_metadata=doc_metadata)
        await append_pipeline_log(document_id, "chunk", f"Successfully generated {len(chunks)} chunks from document text.", "info")

        if not chunks:
            doc.status = "failed"
            doc.error_message = "No content extracted from document"
            await db.commit()
            await append_pipeline_log(document_id, "failed", "Ingestion failed: No text content could be extracted.", "error")
            try:
                from app.services.event_bus import emit_ingestion_event
                await emit_ingestion_event(doc.id, doc.original_filename, "failed", error="No content extracted", course_id=doc.course_id)
            except Exception:
                pass
            return {"success": False, "error": "No content extracted"}

        # Mark as processing:embedding
        doc.status = "processing:embedding"
        await db.commit()
        try:
            from app.services.event_bus import emit_ingestion_event
            await emit_ingestion_event(doc.id, doc.original_filename, "processing:embedding", course_id=doc.course_id)
        except Exception:
            pass

        # ── 3. Save chunks to DB ───────────────────────────────
        await append_pipeline_log(document_id, "chunk", f"Writing {len(chunks)} chunk records to SQLite database...", "info")
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
        await append_pipeline_log(document_id, "embed", "Generating vector embeddings and indexing into ChromaDB...", "info")
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
        await append_pipeline_log(document_id, "embed", f"Vector index populated with {len(chunks)} embeddings.", "info")

        # Update vector_id on chunks
        for record, vid in zip(chunk_records, chunk_ids):
            record.vector_id = vid

        # Mark as processing:indexing
        doc.status = "processing:indexing"
        await db.commit()
        try:
            from app.services.event_bus import emit_ingestion_event
            await emit_ingestion_event(doc.id, doc.original_filename, "processing:indexing", course_id=doc.course_id)
        except Exception:
            pass

        # Rebuild BM25 index with new chunks
        await append_pipeline_log(document_id, "index", "Rebuilding BM25 lexical search index...", "info")
        try:
            from app.retrieval.bm25_index import rebuild_index_from_db
            await rebuild_index_from_db(db)
            await append_pipeline_log(document_id, "index", "BM25 lexical index successfully updated.", "info")
        except Exception as e:
            logger.warning("BM25 index rebuild failed", error=str(e))
            await append_pipeline_log(document_id, "index", f"BM25 lexical index rebuild failed: {str(e)}", "warning")

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
        await append_pipeline_log(document_id, "index", "Ingestion completed successfully. Document is ready for usage.", "success")

        # Emit success event
        try:
            from app.services.event_bus import emit_ingestion_event, check_and_emit_alerts
            await emit_ingestion_event(
                doc.id, doc.original_filename, "indexed",
                chunks=len(chunks), course_id=doc.course_id,
            )
        except Exception:
            pass

        return {"success": True, "chunks": len(chunks), "pages": total_pages}

    except Exception as e:
        logger.error("Ingestion failed", doc_id=document_id, error=str(e))
        await append_pipeline_log(document_id, "failed", f"Ingestion pipeline failed: {str(e)}", "error")
        if doc:
            doc.status = "failed"
            doc.error_message = str(e)
            await db.commit()
            # Emit failure event
            try:
                from app.services.event_bus import emit_ingestion_event
                await emit_ingestion_event(
                    doc.id, doc.original_filename, "failed",
                    error=str(e)[:200], course_id=doc.course_id,
                )
            except Exception:
                pass
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
            await vs.clear_all()
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
