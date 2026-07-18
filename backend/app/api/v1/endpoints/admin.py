"""Admin dashboard endpoints — system stats, user management, documents, audit, system health."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, case, text, Integer
from sqlalchemy.orm import joinedload, selectinload

from app.db.database import get_db, AsyncSessionLocal
from app.models.user import User
from app.models.document import Document, Chunk
from app.models.conversation import Message, Conversation
from app.models.billing import UsageRecord, Subscription
from app.models.organization import Organization, OrganizationMember
from app.models.audit import AuditLog
from app.models.security import APIKey, WebhookSubscription
from app.models.course import Course, UserCourse
from app.models.conversation import Bookmark
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


async def write_audit_log(
    db: AsyncSession,
    action: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    user_id: str | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Write an audit log entry and broadcast it via WS."""
    entry = AuditLog(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        user_id=user_id,
        details=details,
        ip_address=ip_address,
    )
    db.add(entry)
    await db.flush()  # get ID before commit

    # Fire-and-forget WS broadcast
    try:
        from app.services.event_bus import emit_audit_event
        import asyncio
        asyncio.create_task(emit_audit_event(
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id,
            details=details,
            ip_address=ip_address,
        ))
    except Exception:
        pass

    return entry


# ── Alerts ─────────────────────────────────────────────────

