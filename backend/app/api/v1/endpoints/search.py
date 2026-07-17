"""Full-text search endpoints for documents and courses."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.database import get_db
from app.models.user import User
from app.auth.security import get_current_user
from app.services.search import search_documents, search_courses, search_all

logger = get_logger(__name__)
router = APIRouter(prefix="/search", tags=["Search"])


@router.get("/")
async def global_search(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Search query is required")

    results = await search_all(db, q, user_id=current_user.id, limit=limit)
    return results


@router.get("/documents")
async def search_docs(
    q: str = Query(..., min_length=1, max_length=200),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results, total = await search_documents(
        db, q, owner_id=current_user.id,
        limit=per_page, offset=(page - 1) * per_page,
    )
    return {"results": results, "total": total, "page": page, "per_page": per_page}


@router.get("/courses")
async def search_crs(
    q: str = Query(..., min_length=1, max_length=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results = await search_courses(db, q, user_id=current_user.id)
    return results
