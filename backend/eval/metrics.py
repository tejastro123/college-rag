"""Retrieval evaluation metrics."""
from __future__ import annotations


def recall_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int = 5) -> float:
    """Fraction of relevant items in top-k retrieved results."""
    if not relevant_ids:
        return 0.0
    top_k = retrieved_ids[:k]
    hits = sum(1 for rid in top_k if rid in relevant_ids)
    return hits / len(relevant_ids)


def mrr(retrieved_ids: list[str], relevant_ids: set[str]) -> float:
    """Mean Reciprocal Rank — 1/rank of first relevant item, 0 if none found."""
    for rank, rid in enumerate(retrieved_ids, start=1):
        if rid in relevant_ids:
            return 1.0 / rank
    return 0.0