@router.get("/alerts")
async def admin_alerts(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Return current alert conditions based on live stats snapshot."""
    from app.services.event_bus import ALERT_THRESHOLDS

    now = datetime.utcnow()
    week_ago = now.date() - timedelta(days=7)

    failed_docs = (await db.execute(
        select(func.count(Document.id)).where(Document.status == "failed")
    )).scalar() or 0
    total_docs = (await db.execute(select(func.count(Document.id)))).scalar() or 0
    storage_bytes = (await db.execute(select(func.sum(Document.file_size)))).scalar() or 0

    latency_rows = (await db.execute(
        select(Message.latency_ms)
        .where(Message.latency_ms.isnot(None))
        .order_by(Message.latency_ms)
    )).scalars().all()
    lat_count = len(latency_rows)
    latency_p95 = latency_rows[int(lat_count * 0.95)] if lat_count > 0 else None

    stats = {
        "failed_ingestions": failed_docs,
        "documents": total_docs,
        "storage_bytes": storage_bytes,
        "latency_p95": latency_p95,
    }

    alerts = []
    if total_docs > 0:
        error_pct = (failed_docs / total_docs) * 100
        if error_pct >= ALERT_THRESHOLDS["error_spike_pct"]:
            alerts.append({
                "level": "error",
                "type": "ingestion_error_spike",
                "message": f"Ingestion failure rate {error_pct:.1f}% ({failed_docs}/{total_docs} docs)",
                "value": error_pct,
                "threshold": ALERT_THRESHOLDS["error_spike_pct"],
            })

    storage_gb = storage_bytes / (1024 ** 3)
    if storage_gb >= ALERT_THRESHOLDS["storage_threshold_gb"]:
        alerts.append({
            "level": "warning",
            "type": "storage_threshold",
            "message": f"Storage {storage_gb:.2f} GB exceeds {ALERT_THRESHOLDS['storage_threshold_gb']} GB threshold",
            "value": storage_gb,
            "threshold": ALERT_THRESHOLDS["storage_threshold_gb"],
        })

    if latency_p95 and latency_p95 >= ALERT_THRESHOLDS["latency_p95_ms"]:
        alerts.append({
            "level": "warning",
            "type": "high_latency",
            "message": f"P95 latency {latency_p95:.0f}ms exceeds {ALERT_THRESHOLDS['latency_p95_ms']:.0f}ms threshold",
            "value": latency_p95,
            "threshold": ALERT_THRESHOLDS["latency_p95_ms"],
        })

    return {"alerts": alerts, "thresholds": ALERT_THRESHOLDS, "checked_at": now.isoformat() + "Z"}


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

    # Latency percentiles (approximate from all messages with latency data)
    latency_rows = (await db.execute(
        select(Message.latency_ms)
        .where(Message.latency_ms.isnot(None))
        .order_by(Message.latency_ms)
    )).scalars().all()
    lat_count = len(latency_rows)
    latency_p50 = latency_rows[int(lat_count * 0.5)] if lat_count > 0 else None
    latency_p95 = latency_rows[int(lat_count * 0.95)] if lat_count > 0 else None
    latency_p99 = latency_rows[int(lat_count * 0.99)] if lat_count > 0 else None

    # Daily active users (distinct users who sent a message today)
    dau = (await db.execute(
        select(func.count(func.distinct(Conversation.user_id)))
        .select_from(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.created_at >= today)
    )).scalar() or 0

    # Ingestion throughput (docs indexed in last 24h)
    ingested_24h = (await db.execute(
        select(func.count(Document.id))
        .where(Document.status == "indexed")
        .where(Document.indexed_at >= (now - timedelta(hours=24)))
    )).scalar() or 0

    # Avg conversation duration (minutes between first and last message)
    conv_durations = (await db.execute(
        select(
            func.julianday(func.max(Message.created_at)) - func.julianday(func.min(Message.created_at))
        ).select_from(Message)
        .group_by(Message.conversation_id)
        .having(func.count(Message.id) > 1)
    )).scalars().all()
    avg_duration_min = round((sum(conv_durations) / len(conv_durations) * 24 * 60) if conv_durations else 0, 1)

    # Messages per conversation ratio
    msg_per_conv = round(msg_count / conv_count, 1) if conv_count > 0 else 0

    # Active (30d) vs idle users
    active_30d = (await db.execute(
        select(func.count(func.distinct(Conversation.user_id)))
        .where(Conversation.created_at >= (now - timedelta(days=30)))
    )).scalar() or 0
    idle_users = max(user_count - active_30d, 0)

    # Previous storage for growth
    prev_storage = (await db.execute(
        select(func.sum(Document.file_size)).where(Document.created_at < prev_week)
    )).scalar() or 0

    # Previous period failed count
    prev_failed = (await db.execute(
        select(func.count(Document.id))
        .where(Document.status == "failed")
        .where(Document.created_at.between(prev_week, week_ago - timedelta(days=1)))
    )).scalar() or 0

    result = {
        "users": user_count,
        "user_growth": growth(user_count, prev_user_count),
        "active_users_7d": active_users_7d,
        "daily_active_users": dau,
        "active_users_30d": active_30d,
        "idle_users": idle_users,
        "organizations": org_count,
        "documents": doc_count,
        "document_growth": growth(doc_count, (await db.execute(select(func.count(Document.id)).where(Document.created_at < prev_week))).scalar() or 0),
        "messages": msg_count,
        "message_growth": growth(msg_count, prev_msg_count),
        "conversations": conv_count,
        "messages_per_conversation": msg_per_conv,
        "avg_conversation_duration_min": avg_duration_min,
        "api_calls_7d": api_calls_7d,
        "api_calls_growth": growth(api_calls_7d, prev_usage[0] or 0),
        "tokens_used_7d": tokens_used_7d,
        "tokens_growth": growth(tokens_used_7d, prev_usage[1] or 0),
        "tokens_per_message": round(tokens_used_7d / msg_count, 1) if msg_count > 0 else 0,
        "storage_bytes": storage_bytes,
        "storage_gb": round(storage_bytes / (1024 ** 3), 2),
        "storage_growth": growth(storage_bytes, prev_storage),
        "avg_confidence": avg_confidence,
        "feedback_ratio": feedback_ratio,
        "good_feedback": good,
        "total_feedback": total_feedback,
        "latency_p50_ms": round(latency_p50, 1) if latency_p50 else None,
        "latency_p95_ms": round(latency_p95, 1) if latency_p95 else None,
        "latency_p99_ms": round(latency_p99, 1) if latency_p99 else None,
        "documents_ingested_24h": ingested_24h,
        "failed_documents": failed_docs,
        "failed_documents_growth": growth(failed_docs, prev_failed),
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

    # Per-day latency stats (last 7 days)
    latency_daily = (await db.execute(
        select(
            func.date(Message.created_at).label("date"),
            func.avg(Message.latency_ms).label("avg_latency"),
            func.min(Message.latency_ms).label("min_latency"),
            func.max(Message.latency_ms).label("max_latency"),
            func.count(Message.id).label("msg_count"),
        )
        .where(Message.latency_ms.isnot(None))
        .where(Message.created_at >= datetime.utcnow() - timedelta(days=7))
        .group_by(func.date(Message.created_at))
        .order_by(func.date(Message.created_at))
    )).all()

    # Top 10 users by message count
    top_users = (await db.execute(
        select(
            Conversation.user_id,
            func.count(Message.id).label("msg_count"),
            func.sum(Message.tokens_used).label("total_tokens"),
        )
        .select_from(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .group_by(Conversation.user_id)
        .order_by(func.count(Message.id).desc())
        .limit(10)
    )).all()

    # Top 10 most-cited documents (by citation count in messages)
    most_cited = (await db.execute(
        select(
            Document.id,
            Document.original_filename,
            func.count(Message.id).label("citation_count"),
        )
        .select_from(Document)
        .join(Document.chunks)
        .join(Message, Message.citations.isnot(None))  # approximate: docs with chunks cited
        .group_by(Document.id)
        .order_by(func.count(Message.id).desc())
        .limit(10)
    )).all()

    # Per-course activity (conversations + messages)
    course_rows = (await db.execute(
        select(
            Conversation.course_id,
            func.count(func.distinct(Conversation.id)).label("conv_count"),
            func.count(Message.id).label("msg_count"),
        )
        .select_from(Conversation)
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .where(Conversation.course_id.isnot(None))
        .group_by(Conversation.course_id)
        .order_by(func.count(Message.id).desc())
        .limit(10)
    )).all()

    return {
        "by_mode": {r.mode: r.count for r in mode_rows},
        "by_role": {r.role: r.count for r in role_rows},
        "by_status": {r.status: r.count for r in status_rows},
        "by_plan": {r.plan: r.count for r in plan_rows},
        "latency_daily": {
            str(r.date): {
                "avg": round(r.avg_latency, 1) if r.avg_latency else None,
                "min": round(r.min_latency, 1) if r.min_latency else None,
                "max": round(r.max_latency, 1) if r.max_latency else None,
                "msg_count": r.msg_count,
            }
            for r in latency_daily
        },
        "top_users": [
            {"user_id": r.user_id, "messages": r.msg_count, "tokens": r.total_tokens or 0}
            for r in top_users
        ],
        "most_cited_documents": [
            {"id": r.id, "filename": r.original_filename, "citation_count": r.citation_count}
            for r in most_cited
        ],
        "per_course_activity": [
            {"course_id": r.course_id, "conversations": r.conv_count, "messages": r.msg_count}
            for r in course_rows
        ],
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

    # Aggregate message stats across all user conversations
    conv_ids_subq = select(Conversation.id).where(Conversation.user_id == user_id).subquery()
    msg_stats = (await db.execute(
        select(
            func.count(Message.id).label("total_messages"),
            func.sum(Message.tokens_used).label("total_tokens"),
            func.avg(Message.latency_ms).label("avg_latency"),
            func.avg(Message.confidence).label("avg_confidence"),
            func.sum(case((Message.feedback == "good", 1), else_=0)).label("good_count"),
            func.sum(case((Message.feedback == "bad", 1), else_=0)).label("bad_count"),
            func.max(Message.created_at).label("last_active"),
        )
        .where(Message.conversation_id.in_(select(conv_ids_subq.c.id)))
    )).one()

    # Conversations by mode
    mode_rows = (await db.execute(
        select(Conversation.mode, func.count(Conversation.id).label("count"))
        .where(Conversation.user_id == user_id)
        .group_by(Conversation.mode)
    )).all()

    # Resolve course names for enrolled courses
    course_list = []
    if user.courses:
        course_ids = [uc.course_id for uc in user.courses]
        course_rows = (await db.execute(select(Course).where(Course.id.in_(course_ids)))).scalars().all()
        course_map = {c.id: c for c in course_rows}
        for uc in user.courses:
            c = course_map.get(uc.course_id)
            course_list.append({
                "course_id": uc.course_id,
                "course_name": c.name if c else None,
                "course_code": c.code if c else None,
                "role": uc.role,
            })

    # Latest messages
    recent_msgs = (await db.execute(
        select(Message)
        .where(Message.conversation_id.in_(select(conv_ids_subq.c.id)))
        .order_by(Message.created_at.desc())
        .limit(20)
    )).scalars().all()

    # Total documents uploaded
    doc_count = (await db.execute(
        select(func.count(Document.id)).where(Document.owner_id == user_id)
    )).scalar() or 0

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
        "doc_count": doc_count,
        "conv_count": len(user.conversations) if user.conversations else 0,
        "total_messages": msg_stats.total_messages or 0,
        "total_tokens": msg_stats.total_tokens or 0,
        "avg_latency": round(msg_stats.avg_latency, 1) if msg_stats.avg_latency else None,
        "avg_confidence": round(msg_stats.avg_confidence, 3) if msg_stats.avg_confidence else None,
        "feedback_good": msg_stats.good_count or 0,
        "feedback_bad": msg_stats.bad_count or 0,
        "last_active": msg_stats.last_active.isoformat() if msg_stats.last_active else None,
        "conversations_by_mode": {r.mode: r.count for r in mode_rows},
        "created_at": user.created_at.isoformat(),
        "updated_at": user.updated_at.isoformat(),
        "courses": course_list,
        "recent_messages": [
            {
                "id": m.id,
                "role": m.role,
                "content_preview": m.content[:200],
                "confidence": m.confidence,
                "latency_ms": m.latency_ms,
                "tokens_used": m.tokens_used,
                "feedback": m.feedback,
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

    await write_audit_log(
        db=db,
        action="update_user",
        resource_type="user",
        resource_id=user_id,
        user_id=admin.id,
        details={"role": role, "is_active": is_active, "full_name": full_name}
    )
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
    await write_audit_log(
        db=db,
        action="delete_user",
        resource_type="user",
        resource_id=user_id,
        user_id=admin.id
    )
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
        if status_filter == "processing":
            base = base.where(Document.status.like("processing%"))
            count_base = count_base.where(Document.status.like("processing%"))
        else:
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

    # Count times this document's chunks appear in message citations
    citation_count = 0
    if doc.chunks:
        chunk_ids = [c.id for c in doc.chunks]
        # Check message.citations JSON for chunk IDs
        citation_count = (await db.execute(
            select(func.count(Message.id))
            .where(Message.citations.isnot(None))
        )).scalar() or 0
        # Approximate: count messages where citations might reference this doc
        # A more precise approach would parse JSON, but this gives a general idea

    # Find last time this document was referenced in messages
    last_referenced = None
    if doc.chunks:
        ref_msg = (await db.execute(
            select(Message.created_at)
            .where(Message.citations.isnot(None))
            .order_by(Message.created_at.desc())
            .limit(1)
        )).scalar()
        last_referenced = ref_msg.isoformat() if ref_msg else None

    return {
        "id": doc.id,
        "filename": doc.original_filename,
        "file_type": doc.file_type,
        "file_size": doc.file_size,
        "file_size_kb": round(doc.file_size / 1024, 1),
        "mime_type": doc.mime_type,
        "checksum": doc.checksum,
        "file_path": doc.file_path,
        "status": doc.status,
        "error_message": doc.error_message,
        "total_chunks": doc.total_chunks,
        "total_pages": doc.total_pages,
        "title": doc.title,
        "author": doc.author,
        "subject": doc.subject,
        "doc_type": doc.doc_type,
        "language": doc.language,
        "semester": doc.semester,
        "unit": doc.unit,
        "is_public": doc.is_public,
        "is_shared": doc.is_shared,
        "is_ocr_processed": doc.is_ocr_processed,
        "tags": doc.tags,
        "citation_count": citation_count,
        "last_referenced": last_referenced,
        "owner": {"id": doc.owner.id, "full_name": doc.owner.full_name, "email": doc.owner.email} if doc.owner else None,
        "course_name": doc.course.name if doc.course else None,
        "course_id": doc.course_id,
        "chunks": [
            {"id": c.id, "chunk_index": c.chunk_index, "content_preview": c.content[:300], "page_number": c.page_number, "chunk_type": c.chunk_type, "token_count": c.token_count}
            for c in (doc.chunks or [])
        ],
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
        "indexed_at": doc.indexed_at.isoformat() if doc.indexed_at else None,
    }


# ── Admin Document Pipeline Management ───────────────────

@router.post("/documents/{doc_id}/reprocess", status_code=202)
async def admin_reprocess_document(
    doc_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin endpoint to retry/reprocess any document, bypassing ownership checks."""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    doc.status = "pending"
    doc.error_message = None
    await write_audit_log(
        db=db,
        action="reprocess_document",
        resource_type="document",
        resource_id=doc_id,
        user_id=admin.id,
        details={"filename": doc.original_filename}
    )
    await db.commit()
    from app.ingestion.pipeline import ingest_document
    background_tasks.add_task(ingest_document, doc.id, doc.file_path)
    return {"message": "Reprocessing started", "document_id": doc_id}


class BatchReprocessRequest(BaseModel):
    document_ids: list[str]

@router.post("/documents/batch-reprocess", status_code=202)
async def admin_batch_reprocess_documents(
    req: BatchReprocessRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin endpoint to batch reprocess multiple documents at once."""
    if not req.document_ids:
        raise HTTPException(status_code=400, detail="document_ids is required")

    result = await db.execute(select(Document).where(Document.id.in_(req.document_ids)))
    docs = result.scalars().all()
    
    triggered_ids = []
    for doc in docs:
        doc.status = "pending"
        doc.error_message = None
        triggered_ids.append(doc.id)
        from app.ingestion.pipeline import ingest_document
        background_tasks.add_task(ingest_document, doc.id, doc.file_path)

    if triggered_ids:
        await write_audit_log(
            db=db,
            action="batch_reprocess_documents",
            resource_type="document",
            user_id=admin.id,
            details={"count": len(triggered_ids), "document_ids": triggered_ids}
        )
        await db.commit()

    return {"message": f"Reprocessing triggered for {len(triggered_ids)} documents", "document_ids": triggered_ids}


@router.get("/documents/{doc_id}/failed-chunks")
async def admin_failed_chunks(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin endpoint to inspect chunks that have potential issues or failed indexing."""
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    chunk_result = await db.execute(
        select(Chunk)
        .where(Chunk.document_id == doc_id)
        .order_by(Chunk.chunk_index)
    )
    chunks = chunk_result.scalars().all()

    failed_chunks = []
    for c in chunks:
        is_failed = False
        reasons = []
        
        if doc.status == "indexed" and not c.vector_id:
            is_failed = True
            reasons.append("Missing vector_id in vector store")
            
        if not c.content or len(c.content.strip()) == 0:
            is_failed = True
            reasons.append("Chunk content is empty")
            
        if c.token_count == 0:
            is_failed = True
            reasons.append("Token count is 0")
            
        if is_failed:
            failed_chunks.append({
                "id": c.id,
                "chunk_index": c.chunk_index,
                "content_preview": (c.content or "")[:300],
                "page_number": c.page_number,
                "chunk_type": c.chunk_type,
                "token_count": c.token_count,
                "char_count": c.char_count,
                "reasons": reasons,
            })

    return {
        "document_id": doc_id,
        "filename": doc.original_filename,
        "status": doc.status,
        "total_chunks": len(chunks),
        "failed_chunks": failed_chunks,
        "failed_count": len(failed_chunks),
    }


@router.get("/documents/{doc_id}/logs")
async def admin_document_logs(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Fetch live pipeline execution logs for a document."""
    from app.services.cache import cache_get
    key = f"pipeline_logs:{doc_id}"
    logs = await cache_get(key)
    return {"document_id": doc_id, "logs": logs or []}


class UpdateChunkRequest(BaseModel):
    content: str
    page_number: Optional[int] = None
    chunk_type: Optional[str] = None


@router.put("/chunks/{chunk_id}")
async def admin_update_chunk(
    chunk_id: str,
    req: UpdateChunkRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin endpoint to manually edit/repair a chunk's content and re-index it."""
    result = await db.execute(select(Chunk).where(Chunk.id == chunk_id))
    chunk = result.scalar_one_or_none()
    if not chunk:
        raise HTTPException(status_code=404, detail="Chunk not found")

    doc_result = await db.execute(select(Document).where(Document.id == chunk.document_id))
    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Parent document not found")

    chunk.content = req.content
    if req.page_number is not None:
        chunk.page_number = req.page_number
    if req.chunk_type is not None:
        chunk.chunk_type = req.chunk_type
    
    chunk.char_count = len(req.content)
    chunk.token_count = max(1, len(req.content) // 4)
    
    await db.commit()

    # Re-embed and update vector store
    try:
        from app.embeddings.vector_store import get_vector_store
        vector_store = await get_vector_store()
        
        meta = {
            "document_id": chunk.document_id,
            "chunk_id": chunk.id,
            "filename": doc.original_filename,
            "chunk_type": chunk.chunk_type,
            "page_number": chunk.page_number or 0,
            "course_id": doc.course_id or "",
            "subject": doc.subject or "",
            "semester": doc.semester or "",
            "unit": doc.unit or "",
            "doc_type": doc.doc_type or "",
        }
        
        await vector_store.add_documents(
            texts=[chunk.content],
            ids=[chunk.id],
            metadatas=[meta]
        )
    except Exception as e:
        logger.error("Failed to update vector store for chunk", chunk_id=chunk_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to update vector store: {str(e)}")

    chunk.vector_id = chunk.id
    await db.commit()

    # Rebuild BM25 index
    try:
        from app.retrieval.bm25_index import rebuild_index_from_db
        await rebuild_index_from_db(db)
    except Exception as e:
        logger.warning("BM25 index rebuild failed after chunk edit", error=str(e))

    await write_audit_log(
        db=db,
        action="update_chunk",
        resource_type="chunk",
        resource_id=chunk_id,
        user_id=admin.id,
        details={"document_id": chunk.document_id, "chunk_index": chunk.chunk_index}
    )
    await db.commit()

    return {
        "ok": True,
        "chunk": {
            "id": chunk.id,
            "content": chunk.content,
            "token_count": chunk.token_count,
            "char_count": chunk.char_count
        }
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

    # Compute storage per org
    org_storage = {}
    org_last_active = {}
    for o in orgs:
        member_ids = [m.user_id for m in (o.members or [])]
        if member_ids:
            storage = (await db.execute(
                select(func.sum(Document.file_size)).where(Document.owner_id.in_(member_ids))
            )).scalar() or 0
            org_storage[o.id] = storage

            last_conv = (await db.execute(
                select(func.max(Conversation.updated_at))
                .where(Conversation.user_id.in_(member_ids))
            )).scalar()
            org_last_active[o.id] = last_conv.isoformat() if last_conv else None

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
                "workspace_count": len(o.workspaces) if hasattr(o, "workspaces") and o.workspaces else 0,
                "storage_bytes": org_storage.get(o.id, 0),
                "storage_gb": round(org_storage.get(o.id, 0) / (1024 ** 3), 2),
                "last_active": org_last_active.get(o.id),
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

    # Total storage for this org (sum of document sizes owned by its members)
    member_ids = [m.user_id for m in (org.members or [])]
    total_storage = 0
    if member_ids:
        total_storage = (await db.execute(
            select(func.sum(Document.file_size))
            .where(Document.owner_id.in_(member_ids))
        )).scalar() or 0

    # Quota: API call usage % for current month
    current_month_start = datetime.utcnow().replace(day=1).date()
    month_api_calls = sum(u.api_calls for u in usage_rows if u.date >= current_month_start) if usage_rows else 0
    monthly_quota = {"free": 1000, "pro": 10000, "enterprise": 100000}.get(org.subscription.plan if org.subscription else "free", 1000)
    quota_used_pct = round((month_api_calls / monthly_quota) * 100, 1) if monthly_quota > 0 else 0

    # Member last active (via conversations)
    member_activity = {}
    if member_ids:
        activity_rows = (await db.execute(
            select(
                Conversation.user_id,
                func.max(Conversation.updated_at).label("last_active"),
                func.count(Conversation.id).label("conv_count"),
            )
            .where(Conversation.user_id.in_(member_ids))
            .group_by(Conversation.user_id)
        )).all()
        member_activity = {
            r.user_id: {
                "last_active": r.last_active.isoformat() if r.last_active else None,
                "conversations": r.conv_count,
            }
            for r in activity_rows
        }

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "description": org.description,
        "logo_url": org.logo_url,
        "settings": org.settings,
        "is_active": org.is_active,
        "storage_bytes": total_storage,
        "storage_gb": round(total_storage / (1024 ** 3), 2),
        "quota": {
            "monthly_limit": monthly_quota,
            "used": month_api_calls,
            "used_pct": quota_used_pct,
        },
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
                "last_active": (member_activity.get(m.user_id) or {}).get("last_active"),
                "conversations": (member_activity.get(m.user_id) or {}).get("conversations", 0),
            }
            for m in (org.members or [])
        ],
        "workspaces": [
            {
                "id": w.id, "name": w.name, "slug": w.slug, "description": w.description,
                "is_default": w.is_default, "is_active": w.is_active,
                "created_at": w.created_at.isoformat(),
            }
            for w in (org.workspaces or [])
        ],
        "subscription": {
            "plan": org.subscription.plan,
            "status": org.subscription.status,
            "current_period_start": org.subscription.current_period_start.isoformat() if org.subscription and org.subscription.current_period_start else None,
            "current_period_end": org.subscription.current_period_end.isoformat() if org.subscription and org.subscription.current_period_end else None,
            "trial_end": org.subscription.trial_end.isoformat() if org.subscription and org.subscription.trial_end else None,
            "canceled_at": org.subscription.canceled_at.isoformat() if org.subscription and org.subscription.canceled_at else None,
            "stripe_customer_id": org.subscription.stripe_customer_id if org.subscription else None,
            "stripe_subscription_id": org.subscription.stripe_subscription_id if org.subscription else None,
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
    # DB status
    db_status = "connected"
    try:
        await db.execute(text("SELECT 1"))
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

    # ChromaDB check
    chroma_status = "unknown"
    try:
        from app.embeddings.vector_store import get_vector_store
        vs = await get_vector_store()
        chroma_status = "connected"
    except Exception:
        chroma_status = "unavailable"

    # Ollama check
    ollama_status = "unknown"
    try:
        from app.services.http_client import shared_client
        resp = await shared_client.get("http://localhost:11434/api/tags", timeout=2)
        ollama_status = "connected" if resp.status_code == 200 else "error"
    except Exception:
        ollama_status = "unreachable"

    # Error rate (failed messages / total messages in last 7d)
    week_ago = datetime.utcnow() - timedelta(days=7)
    total_recent_msgs = (await db.execute(
        select(func.count(Message.id)).where(Message.created_at >= week_ago)
    )).scalar() or 1
    failed_msgs = (await db.execute(
        select(func.count(Message.id))
        .where(Message.created_at >= week_ago)
        .where(Message.content == "").where(Message.role == "assistant")
    )).scalar() or 0
    error_rate = round((failed_msgs / total_recent_msgs) * 100, 2)

    # Request rate (avg messages per hour in last 24h)
    now = datetime.utcnow()
    msgs_24h = (await db.execute(
        select(func.count(Message.id)).where(Message.created_at >= (now - timedelta(hours=24)))
    )).scalar() or 0
    rps = round(msgs_24h / 24 / 3600, 3)

    # Uptime — check process start time
    import os, platform
    import psutil
    proc = psutil.Process()
    uptime_seconds = int((datetime.utcnow() - datetime.fromtimestamp(proc.create_time())).total_seconds())

    # Background tasks (approximate from audit log failed actions)
    failed_tasks_7d = (await db.execute(
        select(func.count(AuditLog.id))
        .where(AuditLog.action.ilike("%fail%"))
        .where(AuditLog.created_at >= week_ago)
    )).scalar() or 0

    # Ingestion failure rate
    total_ingested = (await db.execute(
        select(func.count(Document.id)).where(Document.status.in_(["indexed", "failed"]))
    )).scalar() or 1
    status_counts_dict = {r.status: r.count for r in status_counts}
    failed_count = status_counts_dict.get("failed", 0) or 0
    ingestion_failure_rate = round(failed_count / total_ingested * 100, 2) if total_ingested > 0 else 0

    from app.core.config import settings

    return {
        "database": {
            "status": db_status,
        },
        "vector_store": {
            "status": chroma_status,
            "total_chunks": total_chunks,
        },
        "ollama": {
            "status": ollama_status,
        },
        "server": {
            "version": settings.APP_VERSION,
            "name": settings.APP_NAME,
            "python_version": platform.python_version(),
            "os": platform.system(),
            "os_version": platform.version(),
            "uptime_seconds": uptime_seconds,
        },
        "performance": {
            "rps": rps,
            "msgs_24h": msgs_24h,
            "error_rate_pct": error_rate,
            "failed_tasks_7d": failed_tasks_7d,
            "avg_latency_7d_ms": round(
                (await db.execute(
                    select(func.avg(Message.latency_ms)).where(Message.latency_ms.isnot(None)).where(Message.created_at >= week_ago)
                )).scalar() or 0, 1
            ),
        },
        "ingestion": {
            "total_documents": sum(r.count for r in status_counts),
            "by_status": status_counts_dict,
            "failure_rate_pct": ingestion_failure_rate,
        },
    }


# ── Analytics ────────────────────────────────────────────────

@router.get("/analytics")
async def admin_analytics(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    now = datetime.utcnow()

    # ── 1. User churn ──────────────────────────────────────
    last_msg_cte = (
        select(
            Conversation.user_id,
            func.max(Message.created_at).label("last_msg_date"),
        )
        .select_from(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .group_by(Conversation.user_id)
    ).cte("last_msg_cte")

    churn_30 = (await db.execute(
        select(func.count()).select_from(
            select(last_msg_cte.c.user_id).where(last_msg_cte.c.last_msg_date < (now - timedelta(days=30))).subquery()
        )
    )).scalar() or 0
    churn_60 = (await db.execute(
        select(func.count()).select_from(
            select(last_msg_cte.c.user_id).where(last_msg_cte.c.last_msg_date < (now - timedelta(days=60))).subquery()
        )
    )).scalar() or 0
    churn_90 = (await db.execute(
        select(func.count()).select_from(
            select(last_msg_cte.c.user_id).where(last_msg_cte.c.last_msg_date < (now - timedelta(days=90))).subquery()
        )
    )).scalar() or 0

    total_users_with_msgs = (await db.execute(
        select(func.count()).select_from(
            select(last_msg_cte.c.user_id).subquery()
        )
    )).scalar() or 0

    # ── 2. Power users ────────────────────────────────────
    def row_to_user(r):
        return {"id": str(r.id), "full_name": r.full_name, "email": r.email}

    top_msg_rows = (await db.execute(
        select(User.id, User.full_name, User.email, func.count(Message.id).label("cnt"))
        .select_from(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .join(User, Conversation.user_id == User.id)
        .group_by(User.id)
        .order_by(func.count(Message.id).desc())
        .limit(10)
    )).all()
    power_by_msgs = [dict(row_to_user(r), messages=r.cnt) for r in top_msg_rows]

    top_token_rows = (await db.execute(
        select(User.id, User.full_name, User.email, func.coalesce(func.sum(Message.tokens_used), 0).label("cnt"))
        .select_from(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .join(User, Conversation.user_id == User.id)
        .group_by(User.id)
        .order_by(func.coalesce(func.sum(Message.tokens_used), 0).desc())
        .limit(10)
    )).all()
    power_by_tokens = [dict(row_to_user(r), tokens=r.cnt) for r in top_token_rows]

    top_conv_rows = (await db.execute(
        select(User.id, User.full_name, User.email, func.count(Conversation.id).label("cnt"))
        .select_from(Conversation)
        .join(User, Conversation.user_id == User.id)
        .group_by(User.id)
        .order_by(func.count(Conversation.id).desc())
        .limit(10)
    )).all()
    power_by_convs = [dict(row_to_user(r), conversations=r.cnt) for r in top_conv_rows]

    # ── 3. Popular content ────────────────────────────────
    # Compute citation counts from message.citations JSON
    all_docs = (await db.execute(
        select(Document.id, Document.filename, Document.title, Document.file_type, Document.file_size, Document.total_chunks)
        .order_by(Document.total_chunks.desc())
    )).all()
    doc_map = {str(r.id): r for r in all_docs}
    citation_counts = {str(r.id): 0 for r in all_docs}
    citation_msgs = (await db.execute(
        select(Message.citations).where(Message.citations.isnot(None))
    )).scalars().all()
    for c in citation_msgs:
        if not c or not isinstance(c, (dict, list)):
            continue
        refs = []
        if isinstance(c, dict):
            for k in ("documents", "chunks", "sources", "document_ids"):
                v = c.get(k, [])
                if isinstance(v, list):
                    refs.extend(v)
                elif isinstance(v, dict):
                    refs.extend(v.keys())
            for v in c.values():
                if isinstance(v, list):
                    for item in v:
                        if isinstance(item, dict) and "document_id" in item:
                            refs.append(item["document_id"])
            if "document_id" in c:
                refs.append(c["document_id"])
        elif isinstance(c, list):
            refs = c
        for ref in refs:
            if isinstance(ref, dict):
                rid = ref.get("document_id") or ref.get("doc_id") or ref.get("id")
            else:
                rid = str(ref)
            if rid in doc_map:
                citation_counts[rid] += 1

    sorted_docs = sorted(doc_map.keys(), key=lambda d: citation_counts[d], reverse=True)
    popular_content = []
    for doc_id in sorted_docs[:20]:
        r = doc_map[doc_id]
        popular_content.append({
            "id": doc_id, "filename": r.filename, "title": r.title,
            "citation_count": citation_counts[doc_id], "file_type": r.file_type,
            "file_size": r.file_size,
        })

    # ── 4. Slow queries (latency > p95) ───────────────────
    count_latency = (await db.execute(
        select(func.count(Message.id)).where(Message.latency_ms.isnot(None))
    )).scalar() or 0
    p95_offset = max(0, int(count_latency * 0.95) - 1)
    if count_latency > 0:
        p95_val = (await db.execute(
            select(Message.latency_ms).where(Message.latency_ms.isnot(None))
            .order_by(Message.latency_ms).offset(p95_offset).limit(1)
        )).scalar() or 0
        slow_samples = (await db.execute(
            select(
                Message.id, Message.content, Message.latency_ms, Message.tokens_used,
                Message.confidence, Message.created_at, Conversation.id.label("conv_id"),
            )
            .select_from(Message)
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(Message.latency_ms > p95_val)
            .order_by(Message.latency_ms.desc())
            .limit(20)
        )).all()
        slow_query_samples = [
            {
                "id": str(r.id), "content_preview": (r.content or "")[:200],
                "latency_ms": r.latency_ms, "tokens_used": r.tokens_used,
                "confidence": r.confidence, "created_at": r.created_at.isoformat(),
                "conversation_id": str(r.conv_id),
            }
            for r in slow_samples
        ]
    else:
        p95_val = 0
        slow_query_samples = []

    # ── 5. Low confidence ─────────────────────────────────
    low_conf_count = (await db.execute(
        select(func.count(Message.id)).where(
            Message.confidence.isnot(None), Message.confidence < 0.3
        )
    )).scalar() or 0
    low_conf_samples = (await db.execute(
        select(
            Message.id, Message.content, Message.latency_ms, Message.confidence,
            Message.tokens_used, Message.created_at,
        )
        .where(Message.confidence.isnot(None), Message.confidence < 0.3)
        .order_by(Message.confidence.asc())
        .limit(20)
    )).all()
    low_confidence_samples = [
        {
            "id": str(r.id), "content_preview": (r.content or "")[:200],
            "latency_ms": r.latency_ms, "confidence": r.confidence,
            "tokens_used": r.tokens_used, "created_at": r.created_at.isoformat(),
        }
        for r in low_conf_samples
    ]

    # ── 6. Peak hours ─────────────────────────────────────
    # SQLite: strftime('%H', created_at)
    hour_rows = (await db.execute(
        select(
            func.cast(func.strftime("%H", Message.created_at), Integer).label("hour"),
            func.count(Message.id).label("cnt"),
        )
        .where(Message.created_at.isnot(None))
        .group_by("hour")
        .order_by("hour")
    )).all()
    hour_map = {r.hour: r.cnt for r in hour_rows}
    peak_hours = [{"hour": h, "count": hour_map.get(h, 0)} for h in range(24)]

    # ── 7. Mode effectiveness ─────────────────────────────
    mode_eff_rows = (await db.execute(
        select(
            Conversation.mode,
            func.avg(Message.confidence).label("avg_conf"),
            func.count(Message.id).label("msg_count"),
        )
        .select_from(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.confidence.isnot(None))
        .group_by(Conversation.mode)
        .order_by(func.avg(Message.confidence).desc())
    )).all()
    mode_effectiveness = [
        {
            "mode": r.mode,
            "avg_confidence": round(r.avg_conf, 4) if r.avg_conf else None,
            "message_count": r.msg_count,
        }
        for r in mode_eff_rows
    ]

    # ── 8. Feedback by mode ───────────────────────────────
    fb_rows = (await db.execute(
        select(
            Conversation.mode,
            func.sum(case((Message.feedback == "good", 1), else_=0)).label("good"),
            func.sum(case((Message.feedback == "bad", 1), else_=0)).label("bad"),
            func.count(Message.id).label("total"),
        )
        .select_from(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.feedback.isnot(None))
        .group_by(Conversation.mode)
    )).all()
    feedback_by_mode = [
        {
            "mode": r.mode,
            "good": r.good,
            "bad": r.bad,
            "total": r.total,
            "ratio": round(r.good / r.total, 4) if r.total > 0 else None,
        }
        for r in fb_rows
    ]

    # ── 9. Course engagement ─────────────────────────────
    course_eng_rows = (await db.execute(
        select(
            Course.id, Course.name, Course.code,
            func.count(func.distinct(Conversation.id)).label("conv_count"),
            func.count(func.distinct(Message.id)).label("msg_count"),
            func.count(func.distinct(Conversation.user_id)).label("user_count"),
        )
        .select_from(Course)
        .outerjoin(Conversation, Conversation.course_id == Course.id)
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .group_by(Course.id)
        .order_by(func.count(func.distinct(Message.id)).desc())
    )).all()
    course_engagement = [
        {
            "course_id": str(r.id),
            "course_name": r.name,
            "course_code": r.code,
            "conversations": r.conv_count,
            "messages": r.msg_count,
            "users": r.user_count,
        }
        for r in course_eng_rows
    ]

    # ── 10. File type distribution ───────────────────────
    ft_rows = (await db.execute(
        select(Document.file_type, func.count(Document.id).label("cnt"), func.sum(Document.file_size).label("total_bytes"))
        .group_by(Document.file_type)
        .order_by(func.count(Document.id).desc())
    )).all()
    file_type_distribution = [
        {
            "file_type": r.file_type or "unknown",
            "count": r.cnt,
            "total_bytes": r.total_bytes or 0,
        }
        for r in ft_rows
    ]

    # ── 11. Plan utilization ─────────────────────────────
    plan_rows = (await db.execute(
        select(
            func.coalesce(Subscription.plan, "free").label("plan"),
            func.count(func.distinct(Organization.id)).label("org_count"),
            func.count(func.distinct(OrganizationMember.user_id)).label("user_count"),
            func.sum(Document.file_size).label("storage_bytes"),
        )
        .select_from(Organization)
        .outerjoin(Subscription, Subscription.organization_id == Organization.id)
        .outerjoin(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .outerjoin(User, User.id == OrganizationMember.user_id)
        .outerjoin(Document, Document.owner_id == User.id)
        .group_by(func.coalesce(Subscription.plan, "free"))
        .order_by(func.count(func.distinct(Organization.id)).desc())
    )).all()
    plan_utilization = [
        {
            "plan": r.plan,
            "organizations": r.org_count,
            "users": r.user_count,
            "storage_bytes": r.storage_bytes or 0,
        }
        for r in plan_rows
    ]

    # ── 12. Storage per user (top 10) ────────────────────
    top_storage_rows = (await db.execute(
        select(User.id, User.full_name, User.email, func.coalesce(func.sum(Document.file_size), 0).label("total_bytes"))
        .join(Document, Document.owner_id == User.id)
        .group_by(User.id)
        .order_by(func.coalesce(func.sum(Document.file_size), 0).desc())
        .limit(10)
    )).all()
    storage_per_user = [
        {
            "user_id": str(r.id), "full_name": r.full_name, "email": r.email,
            "storage_bytes": r.total_bytes,
        }
        for r in top_storage_rows
    ]

    # ── 13. Ingestion pipeline ───────────────────────────
    total_docs = (await db.execute(select(func.count(Document.id)))).scalar() or 0
    failed_docs = (await db.execute(
        select(func.count(Document.id)).where(Document.status == "failed")
    )).scalar() or 0
    completed_docs = (await db.execute(
        select(func.count(Document.id)).where(Document.status == "completed")
    )).scalar() or 0
    processing_docs = (await db.execute(
        select(func.count(Document.id)).where(Document.status == "processing")
    )).scalar() or 0

    # Avg processing time: look at docs with completed_at and created_at
    avg_proc_time = (await db.execute(
        select(func.avg(
            func.julianday(Document.updated_at) - func.julianday(Document.created_at)
        ) * 86400).where(Document.status == "completed", Document.updated_at.isnot(None))
    )).scalar()
    avg_processing_seconds = round(avg_proc_time, 1) if avg_proc_time else None

    # Documents processed in last 7 days
    week_ago = now - timedelta(days=7)
    recent_total = (await db.execute(
        select(func.count(Document.id)).where(Document.created_at >= week_ago)
    )).scalar() or 0
    recent_failed = (await db.execute(
        select(func.count(Document.id)).where(Document.status == "failed", Document.created_at >= week_ago)
    )).scalar() or 0

    return {
        "churn": {
            "30d": churn_30,
            "60d": churn_60,
            "90d": churn_90,
            "total_users_with_messages": total_users_with_msgs,
        },
        "power_users": {
            "by_messages": power_by_msgs,
            "by_tokens": power_by_tokens,
            "by_conversations": power_by_convs,
        },
        "popular_content": popular_content,
        "slow_queries": {
            "p95_ms": p95_val,
            "total_slow": len(slow_query_samples),
            "samples": slow_query_samples,
        },
        "low_confidence": {
            "total": low_conf_count,
            "samples": low_confidence_samples,
        },
        "peak_hours": peak_hours,
        "mode_effectiveness": mode_effectiveness,
        "feedback_by_mode": feedback_by_mode,
        "course_engagement": course_engagement,
        "file_type_distribution": file_type_distribution,
        "plan_utilization": plan_utilization,
        "storage_per_user": storage_per_user,
        "ingestion_pipeline": {
            "total_documents": total_docs,
            "by_status": {
                "completed": completed_docs,
                "processing": processing_docs,
                "failed": failed_docs,
                "pending": total_docs - completed_docs - processing_docs - failed_docs,
            },
            "failure_rate_pct": round(failed_docs / total_docs * 100, 2) if total_docs > 0 else 0,
            "avg_processing_seconds": avg_processing_seconds,
            "recent_7d": {
                "total": recent_total,
                "failed": recent_failed,
                "failure_rate_pct": round(recent_failed / recent_total * 100, 2) if recent_total > 0 else 0,
            },
        },
    }


# ── Courses ────────────────────────────────────────────────

@router.get("/courses")
async def admin_courses(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=100),
    sort_by: str = Query("created_at", pattern=r"^(created_at|name|code|semester)$"),
    sort_dir: str = Query("desc", pattern=r"^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base = select(Course).options(
        joinedload(Course.owner),
        selectinload(Course.members),
        selectinload(Course.documents),
    )
    count_base = select(func.count(Course.id))

    if search:
        pattern = f"%{search}%"
        base = base.where(Course.name.ilike(pattern) | Course.code.ilike(pattern) | Course.professor.ilike(pattern))
        count_base = count_base.where(Course.name.ilike(pattern) | Course.code.ilike(pattern) | Course.professor.ilike(pattern))

    sort_col = getattr(Course, sort_by)
    order = sort_col.asc() if sort_dir == "asc" else sort_col.desc()
    base = base.order_by(order).offset((page - 1) * per_page).limit(per_page)

    total = (await db.execute(count_base)).scalar() or 0
    result = await db.execute(base)
    courses = result.unique().scalars().all()

    # Count conversations per course
    course_ids = [c.id for c in courses]
    conv_counts = {}
    if course_ids:
        conv_rows = (await db.execute(
            select(Conversation.course_id, func.count(Conversation.id).label("count"))
            .where(Conversation.course_id.in_(course_ids))
            .group_by(Conversation.course_id)
        )).all()
        conv_counts = {r.course_id: r.count for r in conv_rows}

    return {
        "courses": [
            {
                "id": c.id,
                "name": c.name,
                "code": c.code,
                "description": c.description,
                "semester": c.semester,
                "year": c.year,
                "department": c.department,
                "professor": c.professor,
                "color": c.color,
                "icon": c.icon,
                "is_active": c.is_active,
                "is_public": c.is_public,
                "tags": c.tags,
                "owner_id": c.owner_id,
                "owner_name": c.owner.full_name if c.owner else None,
                "owner_email": c.owner.email if c.owner else None,
                "member_count": len(c.members) if c.members else 0,
                "document_count": len(c.documents) if c.documents else 0,
                "conversation_count": conv_counts.get(c.id, 0),
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in courses
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/courses/{course_id}")
async def admin_course_detail(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(Course)
        .where(Course.id == course_id)
        .options(
            joinedload(Course.owner),
            selectinload(Course.members).joinedload(UserCourse.user),
            selectinload(Course.documents).joinedload(Document.owner),
        )
    )
    course = result.unique().scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Conversations
    conv_rows = (await db.execute(
        select(Conversation)
        .where(Conversation.course_id == course_id)
        .order_by(Conversation.created_at.desc())
        .limit(50)
    )).scalars().all()

    # Message stats per course
    course_conv_ids = [c.id for c in conv_rows]
    msg_count = 0
    if course_conv_ids:
        msg_count = (await db.execute(
            select(func.count(Message.id))
            .where(Message.conversation_id.in_(course_conv_ids))
        )).scalar() or 0

    return {
        "id": course.id,
        "name": course.name,
        "code": course.code,
        "description": course.description,
        "semester": course.semester,
        "year": course.year,
        "department": course.department,
        "professor": course.professor,
        "color": course.color,
        "icon": course.icon,
        "is_active": course.is_active,
        "is_public": course.is_public,
        "tags": course.tags,
        "owner": {"id": course.owner.id, "full_name": course.owner.full_name, "email": course.owner.email} if course.owner else None,
        "members": [
            {
                "user_id": m.user_id,
                "name": m.user.full_name if m.user else None,
                "email": m.user.email if m.user else None,
                "role": m.role,
                "joined_at": m.joined_at.isoformat(),
            }
            for m in (course.members or [])
        ],
        "documents": [
            {
                "id": d.id,
                "filename": d.original_filename,
                "file_type": d.file_type,
                "file_size": d.file_size,
                "status": d.status,
                "owner_name": d.owner.full_name if d.owner else None,
                "total_chunks": d.total_chunks,
                "created_at": d.created_at.isoformat(),
            }
            for d in (course.documents or [])
        ],
        "conversations": [
            {
                "id": c.id,
                "title": c.title,
                "mode": c.mode,
                "user_id": c.user_id,
                "is_bookmarked": c.is_bookmarked,
                "created_at": c.created_at.isoformat(),
            }
            for c in conv_rows
        ],
        "message_count": msg_count,
        "created_at": course.created_at.isoformat(),
        "updated_at": course.updated_at.isoformat(),
    }


# ── Conversations ──────────────────────────────────────────

@router.get("/conversations")
async def admin_conversations(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=100),
    mode: str = Query("", max_length=50),
    course_id: str = Query("", max_length=36),
    sort_by: str = Query("created_at", pattern=r"^(created_at|title|mode|message_count)$"),
    sort_dir: str = Query("desc", pattern=r"^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base = select(Conversation).options(joinedload(Conversation.user))
    count_base = select(func.count(Conversation.id))

    if search:
        pattern = f"%{search}%"
        base = base.where(Conversation.title.ilike(pattern))
        count_base = count_base.where(Conversation.title.ilike(pattern))
    if mode:
        base = base.where(Conversation.mode == mode)
        count_base = count_base.where(Conversation.mode == mode)
    if course_id:
        base = base.where(Conversation.course_id == course_id)
        count_base = count_base.where(Conversation.course_id == course_id)

    total = (await db.execute(count_base)).scalar() or 0

    sort_col = getattr(Conversation, sort_by) if sort_by != "message_count" else Conversation.created_at
    order = sort_col.asc() if sort_dir == "asc" else sort_col.desc()
    base = base.order_by(order).offset((page - 1) * per_page).limit(per_page)

    result = await db.execute(base)
    convs = result.unique().scalars().all()

    # Get message counts per conversation
    conv_ids = [c.id for c in convs]
    msg_counts = {}
    if conv_ids:
        msg_rows = (await db.execute(
            select(Message.conversation_id, func.count(Message.id).label("count"))
            .where(Message.conversation_id.in_(conv_ids))
            .group_by(Message.conversation_id)
        )).all()
        msg_counts = {r.conversation_id: r.count for r in msg_rows}

        # Get token/latency/confidence stats per conversation
        stat_rows = (await db.execute(
            select(
                Message.conversation_id,
                func.sum(Message.tokens_used).label("total_tokens"),
                func.avg(Message.latency_ms).label("avg_latency"),
                func.avg(Message.confidence).label("avg_confidence"),
                func.sum(case((Message.feedback == "good", 1), else_=0)).label("good_count"),
                func.sum(case((Message.feedback == "bad", 1), else_=0)).label("bad_count"),
            )
            .where(Message.conversation_id.in_(conv_ids))
            .group_by(Message.conversation_id)
        )).all()
        stat_map = {
            r.conversation_id: {
                "total_tokens": r.total_tokens or 0,
                "avg_latency": round(r.avg_latency, 1) if r.avg_latency else None,
                "avg_confidence": round(r.avg_confidence, 3) if r.avg_confidence else None,
                "good_count": r.good_count or 0,
                "bad_count": r.bad_count or 0,
            }
            for r in stat_rows
        }
    else:
        stat_map = {}

    return {
        "conversations": [
            {
                "id": c.id,
                "title": c.title,
                "mode": c.mode,
                "course_id": c.course_id,
                "is_bookmarked": c.is_bookmarked,
                "user_id": c.user_id,
                "user_name": c.user.full_name if c.user else None,
                "user_email": c.user.email if c.user else None,
                "message_count": msg_counts.get(c.id, 0),
                "total_tokens": (stat_map.get(c.id) or {}).get("total_tokens", 0),
                "avg_latency": (stat_map.get(c.id) or {}).get("avg_latency"),
                "avg_confidence": (stat_map.get(c.id) or {}).get("avg_confidence"),
                "good_count": (stat_map.get(c.id) or {}).get("good_count", 0),
                "bad_count": (stat_map.get(c.id) or {}).get("bad_count", 0),
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in convs
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/conversations/{conv_id}")
async def admin_conversation_detail(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv_id)
        .options(joinedload(Conversation.user), selectinload(Conversation.messages))
    )
    conv = result.unique().scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {
        "id": conv.id,
        "title": conv.title,
        "mode": conv.mode,
        "course_id": conv.course_id,
        "is_bookmarked": conv.is_bookmarked,
        "user": {
            "id": conv.user.id,
            "full_name": conv.user.full_name,
            "email": conv.user.email,
        } if conv.user else None,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "citations": m.citations,
                "meta": m.meta,
                "confidence": m.confidence,
                "latency_ms": m.latency_ms,
                "tokens_used": m.tokens_used,
                "is_bookmarked": m.is_bookmarked,
                "feedback": m.feedback,
                "created_at": m.created_at.isoformat(),
            }
            for m in (conv.messages or [])
        ],
        "message_count": len(conv.messages) if conv.messages else 0,
        "total_tokens": sum((m.tokens_used or 0) for m in (conv.messages or [])),
        "avg_latency": round(sum((m.latency_ms or 0) for m in (conv.messages or [])) / max(len([m for m in (conv.messages or []) if m.latency_ms]), 1), 1),
        "avg_confidence": round(sum((m.confidence or 0) for m in (conv.messages or [])) / max(len([m for m in (conv.messages or []) if m.confidence]), 1), 3),
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
    }


# ── Bookmarks ──────────────────────────────────────────────

@router.get("/bookmarks")
async def admin_bookmarks(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    base = select(Bookmark).options(joinedload(Bookmark.user))
    count_base = select(func.count(Bookmark.id))

    if search:
        pattern = f"%{search}%"
        base = base.where(Bookmark.title.ilike(pattern) | Bookmark.content.ilike(pattern))
        count_base = count_base.where(Bookmark.title.ilike(pattern) | Bookmark.content.ilike(pattern))

    total = (await db.execute(count_base)).scalar() or 0
    result = await db.execute(base.order_by(Bookmark.created_at.desc()).offset((page - 1) * per_page).limit(per_page))
    bookmarks = result.unique().scalars().all()

    return {
        "bookmarks": [
            {
                "id": b.id,
                "title": b.title,
                "content_preview": b.content[:300],
                "source_info": b.source_info,
                "tags": b.tags,
                "user_id": b.user_id,
                "user_name": b.user.full_name if b.user else None,
                "user_email": b.user.email if b.user else None,
                "created_at": b.created_at.isoformat(),
            }
            for b in bookmarks
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
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

    await write_audit_log(
        db=db,
        action=f"batch_{action}_users",
        resource_type="user",
        user_id=admin.id,
        details={"count": results["succeeded"], "action": action, "user_ids": user_ids}
    )

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
    if resource not in ("users", "documents", "organizations", "audit", "courses", "conversations", "bookmarks"):
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

    elif resource == "courses":
        writer.writerow(["id", "name", "code", "semester", "year", "department", "professor", "is_active", "is_public", "owner_id", "owner_email", "created_at"])
        base = select(Course).options(joinedload(Course.owner))
        if search:
            base = base.where(Course.name.ilike(f"%{search}%") | Course.code.ilike(f"%{search}%"))
        rows = (await db.execute(base.order_by(Course.created_at.desc()).limit(5000))).scalars().all()
        for c in rows:
            writer.writerow([c.id, c.name, c.code, c.semester, c.year, c.department, c.professor, c.is_active, c.is_public, c.owner_id, c.owner.email if c.owner else "", c.created_at.isoformat()])

    elif resource == "conversations":
        writer.writerow(["id", "title", "mode", "course_id", "is_bookmarked", "user_id", "created_at"])
        base = select(Conversation)
        if search:
            base = base.where(Conversation.title.ilike(f"%{search}%"))
        rows = (await db.execute(base.order_by(Conversation.created_at.desc()).limit(5000))).scalars().all()
        for c in rows:
            writer.writerow([c.id, c.title, c.mode, c.course_id or "", c.is_bookmarked, c.user_id, c.created_at.isoformat()])

    elif resource == "bookmarks":
        writer.writerow(["id", "title", "user_id", "source_info", "tags", "created_at"])
        base = select(Bookmark)
        if search:
            base = base.where(Bookmark.title.ilike(f"%{search}%"))
        rows = (await db.execute(base.order_by(Bookmark.created_at.desc()).limit(5000))).scalars().all()
        for b in rows:
            writer.writerow([b.id, b.title, b.user_id, json.dumps(b.source_info) if b.source_info else "", json.dumps(b.tags) if b.tags else "", b.created_at.isoformat()])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={resource}_{datetime.utcnow().date().isoformat()}.csv"},
    )


# ── Security & Access Management ───────────────────────────

@router.post("/users/{user_id}/impersonate")
async def admin_impersonate_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin endpoint to login/impersonate another user. Returns access token."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Cannot impersonate admin users")

    # Generate token for this user
    from app.auth.security import create_access_token
    token = create_access_token({"sub": user.id})

    # Log audit event
    await write_audit_log(
        db=db,
        action="impersonate_user",
        resource_type="user",
        resource_id=user_id,
        user_id=admin.id,
        details={"impersonated_email": user.email}
    )
    await db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "role": user.role
        }
    }


@router.get("/organizations/{org_id}/feature-flags")
async def get_org_feature_flags(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Fetch feature flags for an organization."""
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    settings_dict = org.settings or {}
    flags = settings_dict.get("feature_flags", {
        "enable_ocr": True,
        "enable_web_search": True,
        "custom_models": False,
        "voice_chat": False,
        "sandbox_mode": False
    })
    return {"organization_id": org_id, "feature_flags": flags}


class UpdateFeatureFlagsRequest(BaseModel):
    feature_flags: dict


@router.put("/organizations/{org_id}/feature-flags")
async def update_org_feature_flags(
    org_id: str,
    req: UpdateFeatureFlagsRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Update feature flags for an organization."""
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    org_settings = org.settings or {}
    org_settings["feature_flags"] = req.feature_flags
    org.settings = org_settings
    
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(org, "settings")
    await db.commit()
    
    await write_audit_log(
        db=db,
        action="update_feature_flags",
        resource_type="organization",
        resource_id=org_id,
        user_id=admin.id,
        details={"feature_flags": req.feature_flags}
    )
    await db.commit()
    
    return {"ok": True, "feature_flags": org.settings["feature_flags"]}


@router.get("/api-keys")
async def get_all_api_keys(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """List all API keys."""
    result = await db.execute(select(APIKey))
    keys = result.scalars().all()
    return [
        {
            "id": k.id,
            "name": k.name,
            "key_prefix": k.key_prefix,
            "owner_id": k.owner_id,
            "organization_id": k.organization_id,
            "is_active": k.is_active,
            "created_at": k.created_at.isoformat() if k.created_at else None,
            "expires_at": k.expires_at.isoformat() if k.expires_at else None,
            "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None
        }
        for k in keys
    ]


class CreateAPIKeyRequest(BaseModel):
    name: str
    organization_id: Optional[str] = None
    owner_id: str


@router.post("/api-keys")
async def create_api_key(
    req: CreateAPIKeyRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Create a new API Key for access."""
    import secrets
    import hashlib
    raw_key = f"cr_live_{secrets.token_hex(20)}"
    hashed = hashlib.sha256(raw_key.encode()).hexdigest()
    
    new_key = APIKey(
        name=req.name,
        key_prefix=raw_key[:12],
        hashed_key=hashed,
        owner_id=req.owner_id,
        organization_id=req.organization_id,
        is_active=True
    )
    db.add(new_key)
    await db.commit()
    
    await write_audit_log(
        db=db,
        action="create_api_key",
        resource_type="api_key",
        resource_id=new_key.id,
        user_id=admin.id,
        details={"name": req.name, "organization_id": req.organization_id}
    )
    await db.commit()
    
    return {
        "id": new_key.id,
        "name": new_key.name,
        "key_prefix": new_key.key_prefix,
        "raw_key": raw_key,
        "created_at": new_key.created_at.isoformat() if new_key.created_at else None
    }


@router.put("/api-keys/{key_id}/toggle")
async def toggle_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Toggle API Key active state."""
    result = await db.execute(select(APIKey).where(APIKey.id == key_id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")
    
    key.is_active = not key.is_active
    await db.commit()
    
    await write_audit_log(
        db=db,
        action="toggle_api_key",
        resource_type="api_key",
        resource_id=key_id,
        user_id=admin.id,
        details={"is_active": key.is_active}
    )
    await db.commit()
    
    return {"ok": True, "is_active": key.is_active}


@router.delete("/api-keys/{key_id}")
async def delete_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Revoke/Delete an API key."""
    result = await db.execute(select(APIKey).where(APIKey.id == key_id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")
    
    await db.delete(key)
    await db.commit()
    
    await write_audit_log(
        db=db,
        action="delete_api_key",
        resource_type="api_key",
        resource_id=key_id,
        user_id=admin.id,
        details={"name": key.name}
    )
    await db.commit()
    return {"ok": True}


@router.get("/webhook-subscriptions")
async def list_webhook_subscriptions(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """List all webhook subscriptions."""
    result = await db.execute(select(WebhookSubscription))
    subs = result.scalars().all()
    return [
        {
            "id": s.id,
            "url": s.url,
            "event_types": s.event_types,
            "organization_id": s.organization_id,
            "is_active": s.is_active,
            "created_at": s.created_at.isoformat() if s.created_at else None
        }
        for s in subs
    ]


class CreateWebhookSubscriptionRequest(BaseModel):
    url: str
    event_types: list[str]
    organization_id: Optional[str] = None


@router.post("/webhook-subscriptions")
async def create_webhook_subscription(
    req: CreateWebhookSubscriptionRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Create a new webhook subscription."""
    import secrets
    secret = f"whsec_{secrets.token_hex(16)}"
    new_sub = WebhookSubscription(
        url=req.url,
        secret=secret,
        event_types=req.event_types,
        organization_id=req.organization_id,
        is_active=True
    )
    db.add(new_sub)
    await db.commit()
    
    await write_audit_log(
        db=db,
        action="create_webhook",
        resource_type="webhook",
        resource_id=new_sub.id,
        user_id=admin.id,
        details={"url": req.url, "event_types": req.event_types}
    )
    await db.commit()
    
    return {
        "id": new_sub.id,
        "url": new_sub.url,
        "secret": new_sub.secret,
        "event_types": new_sub.event_types,
        "created_at": new_sub.created_at.isoformat() if new_sub.created_at else None
    }


@router.put("/webhook-subscriptions/{sub_id}/toggle")
async def toggle_webhook_subscription(
    sub_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Toggle a webhook subscription active state."""
    result = await db.execute(select(WebhookSubscription).where(WebhookSubscription.id == sub_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Webhook subscription not found")
    
    sub.is_active = not sub.is_active
    await db.commit()
    
    await write_audit_log(
        db=db,
        action="toggle_webhook",
        resource_type="webhook",
        resource_id=sub_id,
        user_id=admin.id,
        details={"is_active": sub.is_active}
    )
    await db.commit()
    
    return {"ok": True, "is_active": sub.is_active}


@router.delete("/webhook-subscriptions/{sub_id}")
async def delete_webhook_subscription(
    sub_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Delete a webhook subscription."""
    result = await db.execute(select(WebhookSubscription).where(WebhookSubscription.id == sub_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Webhook subscription not found")
    
    await db.delete(sub)
    await db.commit()
    
    await write_audit_log(
        db=db,
        action="delete_webhook",
        resource_type="webhook",
        resource_id=sub_id,
        user_id=admin.id,
        details={"url": sub.url}
    )
    await db.commit()
    
    return {"ok": True}


DEFAULT_ROLE_PERMISSIONS = {
    "student": ["documents:read", "chats:create"],
    "ta": ["documents:read", "chats:create", "courses:read"],
    "faculty": ["documents:read", "documents:write", "chats:create", "courses:read", "courses:write", "web_search:use"],
    "admin": [
        "documents:read", "documents:write", "documents:delete",
        "courses:read", "courses:write", "chats:create", "chats:delete",
        "web_search:use", "custom_models:use", "org:edit_settings", "org:manage_billing"
    ]
}


@router.get("/security/roles")
async def get_role_permissions(
    admin: User = Depends(require_admin),
):
    """Get the visual RBAC role-permission matrix."""
    from app.services.cache import cache_get
    matrix = await cache_get("security:role_permissions")
    if not matrix:
        matrix = DEFAULT_ROLE_PERMISSIONS
    return matrix


class UpdateRolePermissionsRequest(BaseModel):
    matrix: dict


@router.post("/security/roles")
async def update_role_permissions(
    req: UpdateRolePermissionsRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Update the RBAC role-permission matrix."""
    from app.services.cache import cache_set
    await cache_set("security:role_permissions", req.matrix, ttl=31536000)
    
    await write_audit_log(
        db=db,
        action="update_rbac",
        resource_type="security",
        resource_id="rbac_matrix",
        user_id=admin.id,
        details={"matrix": req.matrix}
    )
    await db.commit()
    
    return {"ok": True, "matrix": req.matrix}


# ── WebSocket Events ───────────────────────────────────────

@router.websocket("/ws/events")
async def admin_ws_events(ws: WebSocket):
    await ws.accept()
    token = ws.headers.get("authorization") or ws.query_params.get("token", "")
    token = token.replace("Bearer ", "")
    payload = decode_token(token)
    if not payload:
        await ws.send_json({"event": "error", "data": {"detail": "Admin authentication required"}})
        await ws.close()
        return

    user_id = payload.get("sub")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or user.role != "admin":
            await ws.send_json({"event": "error", "data": {"detail": "Admin authentication required"}})
            await ws.close()
            return

    await admin_ws_manager.connect(ws)
    logger.info("Admin WS connected", admin_id=payload.get("sub"))

    # ── Push initial snapshot on connect ─────────────────
    try:
        async with AsyncSessionLocal() as db:
            # Quick stats snapshot
            user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
            doc_count = (await db.execute(select(func.count(Document.id)))).scalar() or 0
            failed_docs = (await db.execute(
                select(func.count(Document.id)).where(Document.status == "failed")
            )).scalar() or 0
            msg_count = (await db.execute(select(func.count(Message.id)))).scalar() or 0
            storage_bytes = (await db.execute(select(func.sum(Document.file_size)))).scalar() or 0

            await ws.send_json({
                "event": "snapshot",
                "data": {
                    "users": user_count,
                    "documents": doc_count,
                    "failed_docs": failed_docs,
                    "messages": msg_count,
                    "storage_bytes": storage_bytes,
                    "ts": datetime.utcnow().isoformat() + "Z",
                },
            })

            # Recent audit tail (last 20 entries)
            recent_audit = (await db.execute(
                select(AuditLog).order_by(AuditLog.created_at.desc()).limit(20)
            )).scalars().all()

            await ws.send_json({
                "event": "audit:tail",
                "data": {
                    "entries": [
                        {
                            "id": e.id,
                            "action": e.action,
                            "resource_type": e.resource_type,
                            "resource_id": e.resource_id,
                            "user_id": e.user_id,
                            "details": e.details,
                            "ip_address": e.ip_address,
                            "created_at": e.created_at.isoformat() + "Z",
                        }
                        for e in reversed(recent_audit)
                    ]
                },
            })

            # Run alert check and emit any active alerts
            from app.services.event_bus import check_and_emit_alerts
            latency_rows = (await db.execute(
                select(Message.latency_ms)
                .where(Message.latency_ms.isnot(None))
                .order_by(Message.latency_ms)
            )).scalars().all()
            lat_count = len(latency_rows)
            await check_and_emit_alerts({
                "failed_ingestions": failed_docs,
                "documents": doc_count,
                "storage_bytes": storage_bytes or 0,
                "latency_p95": latency_rows[int(lat_count * 0.95)] if lat_count > 0 else None,
            })

    except Exception as e:
        logger.warning("WS initial snapshot failed", error=str(e))

    # ── Message loop ──────────────────────────────────────
    try:
        while True:
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_json({"event": "pong"})
            elif data == "refresh:stats":
                # Admin requested a stats refresh
                try:
                    async with AsyncSessionLocal() as db:
                        user_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
                        doc_count = (await db.execute(select(func.count(Document.id)))).scalar() or 0
                        failed_docs = (await db.execute(
                            select(func.count(Document.id)).where(Document.status == "failed")
                        )).scalar() or 0
                        msg_count = (await db.execute(select(func.count(Message.id)))).scalar() or 0
                        storage_bytes = (await db.execute(select(func.sum(Document.file_size)))).scalar() or 0
                        await ws.send_json({
                            "event": "snapshot",
                            "data": {
                                "users": user_count,
                                "documents": doc_count,
                                "failed_docs": failed_docs,
                                "messages": msg_count,
                                "storage_bytes": storage_bytes,
                                "ts": datetime.utcnow().isoformat() + "Z",
                            },
                        })
                except Exception as e:
                    logger.warning("WS refresh:stats failed", error=str(e))
    except WebSocketDisconnect:
        admin_ws_manager.disconnect(ws)
        logger.info("Admin WS disconnected")
    except Exception:
        admin_ws_manager.disconnect(ws)
