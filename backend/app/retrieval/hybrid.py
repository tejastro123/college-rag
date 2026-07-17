"""
Hybrid Retrieval Engine v2
- Persistent BM25 index (full-corpus, built at ingestion)
- Multi-query expansion (LLM-generated variants)
- HyDE (Hypothetical Document Embeddings) for sparse/definition queries
- RRF fusion across variants + across vector/BM25 per variant
- Reranking: Cohere cross-encoder → local cross-encoder fallback
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.embeddings.vector_store import get_vector_store
from .bm25_index import get_bm25_index
from .query_expansion import expand_query
from .hyde import generate_hypothetical_document, HYDE_INTENTS
from .reranker import run_local_rerank

logger = get_logger(__name__)

RRF_K = 60  # RRF constant


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


def _query_intent(query: str) -> str:
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


def _build_where_filter(
    course_id: Optional[str] = None,
    document_ids: Optional[list[str]] = None,
    doc_type_filter: Optional[str] = None,
) -> Optional[dict]:
    conditions = []
    if course_id:
        conditions.append({"course_id": {"$eq": course_id}})
    if document_ids and len(document_ids) == 1:
        conditions.append({"document_id": {"$eq": document_ids[0]}})
    if doc_type_filter:
        conditions.append({"doc_type": {"$eq": doc_type_filter}})
    if not conditions:
        return None
    if len(conditions) == 1:
        return conditions[0]
    return {"$and": conditions}


def _rrf_score(rank: int, k: int = RRF_K) -> float:
    return 1.0 / (k + rank)


def _metadata_matches(meta: dict, course_id: Optional[str], document_ids: Optional[list[str]]) -> bool:
    if course_id and meta.get("course_id") != course_id:
        return False
    if document_ids and meta.get("document_id") not in document_ids:
        return False
    return True


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
    top_k = top_k or settings.RETRIEVAL_TOP_K
    intent = _query_intent(query)
    where_filter = _build_where_filter(course_id, document_ids, doc_type_filter)

    # ── 1. Generate query variants ──────────────────────────
    query_variants = [query]

    expansion_tasks = []
    if settings.QUERY_EXPANSION_ENABLED:
        expansion_tasks.append(expand_query(query))
    if settings.HYDE_ENABLED and intent in HYDE_INTENTS:
        expansion_tasks.append(generate_hypothetical_document(query, intent))

    if expansion_tasks:
        results = await asyncio.gather(*expansion_tasks, return_exceptions=True)
        for res in results:
            if isinstance(res, Exception):
                logger.warning("Query variant generation failed", error=str(res))
                continue
            if isinstance(res, list):
                query_variants.extend(v for v in res[1:] if v not in query_variants)
            elif isinstance(res, str) and res:
                if res not in query_variants:
                    query_variants.append(res)

    logger.info(
        "Retrieval variants",
        count=len(query_variants),
        intent=intent,
        query=query[:60],
    )

    # ── 2. Retrieve for each variant ────────────────────────
    vector_store = await get_vector_store()
    bm25_index = get_bm25_index()

    all_candidates: dict[str, RetrievedChunk] = {}
    variant_rankings: list[list[str]] = []  # chunk_ids in rank order per variant

    for q in query_variants:
        vec_results = await vector_store.search(
            query=q,
            n_results=min(top_k * 2, 20),
            where=where_filter if where_filter else None,
        )

        bm25_results_raw = await asyncio.to_thread(
            bm25_index.search, q, top_k * 4
        )
        bm25_results = [
            r for r in bm25_results_raw
            if _metadata_matches(r["metadata"], course_id, document_ids)
        ][: top_k * 2]

        # Build unified map of chunk_id → data for this variant
        variant_map: dict[str, dict] = {}

        for r in vec_results:
            rid = r["id"]
            variant_map[rid] = {
                "chunk_id": rid,
                "content": r["content"],
                "vector_score": r["score"],
                "bm25_score": 0.0,
                "has_vector": True,
                "metadata": r["metadata"],
            }

        for r in bm25_results:
            rid = r["id"]
            if rid in variant_map:
                variant_map[rid]["bm25_score"] = r["score"]
            else:
                variant_map[rid] = {
                    "chunk_id": rid,
                    "content": r["content"],
                    "vector_score": 0.0,
                    "bm25_score": r["score"],
                    "has_vector": False,
                    "metadata": r["metadata"],
                }

        if not variant_map:
            continue

        # RRF merge within this variant
        vec_ids = [r["id"] for r in vec_results]
        bm25_ids = [r["id"] for r in bm25_results]

        scored = []
        for cid, data in variant_map.items():
            rrf = 0.0
            if cid in vec_ids:
                rrf += _rrf_score(vec_ids.index(cid) + 1)
            if cid in bm25_ids:
                rrf += _rrf_score(bm25_ids.index(cid) + 1)
            scored.append((cid, rrf))

        scored.sort(key=lambda x: x[1], reverse=True)
        variant_rankings.append([cid for cid, _ in scored])

        # Upsert into global candidates
        for cid, rrf in scored[: top_k * 3]:
            if cid not in all_candidates:
                data = variant_map[cid]
                meta = data["metadata"]
                all_candidates[cid] = RetrievedChunk(
                    chunk_id=cid,
                    document_id=meta.get("document_id", ""),
                    content=data["content"],
                    score=0.0,
                    vector_score=data["vector_score"],
                    bm25_score=data["bm25_score"],
                    metadata=meta,
                    page_number=meta.get("page_number"),
                    section=meta.get("section"),
                    heading=meta.get("heading"),
                    filename=meta.get("filename", ""),
                    doc_type=meta.get("doc_type", ""),
                )

    if not all_candidates:
        logger.warning("No results from any variant", query=query[:60])
        return []

    # ── 3. Global RRF across all variants ────────────────────
    for cid in all_candidates:
        total = 0.0
        for rank_list in variant_rankings:
            if cid in rank_list:
                total += _rrf_score(rank_list.index(cid) + 1)
        all_candidates[cid].score = total

    candidates = sorted(all_candidates.values(), key=lambda c: c.score, reverse=True)

    # ── 4. Reranking (Cohere → local cross-encoder fallback) ──
    if rerank:
        reranked = None

        if settings.COHERE_API_KEY:
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
                    c.score = 0.5 * c.score + 0.5 * result.relevance_score
                    reranked.append(c)
                candidates = sorted(reranked, key=lambda x: x.score, reverse=True)
            except Exception as e:
                logger.warning("Cohere reranking failed, trying local", error=str(e))

        if reranked is None and settings.RERANK_PROVIDER != "cohere":
            local = await run_local_rerank(query, candidates, settings.RERANK_TOP_K)
            if local:
                candidates = local

    # ── 5. Deduplicate and return top K ─────────────────────
    seen_content = set()
    final: list[RetrievedChunk] = []
    for c in candidates:
        fingerprint = c.content[:100]
        if fingerprint not in seen_content:
            seen_content.add(fingerprint)
            final.append(c)
        if len(final) >= settings.RERANK_TOP_K:
            break

    logger.info(
        "Retrieval complete",
        query=query[:60],
        variants=len(query_variants),
        candidates=len(candidates),
        final=len(final),
    )
    return final
