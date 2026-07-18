"""Admin endpoints for search tuning, analytics/metrics, and drift detection."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.models.user import User
from app.api.v1.endpoints.admin import require_admin
from app.services.search_tuning import (
    get_search_tuning_settings,
    update_search_tuning_setting,
    get_search_quality_metrics,
    calculate_embedding_drift,
)

router = APIRouter(prefix="/admin/search", tags=["Admin Search"])


class SearchTuningUpdate(BaseModel):
    hybrid_alpha: float = Field(..., ge=0.0, le=1.0)
    query_expansion_enabled: bool
    hyde_enabled: bool
    rerank_enabled: bool
    rerank_top_k: int = Field(..., ge=1, le=50)
    retrieval_top_k: int = Field(..., ge=1, le=100)


@router.get("/tuning")
async def get_tuning(
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    """Retrieve search tuning parameters."""
    return await get_search_tuning_settings(db)


@router.post("/tuning")
async def update_tuning(
    payload: SearchTuningUpdate,
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    """Update search tuning parameters."""
    try:
        await update_search_tuning_setting(db, "hybrid_alpha", str(payload.hybrid_alpha))
        await update_search_tuning_setting(db, "query_expansion_enabled", "true" if payload.query_expansion_enabled else "false")
        await update_search_tuning_setting(db, "hyde_enabled", "true" if payload.hyde_enabled else "false")
        await update_search_tuning_setting(db, "rerank_enabled", "true" if payload.rerank_enabled else "false")
        await update_search_tuning_setting(db, "rerank_top_k", str(payload.rerank_top_k))
        await update_search_tuning_setting(db, "retrieval_top_k", str(payload.retrieval_top_k))
        
        # Log to audit trail if function exists
        try:
            from app.api.v1.endpoints.admin import write_audit_log
            await write_audit_log(
                db,
                action="update_search_tuning",
                resource_type="search_settings",
                user_id=admin_user.id,
                details=payload.model_dump(),
            )
            await db.commit()
        except Exception:
            pass
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")
    return {"ok": True, "message": "Search parameters updated successfully"}


@router.get("/metrics")
async def get_metrics(
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    """Get search quality metrics (CTR, reformulation rate, average rank, trends)."""
    return await get_search_quality_metrics(db)


@router.get("/drift")
async def get_drift(
    db: AsyncSession = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    """Calculate and retrieve embedding drift detection score."""
    return await calculate_embedding_drift(db)
