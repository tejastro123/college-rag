"""Hypothetical Document Embeddings (HyDE) for sparse/ambiguous queries."""
from __future__ import annotations

from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger
from .query_expansion import _call_llm

logger = get_logger(__name__)

# Query intents where HyDE is beneficial
HYDE_INTENTS = {"definition", "summary", "procedural"}

STYLE_PROMPTS = {
    "definition": "Write a clear, textbook-style definition and explanation of the concept.",
    "summary": "Write a concise summary covering the key points mentioned in the question.",
    "procedural": "Write step-by-step instructions explaining how to perform or understand the process.",
}


async def generate_hypothetical_document(query: str, intent: str) -> Optional[str]:
    """Generate a hypothetical ideal passage for the query, then return it as a search query."""
    if not settings.HYDE_ENABLED or intent not in HYDE_INTENTS:
        return None

    style = STYLE_PROMPTS.get(intent, "Write a factual passage that answers the question well.")

    prompt = (
        f"Generate a short, factual passage that would perfectly answer the following question.\n"
        f"{style}\n\n"
        f"Question: {query}\n\n"
        f"Passage:"
    )

    response = await _call_llm(prompt)
    if response and len(response) > 50:
        logger.debug("HyDE document generated", query=query[:50], intent=intent)
        return response
    return None
