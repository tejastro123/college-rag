from __future__ import annotations

import os
import shutil
import sqlite3
import uuid
import json
import zipfile
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.core.config import settings
from app.core.logging import get_logger
from app.db.database import get_db, AsyncSessionLocal
from app.auth.security import get_current_user
from app.models.user import User
from app.models.document import Document, Chunk
from app.models.conversation import Conversation, Message
from app.models.lifecycle import DataRetentionPolicy, BackupHistory, GDPRRequest
from app.embeddings.vector_store import get_vector_store

logger = get_logger(__name__)
router = APIRouter(prefix="/admin/lifecycle", tags=["Admin Data Lifecycle"])

BACKUP_DIR = Path("backups")
GDPR_DIR = Path("gdpr_exports")

BACKUP_DIR.mkdir(exist_ok=True)
GDPR_DIR.mkdir(exist_ok=True)


# ── Dependency Check ─────────────────────────────────────
async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Pydantic Schemas ─────────────────────────────────────
class RetentionPolicyCreate(BaseModel):
    organization_id: Optional[str] = None
    policy_type: str = "document_age"  # document_age | audit_log_age
    retention_days: int = 30
    action: str = "archive"  # archive | delete
    is_active: bool = True

class RetentionPolicyResponse(BaseModel):
    id: str
    organization_id: Optional[str]
    policy_type: str
    retention_days: int
    action: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class BackupResponse(BaseModel):
    id: str
    filename: str
    file_path: str
    file_size: int
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class GDPRRequestCreate(BaseModel):
    user_email: str
    request_type: str  # export | delete

class GDPRRequestResponse(BaseModel):
    id: str
    user_id: str
    request_type: str
    status: str
    download_url: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    model_config = ConfigDict(from_attributes=True)


# ── Retention Policy Endpoints ───────────────────────────
@router.get("/retention", response_model=List[RetentionPolicyResponse])
async def list_retention_policies(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(DataRetentionPolicy))
    return result.scalars().all()


@router.post("/retention", response_model=RetentionPolicyResponse)
async def create_or_update_retention_policy(
    payload: RetentionPolicyCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    # Check if policy already exists for the organization / policy_type
    query = select(DataRetentionPolicy).where(
        DataRetentionPolicy.organization_id == payload.organization_id,
        DataRetentionPolicy.policy_type == payload.policy_type
    )
    result = await db.execute(query)
    policy = result.scalar_one_or_none()

    if policy:
        policy.retention_days = payload.retention_days
        policy.action = payload.action
        policy.is_active = payload.is_active
        policy.updated_at = datetime.now(timezone.utc)
    else:
        policy = DataRetentionPolicy(
            organization_id=payload.organization_id,
            policy_type=payload.policy_type,
            retention_days=payload.retention_days,
            action=payload.action,
            is_active=payload.is_active
        )
        db.add(policy)

    await db.commit()
    await db.refresh(policy)
    return policy


@router.delete("/retention/{policy_id}")
async def delete_retention_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(DataRetentionPolicy).where(DataRetentionPolicy.id == policy_id))
    policy = result.scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    await db.delete(policy)
    await db.commit()
    return {"status": "deleted"}


# Helper for background cleanup task
async def run_cleanup_job_task():
    logger.info("Starting retention policy cleanup task")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(DataRetentionPolicy).where(DataRetentionPolicy.is_active == True))
        policies = result.scalars().all()
        vector_store = await get_vector_store()

        for policy in policies:
            threshold = datetime.now(timezone.utc) - timedelta(days=policy.retention_days)
            if policy.policy_type == "document_age":
                # Find expired documents
                query = select(Document).where(
                    Document.created_at < threshold,
                    Document.status != "archived",
                    Document.status != "deleted"
                )
                if policy.organization_id:
                    # Filter by organization's courses
                    from app.models.course import Course
                    query = query.join(Course).where(Course.organization_id == policy.organization_id)

                doc_res = await db.execute(query)
                expired_docs = doc_res.scalars().all()

                for doc in expired_docs:
                    if policy.action == "archive":
                        logger.info(f"Archiving document {doc.id} due to retention policy")
                        # Delete vectors from vector store
                        await vector_store.delete_document(doc.id)
                        doc.status = "archived"
                    elif policy.action == "delete":
                        logger.info(f"Deleting document {doc.id} due to retention policy")
                        await vector_store.delete_document(doc.id)
                        # Delete file from storage
                        if os.path.exists(doc.file_path):
                            try:
                                os.remove(doc.file_path)
                            except Exception as e:
                                logger.error(f"Failed to delete file {doc.file_path}", error=str(e))
                        await db.delete(doc)

            elif policy.policy_type == "audit_log_age":
                from app.models.audit import AuditLog
                logger.info(f"Purging audit logs older than {policy.retention_days} days")
                await db.execute(delete(AuditLog).where(AuditLog.created_at < threshold))

        await db.commit()
    logger.info("Retention policy cleanup task completed")


@router.post("/retention/cleanup/trigger")
async def trigger_retention_cleanup(
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_admin)
):
    background_tasks.add_task(run_cleanup_job_task)
    return {"status": "cleanup_triggered"}


