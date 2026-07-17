"""System health and stats endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.config import settings
from app.db.database import get_db
from app.models.document import Document
from app.models.user import User
from app.models.conversation import Message
from app.auth.security import get_current_user

router = APIRouter(prefix="/system", tags=["System"])


@router.get("/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION, "app": settings.APP_NAME}


@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc_count = await db.execute(
        select(func.count(Document.id)).where(Document.owner_id == current_user.id)
    )
    msg_count = await db.execute(
        select(func.count(Message.id))
    )
    from app.embeddings.vector_store import get_vector_store
    try:
        vs = await get_vector_store()
        vec_stats = vs.get_collection_stats()
    except Exception:
        vec_stats = {"total_vectors": 0}

    return {
        "documents": doc_count.scalar() or 0,
        "messages": msg_count.scalar() or 0,
        "vector_store": vec_stats,
        "llm_provider": settings.LLM_PROVIDER,
        "llm_model": settings.active_llm_model,
    }
