"""
Quality scoring service.

Computes per-message quality scores, auto-flag logic, and aggregate
RAG eval metrics without needing any new DB tables.

Score formula (0-1):
  - confidence weight   0.50  (direct from RAG)
  - citation coverage   0.20  (has citations → +0.20, scaled by count)
  - feedback signal     0.30  (+0.30 good, -0.30 bad, 0.0 neutral)
  - penalty             -0.15 if zero chunks retrieved

Auto-flag conditions:
  - score < QUALITY_FLAG_THRESHOLD  (default 0.40)
  - feedback == "bad"
  - confidence < CONFIDENCE_LOW_THRESHOLD (default 0.30)
  - chunks_retrieved == 0
"""
from __future__ import annotations

from typing import Optional

# Thresholds
QUALITY_FLAG_THRESHOLD = 0.40
CONFIDENCE_LOW_THRESHOLD = 0.30
MAX_CITATIONS_FOR_FULL_SCORE = 5  # >= 5 citations = full citation score


def compute_quality_score(
    confidence: Optional[float],
    feedback: Optional[str],
    citations: Optional[list],
    chunks_retrieved: Optional[int],
) -> float:
    """Return composite quality score in [0, 1]."""
    conf = max(0.0, min(float(confidence or 0.0), 1.0))
    score = conf * 0.50

    # Citation coverage (0-0.20)
    n_citations = len(citations) if citations else 0
    cit_score = min(n_citations / MAX_CITATIONS_FOR_FULL_SCORE, 1.0) * 0.20
    score += cit_score

    # Feedback signal (±0.30)
    if feedback == "good":
        score += 0.30
    elif feedback == "bad":
        score -= 0.30

    # Zero-retrieval penalty
    if (chunks_retrieved or 0) == 0:
        score -= 0.15

    return round(max(0.0, min(score, 1.0)), 4)


def flag_reason(
    confidence: Optional[float],
    feedback: Optional[str],
    chunks_retrieved: Optional[int],
    score: float,
) -> Optional[str]:
    """Return human-readable flag reason or None if response is OK."""
    reasons = []
    if feedback == "bad":
        reasons.append("negative feedback")
    if (confidence or 0) < CONFIDENCE_LOW_THRESHOLD:
        reasons.append(f"low confidence ({(confidence or 0):.0%})")
    if (chunks_retrieved or 0) == 0:
        reasons.append("no chunks retrieved")
    if score < QUALITY_FLAG_THRESHOLD and not reasons:
        reasons.append(f"quality score {score:.0%} below threshold")
    return ", ".join(reasons) if reasons else None


def faithfulness_proxy(confidence: float, chunks_retrieved: int, n_citations: int) -> float:
    """
    Proxy for answer faithfulness (citation coverage × retrieval quality).
    Real faithfulness requires LLM-as-judge; this is a lightweight heuristic.
    """
    if chunks_retrieved == 0:
        return 0.0
    citation_coverage = min(n_citations / max(chunks_retrieved, 1), 1.0)
    return round(confidence * 0.6 + citation_coverage * 0.4, 4)


def retrieval_precision_proxy(n_citations: int, chunks_retrieved: int) -> float:
    """
    Proxy for retrieval precision: what fraction of retrieved chunks
    were actually cited in the answer.
    """
    if chunks_retrieved == 0:
        return 0.0
    return round(min(n_citations / chunks_retrieved, 1.0), 4)
