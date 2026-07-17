"""Web and YouTube search endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.user import User
from app.auth.security import get_current_user
from app.services.web_search import (
    search_web, search_youtube, get_youtube_transcript, search_and_summarize,
)

router = APIRouter(prefix="/web-search", tags=["Web Search"])


class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    source: str
    total: int


@router.get("/web", response_model=SearchResponse)
async def web_search(
    q: str = Query(..., min_length=1, max_length=500),
    max_results: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
):
    results = await search_web(q, max_results)
    return SearchResponse(
        query=q,
        results=[SearchResult(**r) for r in results],
        source="web",
        total=len(results),
    )


@router.get("/youtube", response_model=SearchResponse)
async def youtube_search(
    q: str = Query(..., min_length=1, max_length=500),
    max_results: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
):
    results = await search_youtube(q, max_results)
    return SearchResponse(
        query=q,
        results=[SearchResult(**r) for r in results],
        source="youtube",
        total=len(results),
    )


@router.get("/youtube/transcript")
async def youtube_transcript(
    video_id: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
):
    transcript = await get_youtube_transcript(video_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found or unavailable")
    return {"video_id": video_id, "transcript": transcript, "length": len(transcript)}


@router.get("/all")
async def search_all_sources(
    q: str = Query(..., min_length=1, max_length=500),
    sources: str = Query("web,youtube"),
    max_results: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
):
    source_list = [s.strip() for s in sources.split(",")]
    results = await search_and_summarize(q, source_list, max_results)
    return {"query": q, "sources": source_list, "results": results}
