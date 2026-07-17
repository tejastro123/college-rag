"""LLM-as-judge faithfulness scoring.""" 
from __future__ import annotations

from typing import Optional

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


async def _call_llm(prompt: str, temperature: float = 0.0) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
            payload = {
                "model": settings.OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": temperature, "num_predict": 100},
            }
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json().get("message", {}).get("content", "")
    except Exception as e:
        logger.warning("Faithfulness LLM call failed", error=str(e))
        return None


def _parse_score(text: str) -> float:
    """Extract a float score from LLM output (handles '0.8', 'Score: 0.75', etc.)."""
    import re
    match = re.search(r"(\d+\.\d+)", text)
    if match:
        val = float(match.group(1))
        return max(0.0, min(1.0, val))
    return 0.5


async def score_faithfulness(
    question: str,
    answer: str,
    context_chunks: list[str],
) -> float:
    """Use LLM to rate how well the answer is supported by the context (0-1)."""
    if not answer or not context_chunks:
        return 0.0

    context = "\n\n---\n\n".join(c[:2000] for c in context_chunks[:5])

    prompt = f"""You are evaluating a RAG system. Rate the faithfulness of the answer based solely on whether each claim in the answer is supported by the provided context.

Return a single float between 0.0 and 1.0:
- 1.0 = All claims are fully supported by the context
- 0.5 = Some claims supported, some unsupported or missing
- 0.0 = No claims are supported by the context

CONTEXT:
{context}

QUESTION: {question}
ANSWER: {answer}

Faithfulness score:"""

    response = await _call_llm(prompt)
    score = _parse_score(response or "") if response else 0.5
    logger.debug("Faithfulness score", question=question[:60], score=score)
    return score


async def score_correctness(
    question: str,
    answer: str,
    ground_truth: str,
) -> float:
    """Use LLM to rate how well the answer matches the ground truth (0-1)."""
    if not answer or not ground_truth:
        return 0.0

    prompt = f"""Compare the following ANSWER to the GROUND TRUTH for the given QUESTION.
Rate the ANSWER's correctness on a scale of 0.0 to 1.0.

Return a single float:
- 1.0 = Answer perfectly matches ground truth
- 0.5 = Answer partially matches
- 0.0 = Answer is completely wrong

QUESTION: {question}
GROUND TRUTH: {ground_truth}
ANSWER: {answer}

Correctness score:"""

    response = await _call_llm(prompt)
    score = _parse_score(response or "") if response else 0.5
    logger.debug("Correctness score", question=question[:60], score=score)
    return score
