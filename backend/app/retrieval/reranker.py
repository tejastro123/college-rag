"""Local cross-encoder reranker using sentence-transformers."""
from __future__ import annotations

from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_reranker = None


class LocalReranker:
    def __init__(self, model_name: Optional[str] = None):
        self._model_name = model_name or settings.RERANK_MODEL
        self._model = None

    def _load(self):
        if self._model is not None:
            return
        from sentence_transformers import CrossEncoder
        self._model = CrossEncoder(self._model_name)
        logger.info("Local reranker loaded", model=self._model_name)

    def rerank(
        self, query: str, documents: list[str], top_n: int = 5,
    ) -> list[dict]:
        """Score (query, doc) pairs and return top_n results sorted by relevance."""
        self._load()
        if not documents:
            return []

        pairs = [(query, doc[:4096]) for doc in documents]  # truncate to avoid OOM
        scores = self._model.predict(pairs, show_progress_bar=False)

        indexed = sorted(
            enumerate(scores), key=lambda x: x[1], reverse=True
        )
        return [
            {"index": idx, "score": float(score)}
            for idx, score in indexed[:top_n]
        ]


def get_reranker() -> LocalReranker:
    global _reranker
    if _reranker is None:
        _reranker = LocalReranker()
    return _reranker


async def run_local_rerank(
    query: str, candidates: list, top_n: int,
) -> Optional[list]:
    """Run local cross-encoder reranking on candidates. Returns reranked list or None on failure."""
    import asyncio

    try:
        reranker = get_reranker()
        docs = [c.content for c in candidates]
        results = await asyncio.to_thread(reranker.rerank, query, docs, top_n)

        reranked = []
        for r in results:
            c = candidates[r["index"]]
            c.rerank_score = r["score"]
            c.score = 0.5 * c.score + 0.5 * r["score"]
            reranked.append(c)
        return sorted(reranked, key=lambda x: x.score, reverse=True)
    except Exception as e:
        logger.warning("Local reranking failed", error=str(e))
        return None
