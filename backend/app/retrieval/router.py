"""
Query router — classifies intent, decides single-hop vs multi-hop, decomposes complex questions.
"""
from __future__ import annotations

import re
from typing import Optional

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Keywords suggesting a multi-hop (complex) question
MULTI_HOP_KEYWORDS = [
    "compare and contrast", "difference between", "similarities between",
    "how does", "why does", "what is the relationship",
    "explain the process of", "describe the steps",
    "what happens when", "what if",
    "analyze", "evaluate", "discuss",
]

# Keywords suggesting a single-hop (simple) question
SINGLE_HOP_KEYWORDS = [
    "what is", "define", "meaning", "definition",
    "who", "when", "where",
    "list", "name", "give examples",
    "formula", "equation",
    "summarize", "summary",
]


def _keyword_classify(query: str) -> Optional[str]:
    """Quick keyword-based classification. Returns 'single', 'multi', or None if ambiguous."""
    lower = query.lower().strip()
    has_multi = any(kw in lower for kw in MULTI_HOP_KEYWORDS)
    has_single = any(kw in lower for kw in SINGLE_HOP_KEYWORDS)

    # Multi-hop keywords take precedence when both match
    if has_multi:
        return "multi"
    if has_single:
        return "single"
    return None  # ambiguous — use LLM


async def _llm_classify(query: str) -> str:
    """Use LLM to classify query complexity."""
    prompt = (
        "You are a query router for a retrieval system. Classify the following question.\n\n"
        "Respond with exactly one word: 'single' or 'multi'.\n\n"
        "Rules:\n"
        "- single: The question asks about one concept, definition, fact, formula, or a straightforward explanation that can be found in one passage.\n"
        "- multi: The question compares, contrasts, evaluates, traces a multi-step process, asks 'how'/'why', requires combining information from multiple sources, or has multiple parts.\n\n"
        f"Question: {query}\n\n"
        "Classification:"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
            payload = {
                "model": settings.OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.0, "num_predict": 10},
            }
            response = await client.post(url, json=payload)
            response.raise_for_status()
            text = response.json().get("message", {}).get("content", "").strip().lower()
            if "multi" in text:
                return "multi"
            return "single"
    except Exception as e:
        logger.warning("LLM classify failed, defaulting to single", error=str(e))
        return "single"


async def classify(query: str) -> str:
    """Classify query as 'single' (single-hop) or 'multi' (multi-hop)."""
    keyword_result = _keyword_classify(query)
    if keyword_result:
        return keyword_result
    return await _llm_classify(query)


async def decompose(query: str) -> list[str]:
    """Decompose a complex question into simpler sub-questions."""
    prompt = (
        "Decompose the following complex question into 2-3 simpler sub-questions. "
        "Each sub-question must end with a question mark and cover ONE specific aspect. "
        "Return only the sub-questions, one per line, without numbers or prefixes.\n\n"
        f"Complex question: {query}\n\n"
        "Sub-questions:"
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
            payload = {
                "model": settings.OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": 300},
            }
            response = await client.post(url, json=payload)
            response.raise_for_status()
            text = response.json().get("message", {}).get("content", "")

        sub_questions = []
        for line in text.strip().split("\n"):
            line = line.strip()
            line = re.sub(r"^\d+[\.\)]\s*", "", line)
            line = re.sub(r'^[-*•]\s*', "", line)
            line = re.sub(r'^["\'](.*)["\']$', r"\1", line.strip())
            if line and len(line) > 10 and "?" in line:
                sub_questions.append(line)

        if not sub_questions:
            logger.warning("Decompose returned no valid sub-questions, using original")
            return [query]

        logger.info("Query decomposed", original=query[:60], sub_questions=len(sub_questions))
        return sub_questions

    except Exception as e:
        logger.warning("Query decomposition failed, falling back to original", error=str(e))
        return [query]
