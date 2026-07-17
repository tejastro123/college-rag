"""Admin dashboard endpoints — system stats, user management, document audit."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from app.db.database import get_db
from app.models.user import User
from app.models.document import Document
from app.models.conversation import Message, Conversation
from app.models.billing import UsageRecord
from app.models.organization import Organization, OrganizationMember
from app.auth.security import get_current_user

router = APIRouter(prefix="/admin", tags=["Admin"])


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


@router.get("/stats")
async def admin_stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user_count = await db.execute(select(func.count(User.id)))
    org_count = await db.execute(select(func.count(Organization.id)))
    doc_count = await db.execute(select(func.count(Document.id)))
    msg_count = await db.execute(select(func.count(Message.id)))

    today = datetime.utcnow().date()
    week_ago = today - timedelta(days=7)
    usage_result = await db.execute(
        select(func.sum(UsageRecord.api_calls), func.sum(UsageRecord.tokens_used))
        .where(UsageRecord.date >= week_ago)
    )
    usage = usage_result.one()

    return {
        "users": user_count.scalar() or 0,
        "organizations": org_count.scalar() or 0,
        "documents": doc_count.scalar() or 0,
        "messages": msg_count.scalar() or 0,
        "api_calls_7d": usage[0] or 0,
        "tokens_used_7d": usage[1] or 0,
    }


@router.get("/users")
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    query = select(User)
    if search:
        query = query.where(
            User.email.ilike(f"%{search}%") | User.username.ilike(f"%{search}%")
        )
    query = query.order_by(User.created_at.desc()).offset((page - 1) * per_page).limit(per_page)

    count_query = select(func.count(User.id))
    if search:
        count_query = count_query.where(
            User.email.ilike(f"%{search}%") | User.username.ilike(f"%{search}%")
        )
    total = await db.execute(count_query)
    total_count = total.scalar() or 0

    result = await db.execute(query)
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
                "is_active": u.is_active,
                "is_verified": u.is_verified,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ],
        "total": total_count,
        "page": page,
        "per_page": per_page,
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    role: str = Query(None, pattern=r"^(student|ta|faculty|admin)$"),
    is_active: bool = Query(None),
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


@router.get("/documents")
async def admin_documents(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: str = Query("", alias="status"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    query = select(Document)
    if status_filter:
        query = query.where(Document.status == status_filter)
    query = query.order_by(Document.created_at.desc()).offset((page - 1) * per_page).limit(per_page)

    count_query = select(func.count(Document.id))
    if status_filter:
        count_query = count_query.where(Document.status == status_filter)
    total = await db.execute(count_query)
    total_count = total.scalar() or 0

    result = await db.execute(query)
    docs = result.scalars().all()

    return {
        "documents": [
            {
                "id": d.id,
                "filename": d.original_filename,
                "file_type": d.file_type,
                "file_size": d.file_size,
                "status": d.status,
                "owner_id": d.owner_id,
                "total_chunks": d.total_chunks,
                "created_at": d.created_at.isoformat(),
                "indexed_at": d.indexed_at.isoformat() if d.indexed_at else None,
            }
            for d in docs
        ],
        "total": total_count,
        "page": page,
        "per_page": per_page,
    }


@router.get("/organizations")
async def admin_organizations(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(Organization).order_by(Organization.created_at.desc()).limit(100)
    )
    orgs = result.scalars().all()
    return [
        {
            "id": o.id,
            "name": o.name,
            "slug": o.slug,
            "owner_id": o.owner_id,
            "is_active": o.is_active,
            "member_count": len(o.members) if hasattr(o, "members") else 0,
            "created_at": o.created_at.isoformat(),
        }
        for o in orgs
    ]
