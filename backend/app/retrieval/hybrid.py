"""
Hybrid Retrieval Engine
Combines: semantic vector search + BM25 keyword search + metadata filtering + reranking
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from app.core.config import settings
from app.core.logging import get_logger
from app.models.document import Chunk, Document
from app.embeddings.vector_store import get_vector_store

logger = get_logger(__name__)


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    content: str
    score: float
    vector_score: float = 0.0
    bm25_score: float = 0.0
    rerank_score: float = 0.0
    metadata: dict = field(default_factory=dict)
    page_number: Optional[int] = None
    section: Optional[str] = None
    heading: Optional[str] = None
    filename: str = ""
    doc_type: str = ""


class BM25:
    """Simple BM25 in-memory scorer for retrieved candidates."""
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b

    def _tokenize(self, text: str) -> list[str]:
        return re.findall(r"\b\w+\b", text.lower())

    def score(self, query: str, documents: list[str]) -> list[float]:
        query_terms = self._tokenize(query)
        if not documents or not query_terms:
            return [0.0] * len(documents)

        tokenized_docs = [self._tokenize(d) for d in documents]
        avg_dl = sum(len(d) for d in tokenized_docs) / max(len(tokenized_docs), 1)

        # Build idf
        df = defaultdict(int)
        N = len(tokenized_docs)
        for doc in tokenized_docs:
            for term in set(doc):
                df[term] += 1

        idf = {}
        for term in query_terms:
            n = df.get(term, 0)
            idf[term] = math.log((N - n + 0.5) / (n + 0.5) + 1)

        scores = []
        for doc_tokens in tokenized_docs:
            dl = len(doc_tokens)
            tf_map = defaultdict(int)
            for t in doc_tokens:
                tf_map[t] += 1

            s = 0.0
            for term in query_terms:
                tf = tf_map.get(term, 0)
                numerator = tf * (self.k1 + 1)
                denominator = tf + self.k1 * (1 - self.b + self.b * dl / max(avg_dl, 1))
                s += idf.get(term, 0) * (numerator / max(denominator, 1e-9))
            scores.append(s)
        return scores


async def _query_intent(query: str) -> str:
    """Classify query intent for retrieval mode selection."""
    lower = query.lower()
    if any(w in lower for w in ["define", "what is", "meaning", "definition"]):
        return "definition"
    if any(w in lower for w in ["formula", "equation", "expression", "derive"]):
        return "formula"
    if any(w in lower for w in ["compare", "difference", "versus", "vs", "contrast"]):
        return "comparative"
    if any(w in lower for w in ["summarize", "summary", "overview", "brief"]):
        return "summary"
    if any(w in lower for w in ["step", "how to", "procedure", "process", "algorithm"]):
        return "procedural"
    if any(w in lower for w in ["question", "exam", "quiz", "mcq", "previous year"]):
        return "exam"
    return "factual"


async def retrieve(
    query: str,
    db: AsyncSession,
    course_id: Optional[str] = None,
    document_ids: Optional[list[str]] = None,
    doc_type_filter: Optional[str] = None,
    user_id: Optional[str] = None,
    top_k: int = None,
    rerank: bool = True,
) -> list[RetrievedChunk]:
    """
    Full hybrid retrieval pipeline:
    1. Vector semantic search
    2. BM25 reranking over candidates
    3. Metadata filter
    4. Cross-encoder reranking (if Cohere available)
    5. Score fusion (RRF)
    """
    top_k = top_k or settings.RETRIEVAL_TOP_K

    # ── 1. Build metadata filter for Chroma ───────────────────
    where_filter: dict = {}
    where_conditions = []
    if course_id:
        where_conditions.append({"course_id": {"$eq": course_id}})
    if document_ids and len(document_ids) == 1:
        where_conditions.append({"document_id": {"$eq": document_ids[0]}})
    if doc_type_filter:
        where_conditions.append({"doc_type": {"$eq": doc_type_filter}})
    if len(where_conditions) == 1:
        where_filter = where_conditions[0]
    elif len(where_conditions) > 1:
        where_filter = {"$and": where_conditions}

    # ── 2. Vector search ──────────────────────────────────────
    vector_store = await get_vector_store()
    vector_results = await vector_store.search(
        query=query,
        n_results=min(top_k * 2, 20),
        where=where_filter if where_filter else None,
    )

    if not vector_results:
        logger.warning("No vector results found", query=query[:50])
        return []

    # ── 3. BM25 rescoring ─────────────────────────────────────
    bm25 = BM25()
    texts = [r["content"] for r in vector_results]
    bm25_scores = bm25.score(query, texts)

    # Normalize scores
    max_vec = max((r["score"] for r in vector_results), default=1.0) or 1.0
    max_bm25 = max(bm25_scores, default=1.0) or 1.0

    candidates: list[RetrievedChunk] = []
    for r, bm25_s in zip(vector_results, bm25_scores):
        meta = r["metadata"]
        # Reciprocal Rank Fusion
        vec_norm = r["score"] / max_vec
        bm25_norm = bm25_s / max_bm25
        fused = 0.6 * vec_norm + 0.4 * bm25_norm

        candidates.append(RetrievedChunk(
            chunk_id=r["id"],
            document_id=meta.get("document_id", ""),
            content=r["content"],
            score=fused,
            vector_score=r["score"],
            bm25_score=bm25_s,
            metadata=meta,
            page_number=int(meta.get("page_number", 0)) or None,
            section=meta.get("section", ""),
            heading=meta.get("heading", ""),
            filename=meta.get("filename", ""),
            doc_type=meta.get("doc_type", ""),
        ))

    # ── 4. Cohere reranking (optional) ────────────────────────
    if rerank and settings.COHERE_API_KEY:
        try:
            import cohere
            co = cohere.Client(settings.COHERE_API_KEY)
            docs_for_rerank = [c.content for c in candidates]
            rerank_result = co.rerank(
                query=query,
                documents=docs_for_rerank,
                top_n=settings.RERANK_TOP_K,
                model="rerank-multilingual-v3.0",
            )
            reranked = []
            for result in rerank_result.results:
                c = candidates[result.index]
                c.rerank_score = result.relevance_score
                c.score = 0.3 * c.vector_score / max_vec + 0.3 * (c.bm25_score / max_bm25) + 0.4 * result.relevance_score
                reranked.append(c)
            candidates = sorted(reranked, key=lambda x: x.score, reverse=True)
        except Exception as e:
            logger.warning("Reranking failed, using fused scores", error=str(e))

    # ── 5. Deduplicate and return top K ───────────────────────
    seen_content = set()
    final: list[RetrievedChunk] = []
    for c in sorted(candidates, key=lambda x: x.score, reverse=True):
        fingerprint = c.content[:100]
        if fingerprint not in seen_content:
            seen_content.add(fingerprint)
            final.append(c)
        if len(final) >= settings.RERANK_TOP_K:
            break

    logger.info("Retrieval complete", query=query[:50], results=len(final))
    return final