# ── Backup & Restore Endpoints ───────────────────────────
@router.get("/backups", response_model=List[BackupResponse])
async def list_backups(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(BackupHistory).order_by(BackupHistory.created_at.desc()))
    return result.scalars().all()


def sqlite_backup_worker(dest_path: str):
    # Safely backup the live SQLite database
    db_path = settings.DATABASE_URL.replace("sqlite+aiosqlite:///", "").replace("sqlite:///", "")
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(dest_path)
    with dst:
        src.backup(dst)
    dst.close()
    src.close()


@router.post("/backups", response_model=BackupResponse)
async def trigger_database_backup(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{timestamp}.db"
    dest_path = BACKUP_DIR / filename

    try:
        # SQLite check
        if settings.DATABASE_URL.startswith("sqlite"):
            await asyncio.to_thread(sqlite_backup_worker, str(dest_path))
        else:
            # Simple mock copy for non-sqlite
            shutil.copy(settings.DATABASE_URL, str(dest_path))

        file_size = os.path.getsize(dest_path)
        backup = BackupHistory(
            filename=filename,
            file_path=str(dest_path),
            file_size=file_size,
            status="completed"
        )
        db.add(backup)
        await db.commit()
        await db.refresh(backup)
        return backup
    except Exception as exc:
        logger.error("Database backup failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(exc)}")


@router.post("/backups/{backup_id}/restore")
async def restore_database_backup(
    backup_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(BackupHistory).where(BackupHistory.id == backup_id))
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")

    if not os.path.exists(backup.file_path):
        raise HTTPException(status_code=404, detail="Backup file missing on disk")

    try:
        if settings.DATABASE_URL.startswith("sqlite"):
            # Restore from the backup file safely
            db_path = settings.DATABASE_URL.replace("sqlite+aiosqlite:///", "").replace("sqlite:///", "")
            
            # Close existing session/connection engine pools if needed, sqlite connection backup does this in-thread
            def sqlite_restore_worker():
                src = sqlite3.connect(backup.file_path)
                dst = sqlite3.connect(db_path)
                with dst:
                    src.backup(dst)
                dst.close()
                src.close()

            await asyncio.to_thread(sqlite_restore_worker)
        else:
            shutil.copy(backup.file_path, settings.DATABASE_URL)

        return {"status": "restored", "filename": backup.filename}
    except Exception as exc:
        logger.error("Database restore failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Restore failed: {str(exc)}")


# ── GDPR / Export Endpoints ──────────────────────────────
@router.get("/gdpr", response_model=List[GDPRRequestResponse])
async def list_gdpr_requests(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(GDPRRequest).order_by(GDPRRequest.created_at.desc()))
    return result.scalars().all()


async def run_gdpr_export_task(request_id: str, user_id: str):
    logger.info(f"Starting GDPR Export for user {user_id}")
    async with AsyncSessionLocal() as db:
        # Fetch user
        u_res = await db.execute(select(User).where(User.id == user_id))
        user = u_res.scalar_one_or_none()
        if not user:
            return

        # Fetch messages
        m_res = await db.execute(select(Message).join(Conversation).where(Conversation.user_id == user_id))
        messages = m_res.scalars().all()

        # Fetch documents
        d_res = await db.execute(select(Document).where(Document.owner_id == user_id))
        documents = d_res.scalars().all()

        export_data = {
            "profile": {
                "id": user.id,
                "email": user.email,
                "username": user.username,
                "full_name": user.full_name,
                "role": user.role,
                "created_at": user.created_at.isoformat() if user.created_at else None
            },
            "conversations": [
                {
                    "message": msg.content,
                    "role": msg.role,
                    "created_at": msg.created_at.isoformat() if msg.created_at else None
                } for msg in messages
            ],
            "documents": [
                {
                    "id": doc.id,
                    "filename": doc.filename,
                    "original_filename": doc.original_filename,
                    "file_type": doc.file_type,
                    "file_size": doc.file_size,
                    "created_at": doc.created_at.isoformat() if doc.created_at else None
                } for doc in documents
            ]
        }

        # Save to disk as ZIP containing JSON and raw document files
        zip_filename = f"gdpr_export_{user_id}_{int(datetime.now().timestamp())}.zip"
        zip_path = GDPR_DIR / zip_filename

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Write JSON data
            zip_file.writestr("data_export.json", json.dumps(export_data, indent=2))
            # Write original files if they exist
            for doc in documents:
                if os.path.exists(doc.file_path):
                    zip_file.write(doc.file_path, arcname=f"documents/{doc.original_filename}")

        # Update GDPRRequest
        req_res = await db.execute(select(GDPRRequest).where(GDPRRequest.id == request_id))
        gdpr_req = req_res.scalar_one()
        gdpr_req.status = "completed"
        gdpr_req.download_url = f"/api/v1/admin/lifecycle/gdpr/{request_id}/download"
        gdpr_req.completed_at = datetime.now(timezone.utc)
        await db.commit()

    logger.info(f"GDPR Export for user {user_id} completed successfully")


async def run_gdpr_delete_task(request_id: str, user_id: str):
    logger.info(f"Starting GDPR Delete for user {user_id}")
    async with AsyncSessionLocal() as db:
        vector_store = await get_vector_store()
        
        # 1. Delete documents, chunks, vectors, and files on disk
        d_res = await db.execute(select(Document).where(Document.owner_id == user_id))
        documents = d_res.scalars().all()
        for doc in documents:
            await vector_store.delete_document(doc.id)
            if os.path.exists(doc.file_path):
                try:
                    os.remove(doc.file_path)
                except Exception:
                    pass
            await db.delete(doc)

        # 2. Delete conversations/messages
        c_res = await db.execute(select(Conversation).where(Conversation.user_id == user_id))
        conversations = c_res.scalars().all()
        for conv in conversations:
            await db.delete(conv)

        # 3. Anonymize user instead of hard drop to keep audit trail intact
        u_res = await db.execute(select(User).where(User.id == user_id))
        user = u_res.scalar_one_or_none()
        if user:
            user.email = f"anonymized_{uuid.uuid4().hex[:8]}@collegerag.com"
            user.username = f"deleted_user_{uuid.uuid4().hex[:8]}"
            user.full_name = "Anonymized User"
            user.hashed_password = "DELETED"
            user.is_active = False

        # Update GDPRRequest
        req_res = await db.execute(select(GDPRRequest).where(GDPRRequest.id == request_id))
        gdpr_req = req_res.scalar_one()
        gdpr_req.status = "completed"
        gdpr_req.completed_at = datetime.now(timezone.utc)
        await db.commit()

    logger.info(f"GDPR Delete for user {user_id} completed successfully")


@router.post("/gdpr", response_model=GDPRRequestResponse)
async def submit_gdpr_request(
    payload: GDPRRequestCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    # Find user by email
    result = await db.execute(select(User).where(User.email == payload.user_email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    gdpr_req = GDPRRequest(
        user_id=user.id,
        request_type=payload.request_type,
        status="processing"
    )
    db.add(gdpr_req)
    await db.commit()
    await db.refresh(gdpr_req)

    # Queue background task
    if payload.request_type == "export":
        background_tasks.add_task(run_gdpr_export_task, gdpr_req.id, user.id)
    elif payload.request_type == "delete":
        background_tasks.add_task(run_gdpr_delete_task, gdpr_req.id, user.id)

    return gdpr_req


@router.get("/gdpr/{request_id}/download")
async def download_gdpr_export(
    request_id: str,
    db: AsyncSession = Depends(get_db)
):
    # Keep download endpoint accessible but secure: check if request is completed
    result = await db.execute(select(GDPRRequest).where(GDPRRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req or req.status != "completed" or not req.download_url:
        raise HTTPException(status_code=404, detail="Export not ready or not found")

    # The download url is associated with a specific file on disk
    user_id = req.user_id
    # Search GDPR_DIR for export zip for this user
    zips = list(GDPR_DIR.glob(f"gdpr_export_{user_id}_*.zip"))
    if not zips:
        raise HTTPException(status_code=404, detail="Export zip file missing on disk")

    # Return the latest file
    latest_zip = max(zips, key=os.path.getmtime)
    return FileResponse(
        path=latest_zip,
        filename=latest_zip.name,
        media_type="application/zip"
    )


# ── Archive Tier Endpoints ───────────────────────────────
@router.post("/documents/{document_id}/archive")
async def archive_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.status == "archived":
        return {"status": "already_archived", "document_id": document_id}

    # Delete vectors from ChromaDB to free up memory
    vector_store = await get_vector_store()
    await vector_store.delete_document(document_id)

    doc.status = "archived"
    await db.commit()

    return {"status": "archived", "document_id": document_id}


@router.post("/documents/{document_id}/restore")
async def restore_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    # Restore requires loading the document chunks and re-embedding them
    query = select(Document).where(Document.id == document_id)
    result = await db.execute(query)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.status != "archived":
        return {"status": "not_archived", "document_id": document_id}

    # Fetch chunks
    c_res = await db.execute(select(Chunk).where(Chunk.document_id == document_id))
    chunks = c_res.scalars().all()

    if not chunks:
        raise HTTPException(status_code=400, detail="Cannot restore: no text chunks found in database")

    # Re-embed in vector store
    chunk_texts = [c.content for c in chunks]
    chunk_ids = [c.id for c in chunks]
    chunk_metas = []
    for c in chunks:
        chunk_metas.append({
            "document_id": doc.id,
            "chunk_id": c.id,
            "filename": doc.original_filename,
            "chunk_type": c.chunk_type or "text",
            "page_number": c.page_number or 0,
            "section": c.section or "",
            "heading": c.heading or "",
            "course_id": doc.course_id or "",
            "subject": doc.subject or "",
            "semester": doc.semester or "",
            "unit": doc.unit or "",
            "doc_type": doc.doc_type or "",
        })

    vector_store = await get_vector_store()
    await vector_store.add_documents(chunk_texts, chunk_ids, chunk_metas)

    doc.status = "indexed"
    await db.commit()

    return {"status": "restored", "document_id": document_id}
