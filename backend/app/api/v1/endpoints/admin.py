"""Admin dashboard endpoints — system stats, user management, documents, audit, system health."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, case, text
from sqlalchemy.orm import joinedload, selectinload

from app.db.database import get_db
from app.models.user import User
from app.models.document import Document, Chunk
from app.models.conversation import Message, Conversation
from app.models.billing import UsageRecord, Subscription
from app.models.organization import Organization, OrganizationMember
from app.models.audit import AuditLog
from app.models.course import Course, UserCourse
from app.auth.security import get_current_user, decode_token
from app.services.cache import cache_get, cache_set
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])

# ── Cache helpers ────────────────────────────────────────
CACHE_PREFIX = "admin:"

async def admin_cache_get(key: str):
    return await cache_get(f"{CACHE_PREFIX}{key}")

async def admin_cache_set(key: str, value, ttl: int = 30):
    await cache_set(f"{CACHE_PREFIX}{key}", value, ttl)

async def admin_cache_invalidate(pattern: str = ""):
    if pattern:
        from app.services.cache import cache_delete_pattern
        await cache_delete_pattern(f"{CACHE_PREFIX}{pattern}*")


# ── Admin WebSocket manager ──────────────────────────────
class AdminWSManager:
    def __init__(self):
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast(self, event: str, data: dict):
        dead = []
        for ws in self._connections:
            try:
                await ws.send_json({"event": event, "data": data})
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

admin_ws_manager = AdminWSManager()


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Stats ──────────────────────────────────────────────────

@router.get("/stats")
async def admin_stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    cached = await admin_cache_get("stats")
    if cached:
        return cached

    now = datetime.utcnow()
    today = now.date()
    week_ago = today - timedelta(days=7)
    prev_week = today - timedelta(days=14)

    # Current counts
    user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
    org_count = (await db.execute(select(func.count(Organization.id)))).scalar() or 0
    doc_count = (await db.execute(select(func.count(Document.id)))).scalar() or 0
    msg_count = (await db.execute(select(func.count(Message.id)))).scalar() or 0
    conv_count = (await db.execute(select(func.count(Conversation.id)))).scalar() or 0
    active_users_7d = (await db.execute(
        select(func.count(func.distinct(Conversation.user_id)))
        .select_from(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.created_at >= week_ago)
    )).scalar() or 0

    # Usage
    usage_result = await db.execute(
        select(func.sum(UsageRecord.api_calls), func.sum(UsageRecord.tokens_used))
        .where(UsageRecord.date >= week_ago)
    )
    usage = usage_result.one()
    api_calls_7d = usage[0] or 0
    tokens_used_7d = usage[1] or 0

    # Previous period for growth calculation
    prev_user_count = (await db.execute(
        select(func.count(User.id)).where(User.created_at < prev_week)
    )).scalar() or 0
    prev_msg_count = (await db.execute(
        select(func.count(Message.id)).where(Message.created_at < prev_week)
    )).scalar() or 0
    prev_usage_result = await db.execute(
        select(func.sum(UsageRecord.api_calls), func.sum(UsageRecord.tokens_used))
        .where(UsageRecord.date.between(prev_week, week_ago - timedelta(days=1)))
    )
    prev_usage = prev_usage_result.one()

    def growth(current, previous):
        if previous == 0:
            return 100.0 if current > 0 else 0.0
        return round(((current - previous) / previous) * 100, 1)

    # Storage
    storage_result = await db.execute(select(func.sum(Document.file_size)))
    storage_bytes = storage_result.scalar() or 0

    # Feedback ratio
    good = (await db.execute(
        select(func.count(Message.id)).where(Message.feedback == "good")
    )).scalar() or 0
    total_feedback = (await db.execute(
        select(func.count(Message.id)).where(Message.feedback.isnot(None))
    )).scalar() or 0
    feedback_ratio = round(good / total_feedback, 3) if total_feedback > 0 else 0

    # Avg confidence
    conf = await db.execute(select(func.avg(Message.confidence)))
    avg_confidence = round(conf.scalar() or 0, 3)

    # Failed ingestion count
    failed_docs = (await db.execute(
        select(func.count(Document.id)).where(Document.status == "failed")
    )).scalar() or 0

    result = {
        "users": user_count,
        "user_growth": growth(user_count, prev_user_count),
        "organizations": org_count,
        "documents": doc_count,
        "messages": msg_count,
        "message_growth": growth(msg_count, prev_msg_count),
        "conversations": conv_count,
        "active_users_7d": active_users_7d,
        "api_calls_7d": api_calls_7d,
        "api_calls_growth": growth(api_calls_7d, prev_usage[0] or 0),
        "tokens_used_7d": tokens_used_7d,
        "tokens_growth": growth(tokens_used_7d, prev_usage[1] or 0),
        "storage_bytes": storage_bytes,
        "storage_gb": round(storage_bytes / (1024 ** 3), 2),
        "avg_confidence": avg_confidence,
        "feedback_ratio": feedback_ratio,
        "failed_documents": failed_docs,
    }
    await admin_cache_set("stats", result, ttl=30)
    return result


@router.get("/stats/trends")
async def admin_trends(
    days: int = Query(30, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    cache_key = f"trends:{days}"
    cached = await admin_cache_get(cache_key)
    if cached:
        return cached

    now = datetime.utcnow()
    start = now - timedelta(days=days)

    # Daily users count
    user_rows = (await db.execute(
        select(
            func.date(User.created_at).label("date"),
            func.count(User.id).label("count"),
        ).where(User.created_at >= start)
        .group_by(func.date(User.created_at))
        .order_by(func.date(User.created_at))
    )).all()

    # Daily messages
    msg_rows = (await db.execute(
        select(
            func.date(Message.created_at).label("date"),
            func.count(Message.id).label("count"),
        ).where(Message.created_at >= start)
        .group_by(func.date(Message.created_at))
        .order_by(func.date(Message.created_at))
    )).all()

    # Daily documents
    doc_rows = (await db.execute(
        select(
            func.date(Document.created_at).label("date"),
            func.count(Document.id).label("count"),
        ).where(Document.created_at >= start)
        .group_by(func.date(Document.created_at))
        .order_by(func.date(Document.created_at))
    )).all()

    # Daily usage
    usage_rows = (await db.execute(
        select(
            UsageRecord.date,
            func.sum(UsageRecord.api_calls).label("api_calls"),
            func.sum(UsageRecord.tokens_used).label("tokens"),
        ).where(UsageRecord.date >= start.date())
        .group_by(UsageRecord.date)
        .order_by(UsageRecord.date)
    )).all()

    # Build daily series
    date_map = {}
    for i in range(days + 1):
        d = (now - timedelta(days=days - i)).date()
        date_map[d.isoformat()] = {"users": 0, "messages": 0, "documents": 0, "api_calls": 0, "tokens": 0}

    for row in user_rows:
        d = row.date.isoformat() if hasattr(row.date, "isoformat") else str(row.date)
        if d in date_map:
            date_map[d]["users"] = row.count

    for row in msg_rows:
        d = row.date.isoformat() if hasattr(row.date, "isoformat") else str(row.date)
        if d in date_map:
            date_map[d]["messages"] = row.count

    for row in doc_rows:
        d = row.date.isoformat() if hasattr(row.date, "isoformat") else str(row.date)
        if d in date_map:
            date_map[d]["documents"] = row.count

    for row in usage_rows:
        d = row.date.isoformat() if hasattr(row.date, "isoformat") else str(row.date)
        if d in date_map:
            date_map[d]["api_calls"] = row.api_calls or 0
            date_map[d]["tokens"] = row.tokens or 0

    series = [{"date": d, **v} for d, v in sorted(date_map.items())]
    result = {"series": series, "total_days": len(series)}
    await admin_cache_set(f"trends:{days}", result, ttl=300)
    return result


@router.get("/stats/breakdown")
async def admin_breakdown(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # Per-mode conversation count
    mode_rows = (await db.execute(
        select(Conversation.mode, func.count(Conversation.id).label("count"))
        .group_by(Conversation.mode)
    )).all()

    # Per-role user count
    role_rows = (await db.execute(
        select(User.role, func.count(User.id).label("count"))
        .group_by(User.role)
    )).all()

    # Per-status document count
    status_rows = (await db.execute(
        select(Document.status, func.count(Document.id).label("count"))
        .group_by(Document.status)
    )).all()

    # Per-plan org count
    plan_rows = (await db.execute(
        select(Subscription.plan, func.count(Subscription.id).label("count"))
        .group_by(Subscription.plan)
    )).all()

    return {
        "by_mode": {r.mode: r.count for r in mode_rows},
        "by_role": {r.role: r.count for r in role_rows},
        "by_status": {r.status: r.count for r in status_rows},
        "by_plan": {r.plan: r.count for r in plan_rows},
    }


# ── Users ──────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=100),
    sort_by: str = Query("created_at", pattern=r"^(created_at|email|full_name|role|department)$"),
    sort_dir: str = Query("desc", pattern=r"^(asc|desc)$"),
    role: str = Query("", max_length=20),
    is_active: bool = Query(None),
    department: str = Query("", max_length=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base = select(User)
    count_base = select(func.count(User.id))

    conditions = []
    if search:
        pattern = f"%{search}%"
        conditions.append(
            User.email.ilike(pattern) | User.username.ilike(pattern) | User.full_name.ilike(pattern)
        )
    if role:
        conditions.append(User.role == role)
    if is_active is not None:
        conditions.append(User.is_active == is_active)
    if department:
        conditions.append(User.department.ilike(f"%{department}%"))

    for cond in conditions:
        base = base.where(cond)
        count_base = count_base.where(cond)

    sort_col = getattr(User, sort_by)
    order = sort_col.asc() if sort_dir == "asc" else sort_col.desc()
    base = base.order_by(order).offset((page - 1) * per_page).limit(per_page)

    total = (await db.execute(count_base)).scalar() or 0
    result = await db.execute(base.options(selectinload(User.documents), selectinload(User.conversations)))
    users = result.scalars().all()

    return {
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "username": u.username,
                "full_name": u.full_name,
                "role": u.role,
                "department": u.department,
                "semester": u.semester,
                "is_active": u.is_active,
                "is_verified": u.is_verified,
                "doc_count": len(u.documents) if u.documents else 0,
                "conv_count": len(u.conversations) if u.conversations else 0,
                "created_at": u.created_at.isoformat(),
                "updated_at": u.updated_at.isoformat(),
            }
            for u in users
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.documents), selectinload(User.conversations), selectinload(User.courses))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Latest messages
    recent_msgs = (await db.execute(
        select(Message)
        .where(Message.conversation.has(user_id=user_id))
        .order_by(Message.created_at.desc())
        .limit(20)
    )).scalars().all()

    course_list = []
    if user.courses:
        for uc in user.courses:
            course_list.append({"course_id": uc.course_id, "role": uc.role})

    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "department": user.department,
        "semester": user.semester,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "avatar_url": user.avatar_url,
        "doc_count": len(user.documents) if user.documents else 0,
        "conv_count": len(user.conversations) if user.conversations else 0,
        "created_at": user.created_at.isoformat(),
        "updated_at": user.updated_at.isoformat(),
        "courses": course_list,
        "recent_messages": [
            {
                "id": m.id,
                "role": m.role,
                "content_preview": m.content[:200],
                "confidence": m.confidence,
                "created_at": m.created_at.isoformat(),
            }
            for m in recent_msgs
        ],
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    role: str = Query(None, pattern=r"^(student|ta|faculty|admin)$"),
    is_active: bool = Query(None),
    department: str = Query(None, max_length=255),
    semester: str = Query(None, max_length=20),
    full_name: str = Query(None, max_length=255),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if role is not None:
        user.role = role
    if is_active is not None:
        user.is_active = is_active
    if department is not None:
        user.department = department
    if semester is not None:
        user.semester = semester
    if full_name is not None:
        user.full_name = full_name

    await db.commit()
    return {"status": "updated", "user_id": user_id}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin users")

    await db.delete(user)
    await db.commit()
    return {"status": "deleted"}


# ── Documents ──────────────────────────────────────────────

@router.get("/documents")
async def admin_documents(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=100),
    status_filter: str = Query("", alias="status", max_length=20),
    sort_by: str = Query("created_at", pattern=r"^(created_at|filename|file_size|status|total_chunks|file_type)$"),
    sort_dir: str = Query("desc", pattern=r"^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base = select(Document)
    count_base = select(func.count(Document.id))

    if status_filter:
        base = base.where(Document.status == status_filter)
        count_base = count_base.where(Document.status == status_filter)

    if search:
        pattern = f"%{search}%"
        base = base.where(Document.original_filename.ilike(pattern))
        count_base = count_base.where(Document.original_filename.ilike(pattern))

    sort_col = getattr(Document, sort_by)
    order = sort_col.asc() if sort_dir == "asc" else sort_col.desc()
    base = base.options(joinedload(Document.owner)).order_by(order)
    base = base.offset((page - 1) * per_page).limit(per_page)

    total = (await db.execute(count_base)).scalar() or 0
    result = await db.execute(base)
    docs = result.unique().scalars().all()

    return {
        "documents": [
            {
                "id": d.id,
                "filename": d.original_filename,
                "file_type": d.file_type,
                "file_size": d.file_size,
                "file_size_kb": round(d.file_size / 1024, 1),
                "status": d.status,
                "owner_id": d.owner_id,
                "owner_name": d.owner.full_name if d.owner else None,
                "owner_email": d.owner.email if d.owner else None,
                "total_chunks": d.total_chunks,
                "total_pages": d.total_pages,
                "error_message": d.error_message,
                "created_at": d.created_at.isoformat(),
                "indexed_at": d.indexed_at.isoformat() if d.indexed_at else None,
            }
            for d in docs
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/documents/{doc_id}")
async def admin_document_detail(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(Document)
        .where(Document.id == doc_id)
        .options(joinedload(Document.owner), selectinload(Document.chunks), joinedload(Document.course))
    )
    doc = result.unique().scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return {
        "id": doc.id,
        "filename": doc.original_filename,
        "file_type": doc.file_type,
        "file_size": doc.file_size,
        "file_size_kb": round(doc.file_size / 1024, 1),
        "mime_type": doc.mime_type,
        "checksum": doc.checksum,
        "status": doc.status,
        "error_message": doc.error_message,
        "total_chunks": doc.total_chunks,
        "total_pages": doc.total_pages,
        "title": doc.title,
        "author": doc.author,
        "subject": doc.subject,
        "doc_type": doc.doc_type,
        "language": doc.language,
        "is_public": doc.is_public,
        "is_shared": doc.is_shared,
        "is_ocr_processed": doc.is_ocr_processed,
        "tags": doc.tags,
        "owner": {"id": doc.owner.id, "full_name": doc.owner.full_name, "email": doc.owner.email} if doc.owner else None,
        "course_name": doc.course.name if doc.course else None,
        "chunks": [
            {"id": c.id, "chunk_index": c.chunk_index, "content_preview": c.content[:300], "page_number": c.page_number, "chunk_type": c.chunk_type, "token_count": c.token_count}
            for c in (doc.chunks or [])
        ],
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
        "indexed_at": doc.indexed_at.isoformat() if doc.indexed_at else None,
    }


# ── Organizations ──────────────────────────────────────────

@router.get("/organizations")
async def admin_organizations(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=100),
    plan_filter: str = Query("", alias="plan", max_length=20),
    sort_by: str = Query("created_at", pattern=r"^(created_at|name|member_count)$"),
    sort_dir: str = Query("desc", pattern=r"^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base = select(Organization)
    count_base = select(func.count(Organization.id))

    if search:
        pattern = f"%{search}%"
        base = base.where(Organization.name.ilike(pattern) | Organization.slug.ilike(pattern))
        count_base = count_base.where(Organization.name.ilike(pattern) | Organization.slug.ilike(pattern))

    if plan_filter:
        base = base.join(Subscription).where(Subscription.plan == plan_filter)
        count_base = count_base.join(Subscription).where(Subscription.plan == plan_filter)

    base = base.options(joinedload(Organization.owner), selectinload(Organization.members), joinedload(Organization.subscription))
    sort_col = getattr(Organization, sort_by)
    order = sort_col.asc() if sort_dir == "asc" else sort_col.desc()
    base = base.order_by(order).offset((page - 1) * per_page).limit(per_page)

    total = (await db.execute(count_base)).scalar() or 0
    result = await db.execute(base)
    orgs = result.unique().scalars().all()

    return {
        "organizations": [
            {
                "id": o.id,
                "name": o.name,
                "slug": o.slug,
                "description": o.description,
                "owner_id": o.owner_id,
                "owner_name": o.owner.full_name if o.owner else None,
                "owner_email": o.owner.email if o.owner else None,
                "is_active": o.is_active,
                "plan": o.subscription.plan if o.subscription else "free",
                "subscription_status": o.subscription.status if o.subscription else None,
                "member_count": len(o.members) if o.members else 0,
                "created_at": o.created_at.isoformat(),
                "updated_at": o.updated_at.isoformat(),
            }
            for o in orgs
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/organizations/{org_id}")
async def admin_organization_detail(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(Organization)
        .where(Organization.id == org_id)
        .options(
            joinedload(Organization.owner),
            selectinload(Organization.members).joinedload(OrganizationMember.user),
            selectinload(Organization.workspaces),
            joinedload(Organization.subscription),
        )
    )
    org = result.unique().scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Usage records
    usage_rows = (await db.execute(
        select(UsageRecord)
        .where(UsageRecord.organization_id == org_id)
        .order_by(UsageRecord.date.desc())
        .limit(90)
    )).scalars().all()

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "description": org.description,
        "logo_url": org.logo_url,
        "settings": org.settings,
        "is_active": org.is_active,
        "owner": {
            "id": org.owner.id,
            "full_name": org.owner.full_name,
            "email": org.owner.email,
        } if org.owner else None,
        "members": [
            {
                "id": m.id,
                "user_id": m.user_id,
                "name": m.user.full_name if m.user else None,
                "email": m.user.email if m.user else None,
                "role": m.role,
                "joined_at": m.joined_at.isoformat(),
            }
            for m in (org.members or [])
        ],
        "workspaces": [
            {"id": w.id, "name": w.name, "slug": w.slug, "is_default": w.is_default, "is_active": w.is_active}
            for w in (org.workspaces or [])
        ],
        "subscription": {
            "plan": org.subscription.plan,
            "status": org.subscription.status,
            "current_period_start": org.subscription.current_period_start.isoformat() if org.subscription and org.subscription.current_period_start else None,
            "current_period_end": org.subscription.current_period_end.isoformat() if org.subscription and org.subscription.current_period_end else None,
        } if org.subscription else None,
        "usage": [
            {
                "date": u.date.isoformat() if hasattr(u.date, "isoformat") else str(u.date),
                "api_calls": u.api_calls,
                "documents_processed": u.documents_processed,
                "storage_bytes": u.storage_bytes,
                "tokens_used": u.tokens_used,
            }
            for u in usage_rows
        ],
        "created_at": org.created_at.isoformat(),
        "updated_at": org.updated_at.isoformat(),
    }


# ── Audit Log ──────────────────────────────────────────────

@router.get("/audit")
async def admin_audit(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    action: str = Query("", max_length=100),
    resource_type: str = Query("", max_length=50),
    user_id: str = Query("", max_length=36),
    start_date: str = Query("", max_length=10),
    end_date: str = Query("", max_length=10),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base = select(AuditLog)
    count_base = select(func.count(AuditLog.id))

    if action:
        base = base.where(AuditLog.action == action)
        count_base = count_base.where(AuditLog.action == action)
    if resource_type:
        base = base.where(AuditLog.resource_type == resource_type)
        count_base = count_base.where(AuditLog.resource_type == resource_type)
    if user_id:
        base = base.where(AuditLog.user_id == user_id)
        count_base = count_base.where(AuditLog.user_id == user_id)
    if start_date:
        base = base.where(AuditLog.created_at >= f"{start_date} 00:00:00")
        count_base = count_base.where(AuditLog.created_at >= f"{start_date} 00:00:00")
    if end_date:
        base = base.where(AuditLog.created_at <= f"{end_date} 23:59:59")
        count_base = count_base.where(AuditLog.created_at <= f"{end_date} 23:59:59")

    base = base.order_by(AuditLog.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    total = (await db.execute(count_base)).scalar() or 0
    result = await db.execute(base)
    logs = result.scalars().all()

    return {
        "logs": [
            {
                "id": l.id,
                "user_id": l.user_id,
                "action": l.action,
                "resource_type": l.resource_type,
                "resource_id": l.resource_id,
                "details": l.details,
                "ip_address": l.ip_address,
                "created_at": l.created_at.isoformat(),
            }
            for l in logs
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/audit/stats")
async def admin_audit_stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    top_actions = (await db.execute(
        select(AuditLog.action, func.count(AuditLog.id).label("count"))
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(10)
    )).all()

    top_users = (await db.execute(
        select(AuditLog.user_id, func.count(AuditLog.id).label("count"))
        .where(AuditLog.user_id.isnot(None))
        .group_by(AuditLog.user_id)
        .order_by(func.count(AuditLog.id).desc())
        .limit(10)
    )).all()

    daily = (await db.execute(
        select(func.date(AuditLog.created_at).label("date"), func.count(AuditLog.id).label("count"))
        .group_by(func.date(AuditLog.created_at))
        .order_by(func.date(AuditLog.created_at).desc())
        .limit(30)
    )).all()

    return {
        "total_entries": (await db.execute(select(func.count(AuditLog.id)))).scalar() or 0,
        "top_actions": {r.action: r.count for r in top_actions},
        "top_users": {r.user_id: r.count for r in top_users},
        "daily_counts": {str(r.date): r.count for r in daily},
    }


# ── System Health ──────────────────────────────────────────

@router.get("/system")
async def admin_system(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # DB pool info
    db_status = "connected"
    pool_size = 0
    try:
        result = await db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception:
        db_status = "error"

    # Document counts by status
    status_counts = (await db.execute(
        select(Document.status, func.count(Document.id).label("count"))
        .group_by(Document.status)
    )).all()

    # Total chunks
    total_chunks = (await db.execute(select(func.count(Chunk.id)))).scalar() or 0

    # Total vector store entries (approximated by chunk count)
    # Check if ChromaDB is accessible
    chroma_status = "unknown"
    try:
        from app.embeddings.vector_store import get_vector_store
        vs = await get_vector_store()
        chroma_status = "connected"
    except Exception:
        chroma_status = "unavailable"

    # Ollama status check
    ollama_status = "unknown"
    try:
        from app.services.http_client import shared_client
        resp = await shared_client.get("http://localhost:11434/api/tags", timeout=2)
        ollama_status = "connected" if resp.status_code == 200 else "error"
    except Exception:
        ollama_status = "unreachable"

    return {
        "database": {
            "status": db_status,
            "pool_size": pool_size,
        },
        "vector_store": {
            "status": chroma_status,
            "total_chunks": total_chunks,
        },
        "ollama": {
            "status": ollama_status,
        },
        "documents": {r.status: r.count for r in status_counts},
        "total_documents": sum(r.count for r in status_counts),
    }


# ── Bulk Operations ───────────────────────────────────────

@router.post("/users/batch")
async def admin_users_batch(
    body: dict,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    action = body.get("action")
    user_ids = body.get("user_ids", [])
    value = body.get("value")

    if not action or not user_ids:
        raise HTTPException(status_code=400, detail="action and user_ids are required")
    if action not in ("activate", "deactivate", "set_role", "delete"):
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    results = {"succeeded": 0, "failed": 0, "errors": []}

    for uid in user_ids:
        try:
            result = await db.execute(select(User).where(User.id == uid))
            user = result.scalar_one_or_none()
            if not user:
                results["failed"] += 1
                results["errors"].append({"user_id": uid, "error": "not_found"})
                continue
            if user.role == "admin" and action == "delete":
                results["failed"] += 1
                results["errors"].append({"user_id": uid, "error": "cannot_delete_admin"})
                continue

            if action == "activate":
                user.is_active = True
            elif action == "deactivate":
                user.is_active = False
            elif action == "set_role":
                if value not in ("student", "ta", "faculty", "admin"):
                    raise HTTPException(status_code=400, detail=f"Invalid role: {value}")
                user.role = value
            elif action == "delete":
                await db.delete(user)

            results["succeeded"] += 1
        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"user_id": uid, "error": str(e)})

    await db.commit()

    await admin_ws_manager.broadcast("users:updated", {
        "action": action,
        "count": results["succeeded"],
    })

    return results


# ── CSV Export ─────────────────────────────────────────────

@router.get("/{resource}/export")
async def admin_export(
    resource: str,
    format: str = Query("csv", pattern=r"^(csv)$"),
    search: str = Query("", max_length=100),
    status_filter: str = Query("", alias="status", max_length=20),
    role_filter: str = Query("", alias="role", max_length=20),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if resource not in ("users", "documents", "organizations", "audit"):
        raise HTTPException(status_code=400, detail=f"Unknown resource: {resource}")

    output = io.StringIO()
    writer = csv.writer(output)

    if resource == "users":
        writer.writerow(["id", "email", "username", "full_name", "role", "department", "semester", "is_active", "is_verified", "created_at"])
        base = select(User)
        if search:
            base = base.where(User.email.ilike(f"%{search}%") | User.full_name.ilike(f"%{search}%"))
        if role_filter:
            base = base.where(User.role == role_filter)
        rows = (await db.execute(base.order_by(User.created_at.desc()).limit(5000))).scalars().all()
        for u in rows:
            writer.writerow([u.id, u.email, u.username, u.full_name, u.role, u.department, u.semester, u.is_active, u.is_verified, u.created_at.isoformat()])

    elif resource == "documents":
        writer.writerow(["id", "filename", "file_type", "file_size", "status", "owner_id", "owner_email", "total_chunks", "total_pages", "created_at", "indexed_at"])
        base = select(Document).options(joinedload(Document.owner))
        if search:
            base = base.where(Document.original_filename.ilike(f"%{search}%"))
        if status_filter:
            base = base.where(Document.status == status_filter)
        rows = (await db.execute(base.order_by(Document.created_at.desc()).limit(5000))).scalars().all()
        for d in rows:
            writer.writerow([d.id, d.original_filename, d.file_type, d.file_size, d.status, d.owner_id, d.owner.email if d.owner else "", d.total_chunks, d.total_pages, d.created_at.isoformat(), d.indexed_at.isoformat() if d.indexed_at else ""])

    elif resource == "organizations":
        writer.writerow(["id", "name", "slug", "owner_id", "owner_email", "is_active", "plan", "member_count", "created_at"])
        base = select(Organization).options(joinedload(Organization.owner), selectinload(Organization.members), joinedload(Organization.subscription))
        if search:
            base = base.where(Organization.name.ilike(f"%{search}%"))
        rows = (await db.execute(base.order_by(Organization.created_at.desc()).limit(5000))).scalars().all()
        for o in rows:
            writer.writerow([o.id, o.name, o.slug, o.owner_id, o.owner.email if o.owner else "", o.is_active, o.subscription.plan if o.subscription else "free", len(o.members) if o.members else 0, o.created_at.isoformat()])

    elif resource == "audit":
        writer.writerow(["id", "user_id", "action", "resource_type", "resource_id", "details", "ip_address", "created_at"])
        base = select(AuditLog)
        if search:
            base = base.where(AuditLog.action.ilike(f"%{search}%"))
        rows = (await db.execute(base.order_by(AuditLog.created_at.desc()).limit(5000))).scalars().all()
        for l in rows:
            writer.writerow([l.id, l.user_id or "", l.action, l.resource_type or "", l.resource_id or "", json.dumps(l.details) if l.details else "", l.ip_address or "", l.created_at.isoformat()])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={resource}_{datetime.utcnow().date().isoformat()}.csv"},
    )


# ── WebSocket Events ───────────────────────────────────────

@router.websocket("/ws/events")
async def admin_ws_events(ws: WebSocket):
    await ws.accept()
    token = ws.headers.get("authorization") or ws.query_params.get("token", "")
    token = token.replace("Bearer ", "")
    payload = decode_token(token)
    if not payload or payload.get("role") != "admin":
        await ws.send_json({"event": "error", "data": {"detail": "Admin authentication required"}})
        await ws.close()
        return

    await admin_ws_manager.connect(ws)
    logger.info("Admin WS connected", admin_id=payload.get("sub"))

    try:
        while True:
            data = await ws.receive_text()
            # Pong keepalive
            if data == "ping":
                await ws.send_json({"event": "pong"})
    except WebSocketDisconnect:
        admin_ws_manager.disconnect(ws)
        logger.info("Admin WS disconnected")
    except Exception:
        admin_ws_manager.disconnect(ws)
