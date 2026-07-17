"""Multi-query expansion using LLM for better retrieval recall."""
from __future__ import annotations

import re
from typing import Optional

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


async def _call_llm(prompt: str, system: str = "") -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})
            payload = {
                "model": settings.OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
                "options": {"temperature": 0.7, "num_predict": 500},
            }
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json().get("message", {}).get("content", "")
    except Exception as e:
        logger.warning("LLM call failed for query expansion", error=str(e))
        return None


async def expand_query(query: str) -> list[str]:
    """Generate alternative query phrasings. Returns [original, ...variants]."""
    if not settings.QUERY_EXPANSION_ENABLED:
        return [query]

    n = settings.QUERY_EXPANSION_VARIANTS
    prompt = (
        f"Generate {n} alternative versions of the given question. "
        "Each version must capture the same information need using different wording. "
        "Return one per line, numbered. Do not include any other text.\n\n"
        f"Original: {query}\n\nAlternatives:"
    )

    response = await _call_llm(prompt)
    if not response:
        return [query]

    alternatives = [query]
    for line in response.strip().split("\n"):
        line = re.sub(r"^\d+[\.\)]\s*", "", line).strip()
        line = re.sub(r'^["\'](.*)["\']$', r"\1", line.strip())
        if line and len(line) > 10:
            alternatives.append(line)

    logger.debug("Query expanded", original=query[:60], variants=len(alternatives))
    return alternatives
