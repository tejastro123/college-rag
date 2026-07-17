"""Full-text search across documents and courses."""
from __future__ import annotations

from typing import Optional
from sqlalchemy import select, or_, func, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from app.core.config import settings
from app.core.logging import get_logger
from app.models.document import Document
from app.models.course import Course, UserCourse
from app.services.cache import cache_get, cache_set

logger = get_logger(__name__)


async def search_documents(
    db: AsyncSession,
    query: str,
    owner_id: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int]:
    cache_key = f"search:docs:{query}:{owner_id or ''}:{limit}:{offset}"
    cached = await cache_get(cache_key)
    if cached:
        return cached["results"], cached["total"]

    conditions = [
        or_(
            Document.original_filename.ilike(f"%{query}%"),
            Document.title.ilike(f"%{query}%"),
            Document.author.ilike(f"%{query}%"),
            Document.subject.ilike(f"%{query}%"),
            Document.tags.cast(String).ilike(f"%{query}%"),
        )
    ]
    if owner_id:
        conditions.append(Document.owner_id == owner_id)

    stmt = select(Document).where(*conditions).order_by(Document.created_at.desc()).offset(offset).limit(limit)
    count_stmt = select(func.count(Document.id)).where(*conditions)

    total = await db.execute(count_stmt)
    total_count = total.scalar() or 0

    result = await db.execute(stmt)
    docs = result.scalars().all()

    results = [
        {
            "id": d.id,
            "filename": d.original_filename,
            "title": d.title or d.original_filename,
            "file_type": d.file_type,
            "file_size": d.file_size,
            "status": d.status,
            "author": d.author,
            "subject": d.subject,
            "language": d.language,
            "created_at": d.created_at.isoformat(),
        }
        for d in docs
    ]

    await cache_set(cache_key, {"results": results, "total": total_count}, ttl=60)
    return results, total_count


async def search_courses(
    db: AsyncSession,
    query: str,
    user_id: Optional[str] = None,
    limit: int = 20,
) -> list[dict]:
    cache_key = f"search:courses:{query}:{user_id or ''}:{limit}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    conditions = [
        or_(
            Course.name.ilike(f"%{query}%"),
            Course.code.ilike(f"%{query}%"),
            Course.description.ilike(f"%{query}%"),
            Course.professor.ilike(f"%{query}%"),
            Course.department.ilike(f"%{query}%"),
        )
    ]

    if user_id:
        conditions.append(
            Course.id.in_(
                select(UserCourse.course_id).where(UserCourse.user_id == user_id)
            )
        )

    stmt = select(Course).where(*conditions).order_by(Course.name.asc()).limit(limit)
    result = await db.execute(stmt)
    courses = result.scalars().all()

    results = [
        {
            "id": c.id,
            "name": c.name,
            "code": c.code,
            "description": c.description,
            "department": c.department,
            "professor": c.professor,
            "color": c.color,
            "created_at": c.created_at.isoformat(),
        }
        for c in courses
    ]

    await cache_set(cache_key, results, ttl=60)
    return results


async def search_all(
    db: AsyncSession,
    query: str,
    user_id: Optional[str] = None,
    limit: int = 10,
) -> dict:
    docs, doc_total = await search_documents(db, query, owner_id=user_id, limit=limit)
    courses = await search_courses(db, query, user_id=user_id, limit=limit)

    return {
        "documents": docs,
        "document_total": doc_total,
        "courses": courses,
    }
