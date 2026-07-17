"""Async Redis cache with JSON serialization."""
from __future__ import annotations

import json
from typing import Optional, Any
from datetime import timedelta

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_redis = None


async def get_redis():
    global _redis
    if _redis is None:
        try:
            import redis.asyncio as aioredis
            _redis = await aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_timeout=2,
            )
            await _redis.ping()
            logger.info("Redis connected")
        except Exception as e:
            logger.warning("Redis unavailable", error=str(e))
            return None
    return _redis


async def cache_get(key: str) -> Optional[Any]:
    r = await get_redis()
    if not r:
        return None
    try:
        val = await r.get(key)
        return json.loads(val) if val else None
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl: int = 300) -> None:
    r = await get_redis()
    if not r:
        return
    try:
        await r.setex(key, ttl, json.dumps(value, default=str))
    except Exception as e:
        logger.warning("Cache set failed", key=key, error=str(e))


async def cache_delete(key: str) -> None:
    r = await get_redis()
    if not r:
        return
    try:
        await r.delete(key)
    except Exception:
        pass


async def cache_delete_pattern(pattern: str) -> None:
    r = await get_redis()
    if not r:
        return
    try:
        cursor = 0
        while True:
            cursor, keys = await r.scan(cursor, match=pattern, count=100)
            if keys:
                await r.delete(*keys)
            if cursor == 0:
                break
    except Exception:
        pass
