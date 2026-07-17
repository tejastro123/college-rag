"""Document upload, ingestion, and management endpoints."""
from __future__ import annotations

import hashlib
import os
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.core.config import settings
from app.core.logging import get_logger
from app.db.database import get_db
from app.models.document import Document, Chunk
from app.models.user import User
from app.auth.security import get_current_user
from app.ingestion.pipeline import ingest_document
from app.embeddings.vector_store import get_vector_store

logger = get_logger(__name__)
router = APIRouter(prefix="/documents", tags=["Documents"])

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".tiff"}


def _get_upload_path(user_id: str) -> Path:
    path = Path(settings.UPLOAD_DIR) / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


class DocumentResponse(BaseModel):
    id: str
    filename: str
    original_filename: str
    file_type: str
    file_size: int
    status: str
    title: str | None
    author: str | None
    subject: str | None
    semester: str | None
    unit: str | None
    doc_type: str | None
    total_pages: int
    total_chunks: int
    course_id: str | None
    created_at: str

    class Config:
        from_attributes = True


@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    course_id: Optional[str] = Form(None),
    subject: Optional[str] = Form(None),
    semester: Optional[str] = Form(None),
    unit: Optional[str] = Form(None),
    doc_type: Optional[str] = Form("notes"),
    title: Optional[str] = Form(None),
    author: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a document and trigger background ingestion."""
    # Validate extension
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    # Check size
    content = await file.read()
    if len(content) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")

    # Compute checksum for dedup
    checksum = hashlib.sha256(content).hexdigest()

    # Check duplicate
    existing = await db.execute(
        select(Document).where(
            (Document.checksum == checksum) &
            (Document.owner_id == current_user.id)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="This document has already been uploaded")

    # Save file
    safe_filename = f"{uuid.uuid4()}{ext}"
    upload_path = _get_upload_path(current_user.id)
    file_path = upload_path / safe_filename
    file_path.write_bytes(content)

    # Create DB record
    doc = Document(
        owner_id=current_user.id,
        course_id=course_id,
        filename=safe_filename,
        original_filename=file.filename,
        file_path=str(file_path),
        file_type=ext.lstrip("."),
        file_size=len(content),
        mime_type=file.content_type,
        checksum=checksum,
        title=title,
        author=author,
        subject=subject,
        semester=semester,
        unit=unit,
        doc_type=doc_type,
        status="pending",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # Trigger background ingestion
    background_tasks.add_task(ingest_document, doc.id, str(file_path))

    logger.info("Document uploaded", doc_id=doc.id, filename=file.filename)
    return {
        "message": "Document uploaded successfully. Ingestion started.",
        "document_id": doc.id,
        "status": "pending",
    }


@router.get("/", response_model=list[DocumentResponse])
async def list_documents(
    course_id: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Document).where(Document.owner_id == current_user.id)
    if course_id:
        query = query.where(Document.course_id == course_id)
    if status:
        query = query.where(Document.status == status)
    query = query.order_by(Document.created_at.desc())
    result = await db.execute(query)
    docs = result.scalars().all()
    return [
        DocumentResponse(
            id=d.id, filename=d.filename, original_filename=d.original_filename,
            file_type=d.file_type, file_size=d.file_size, status=d.status,
            title=d.title, author=d.author, subject=d.subject, semester=d.semester,
            unit=d.unit, doc_type=d.doc_type, total_pages=d.total_pages,
            total_chunks=d.total_chunks, course_id=d.course_id,
            created_at=str(d.created_at),
        )
        for d in docs
    ]


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Document).where((Document.id == doc_id) & (Document.owner_id == current_user.id))
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentResponse(
        id=doc.id, filename=doc.filename, original_filename=doc.original_filename,
        file_type=doc.file_type, file_size=doc.file_size, status=doc.status,
        title=doc.title, author=doc.author, subject=doc.subject, semester=doc.semester,
        unit=doc.unit, doc_type=doc.doc_type, total_pages=doc.total_pages,
        total_chunks=doc.total_chunks, course_id=doc.course_id,
        created_at=str(doc.created_at),
    )


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Document).where((Document.id == doc_id) & (Document.owner_id == current_user.id))
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove from vector store
    try:
        vector_store = await get_vector_store()
        await vector_store.delete_document(doc_id)
    except Exception as e:
        logger.error("Failed to delete from vector store", error=str(e))

    # Remove file
    try:
        Path(doc.file_path).unlink(missing_ok=True)
    except Exception:
        pass

    await db.execute(delete(Chunk).where(Chunk.document_id == doc_id))
    await db.delete(doc)
    await db.commit()


@router.post("/{doc_id}/reprocess", status_code=202)
async def reprocess_document(
    doc_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retry ingestion for a failed document."""
    result = await db.execute(
        select(Document).where((Document.id == doc_id) & (Document.owner_id == current_user.id))
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    doc.status = "pending"
    doc.error_message = None
    await db.commit()
    background_tasks.add_task(ingest_document, doc.id, doc.file_path)
    return {"message": "Reprocessing started", "document_id": doc_id}
