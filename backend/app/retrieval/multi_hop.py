"""Multi-hop retriever — decomposes complex questions, retrieves per sub-question, merges results."""
from __future__ import annotations

import asyncio
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.retrieval.hybrid import retrieve, RetrievedChunk
from app.retrieval.router import classify, decompose

logger = get_logger(__name__)


def _merge_and_deduplicate(all_chunks: list[list[RetrievedChunk]], top_k: int = 5) -> list[RetrievedChunk]:
    """Merge multiple result lists, deduplicate by content, return top K by score."""
    seen_content = set()
    merged: list[RetrievedChunk] = []
    for chunks in all_chunks:
        for c in chunks:
            fingerprint = c.content[:100]
            if fingerprint not in seen_content:
                seen_content.add(fingerprint)
                merged.append(c)
    merged.sort(key=lambda x: x.score, reverse=True)
    return merged[:top_k]


async def multi_hop_retrieve(
    query: str,
    db: AsyncSession,
    course_id: Optional[str] = None,
    document_ids: Optional[list[str]] = None,
    doc_type_filter: Optional[str] = None,
    user_id: Optional[str] = None,
) -> tuple[list[RetrievedChunk], str]:
    """Route query: single-hop → normal retrieval, multi-hop → decompose + retrieve per sub-question.

    Returns (chunks, retrieval_type) where retrieval_type is 'single' or 'multi'.
    """
    hop_type = await classify(query)

    if hop_type == "single":
        logger.info("Single-hop retrieval", query=query[:60])
        chunks = await retrieve(
            query=query, db=db, course_id=course_id,
            document_ids=document_ids, doc_type_filter=doc_type_filter, user_id=user_id,
        )
        return chunks, "single"

    # Multi-hop: decompose and retrieve
    sub_questions = await decompose(query)
    logger.info("Multi-hop retrieval", query=query[:60], sub_questions=len(sub_questions))

    tasks = [
        retrieve(
            query=sq, db=db, course_id=course_id,
            document_ids=document_ids, doc_type_filter=doc_type_filter, user_id=user_id,
        )
        for sq in sub_questions
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_chunks = []
    for sq, result in zip(sub_questions, results):
        if isinstance(result, Exception):
            logger.warning("Sub-question retrieval failed", sub_question=sq, error=str(result))
            continue
        all_chunks.append(result)

    if not all_chunks:
        logger.warning("All sub-question retrievals failed, falling back to original query")
        return await retrieve(
            query=query, db=db, course_id=course_id,
            document_ids=document_ids, doc_type_filter=doc_type_filter, user_id=user_id,
        ), "single"

    merged = _merge_and_deduplicate(all_chunks, top_k=settings.RERANK_TOP_K)
    logger.info("Multi-hop merge complete", sub_questions=len(sub_questions), merged=len(merged))
    return merged, "multi"
