"""Shared httpx client for connection pooling."""
from __future__ import annotations

import httpx
from app.core.config import settings

_ollama_client: httpx.AsyncClient | None = None


def get_ollama_client() -> httpx.AsyncClient:
    global _ollama_client
    if _ollama_client is None:
        _ollama_client = httpx.AsyncClient(
            base_url=settings.OLLAMA_BASE_URL.rstrip("/"),
            timeout=httpx.Timeout(120.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )
    return _ollama_client


async def close_ollama_client():
    global _ollama_client
    if _ollama_client:
        await _ollama_client.aclose()
        _ollama_client = None
