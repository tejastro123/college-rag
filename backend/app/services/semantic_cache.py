"""Semantic cache for RAG responses — keyed by (query, course_id, mode, output_format)."""
from __future__ import annotations

import hashlib
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger
from app.services.cache import cache_get, cache_set, cache_delete_pattern

logger = get_logger(__name__)

CACHE_PREFIX = "rag:v2:"


def make_cache_key(
    query: str,
    course_id: Optional[str] = None,
    mode: str = "normal",
    output_format: str = "text",
    document_ids: Optional[list[str]] = None,
    doc_type_filter: Optional[str] = None,
) -> str:
    """Deterministic cache key from query parameters."""
    parts = [
        query.lower().strip(),
        course_id or "",
        mode,
        output_format,
        ",".join(sorted(document_ids)) if document_ids else "",
        doc_type_filter or "",
    ]
    raw = "|".join(parts)
    h = hashlib.md5(raw.encode()).hexdigest()
    return f"{CACHE_PREFIX}{course_id or 'all'}:{h}"


def make_invalidation_pattern(course_id: Optional[str] = None) -> str:
    """Redis key pattern to delete all cache entries for a course (or all if None)."""
    return f"{CACHE_PREFIX}{course_id or '*'}:*"


async def get_cached_response(
    query: str,
    course_id: Optional[str] = None,
    mode: str = "normal",
    output_format: str = "text",
    document_ids: Optional[list[str]] = None,
    doc_type_filter: Optional[str] = None,
) -> Optional[dict]:
    """Retrieve a cached RAG response. Returns dict or None."""
    key = make_cache_key(query, course_id, mode, output_format, document_ids, doc_type_filter)
    cached = await cache_get(key)
    if cached:
        logger.debug("Semantic cache hit", key=key)
    return cached


async def set_cached_response(
    response_dict: dict,
    query: str,
    course_id: Optional[str] = None,
    mode: str = "normal",
    output_format: str = "text",
    document_ids: Optional[list[str]] = None,
    doc_type_filter: Optional[str] = None,
) -> None:
    """Store a RAG response dict in cache."""
    key = make_cache_key(query, course_id, mode, output_format, document_ids, doc_type_filter)
    await cache_set(key, response_dict, ttl=settings.CACHE_TTL)
    logger.debug("Semantic cache set", key=key, ttl=settings.CACHE_TTL)


async def invalidate_course_cache(course_id: Optional[str] = None) -> None:
    """Clear all cached responses for a course (or all courses if None)."""
    pattern = make_invalidation_pattern(course_id)
    await cache_delete_pattern(pattern)
    logger.info("Semantic cache invalidated", pattern=pattern)
