"""Core RAG pipeline — ties retrieval + generation together."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.retrieval.hybrid import retrieve, RetrievedChunk
from app.generation.generator import generate_answer, GenerationResult

logger = get_logger(__name__)


@dataclass
class RAGResponse:
    answer: str
    citations: list[dict]
    confidence: float
    mode: str
    chunks_retrieved: int
    tokens_used: int
    latency_ms: float
    follow_up_questions: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


async def run_rag(
    query: str,
    db: AsyncSession,
    mode: str = "normal",
    output_format: str = "text",
    course_id: Optional[str] = None,
    document_ids: Optional[list[str]] = None,
    doc_type_filter: Optional[str] = None,
    conversation_history: list[dict] = None,
    user_id: Optional[str] = None,
    generate_follow_ups: bool = True,
) -> RAGResponse:
    """
    End-to-end RAG:
    1. Hybrid retrieval
    2. LLM generation
    3. Follow-up question generation
    """
    # ── 1. Retrieve ───────────────────────────────────────────
    chunks = await retrieve(
        query=query,
        db=db,
        course_id=course_id,
        document_ids=document_ids,
        doc_type_filter=doc_type_filter,
        user_id=user_id,
    )

    if not chunks:
        logger.warning("No chunks retrieved", query=query[:50])
        return RAGResponse(
            answer="I couldn't find relevant information in your uploaded documents. "
                   "Please make sure you have uploaded documents related to this topic.",
            citations=[],
            confidence=0.05,
            mode=mode,
            chunks_retrieved=0,
            tokens_used=0,
            latency_ms=0,
        )

    # ── 2. Generate ───────────────────────────────────────────
    result: GenerationResult = await generate_answer(
        query=query,
        chunks=chunks,
        mode=mode,
        conversation_history=conversation_history,
        output_format=output_format,
    )

    # ── 3. Follow-up questions ────────────────────────────────
    follow_ups = []
    if generate_follow_ups and result.confidence > 0.3:
        follow_ups = _generate_follow_ups(query, chunks)

    return RAGResponse(
        answer=result.answer,
        citations=result.citations,
        confidence=result.confidence,
        mode=mode,
        chunks_retrieved=len(chunks),
        tokens_used=result.tokens_used,
        latency_ms=result.latency_ms,
        follow_up_questions=follow_ups,
    )


def _generate_follow_ups(query: str, chunks: list[RetrievedChunk]) -> list[str]:
    """Generate 3 relevant follow-up questions based on retrieved content."""
    subjects = set()
    headings = set()
    for c in chunks[:3]:
        if c.heading:
            headings.add(c.heading)
        if c.metadata.get("subject"):
            subjects.add(c.metadata["subject"])

    questions = []
    if headings:
        h = next(iter(headings))
        questions.append(f"Can you explain more about '{h}'?")
    questions.append(f"What are the key formulas related to this topic?")
    questions.append(f"Can you generate a quiz based on what I just asked?")
    return questions[:3]
