"""Core RAG pipeline — ties retrieval + generation together."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from typing import AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.retrieval.hybrid import RetrievedChunk
from app.retrieval.multi_hop import multi_hop_retrieve
from app.generation.generator import generate_answer, generate_answer_stream, GenerationResult
from app.services.semantic_cache import get_cached_response, set_cached_response
from app.monitoring.metrics import record_rag_metrics, RAGMetrics

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
    0. Semantic cache check (only for first messages without history)
    1. Hybrid retrieval
    2. LLM generation
    3. Follow-up question generation
    """
    start = time.time()

    # ── 0. Semantic cache (skip when continuing a conversation) ──
    is_first_message = not conversation_history
    cached = None
    if is_first_message and settings.CACHE_ENABLED:
        cached = await get_cached_response(
            query=query,
            course_id=course_id,
            mode=mode,
            output_format=output_format,
            document_ids=document_ids,
            doc_type_filter=doc_type_filter,
        )
        if cached:
            logger.info("Cache hit", query=query[:50])
            elapsed = (time.time() - start) * 1000
            cached["latency_ms"] = round(elapsed, 2)
            return RAGResponse(**cached)

    # ── 1. Retrieve (routed: single-hop vs multi-hop) ─────────
    chunks, retrieval_type = await multi_hop_retrieve(
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

    response = RAGResponse(
        answer=result.answer,
        citations=result.citations,
        confidence=result.confidence,
        mode=mode,
        chunks_retrieved=len(chunks),
        tokens_used=result.tokens_used,
        latency_ms=result.latency_ms,
        follow_up_questions=follow_ups,
        metadata={"retrieval_type": retrieval_type},
    )

    # ── 4. Cache response (first message only) ────────────────
    if is_first_message and settings.CACHE_ENABLED and result.confidence > 0.3:
        try:
            await set_cached_response(
                asdict(response),
                query=query,
                course_id=course_id,
                mode=mode,
                output_format=output_format,
                document_ids=document_ids,
                doc_type_filter=doc_type_filter,
            )
        except Exception as e:
            logger.warning("Cache write failed", error=str(e))

    # ── 5. Record metrics ────────────────────────────────
    try:
        record_rag_metrics(RAGMetrics(
            course_id=course_id or "",
            mode=mode,
            retrieval_type=retrieval_type,
            latency_ms=response.latency_ms,
            confidence=response.confidence,
            tokens_used=response.tokens_used,
            chunks_retrieved=response.chunks_retrieved,
            retrieval_success=len(chunks) > 0,
        ))
    except Exception as e:
        logger.warning("Metrics recording failed", error=str(e))

    return response


async def stream_rag(
    query: str,
    db: AsyncSession,
    mode: str = "normal",
    output_format: str = "text",
    course_id: Optional[str] = None,
    document_ids: Optional[list[str]] = None,
    doc_type_filter: Optional[str] = None,
    conversation_history: list[dict] = None,
    user_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Streaming variant of run_rag. Yields SSE JSON events."""
    start = time.time()
    is_first_message = not conversation_history

    # ── 0. Semantic cache ──
    if is_first_message and settings.CACHE_ENABLED:
        cached = await get_cached_response(
            query=query, course_id=course_id, mode=mode,
            output_format=output_format, document_ids=document_ids,
            doc_type_filter=doc_type_filter,
        )
        if cached:
            yield f"data: {json.dumps({'type': 'cached', **cached})}\n\n"
            elapsed = (time.time() - start) * 1000
            cached["latency_ms"] = round(elapsed, 2)
            yield f"data: {json.dumps({'type': 'done', 'answer': cached['answer'], 'citations': cached.get('citations', []), 'confidence': cached.get('confidence', 0)})}\n\n"
            return

    # ── 1. Retrieve ──
    chunks, retrieval_type = await multi_hop_retrieve(
        query=query, db=db, course_id=course_id,
        document_ids=document_ids, doc_type_filter=doc_type_filter, user_id=user_id,
    )

    if not chunks:
        yield f"data: {json.dumps({'type': 'error', 'detail': 'No relevant content found in your uploaded documents.'})}\n\n"
        return

    yield f"data: {json.dumps({'type': 'retrieval', 'chunks_count': len(chunks), 'retrieval_type': retrieval_type})}\n\n"

    # ── 2. Stream generation ──
    confidence = sum(c.score for c in chunks) / len(chunks) if chunks else 0.1
    tokens_used = 0
    answer = ""
    confidence = sum(c.score for c in chunks) / len(chunks) if chunks else 0.1

    try:
        async for event in generate_answer_stream(
            query=query, chunks=chunks, mode=mode,
            conversation_history=conversation_history, output_format=output_format,
        ):
            yield event
            if event.startswith("data: "):
                try:
                    payload = json.loads(event[6:])
                    pt = payload.get("type")
                    if pt == "token":
                        answer += payload.get("content", "")
                    elif pt == "done":
                        # Overwrite with exact answer from generator
                        done_answer = payload.get("answer", "")
                        if done_answer:
                            answer = done_answer
                        tokens_used = payload.get("tokens_used", 0)
                except json.JSONDecodeError:
                    pass
    except Exception as e:
        logger.error("Streaming generation failed", error=str(e))
        yield f"data: {json.dumps({'type': 'error', 'detail': 'Generation failed'})}\n\n"
        return

    # ── 3. Follow-up questions ──
    follow_ups = _generate_follow_ups(query, chunks)

    # ── 4. Finalise & yield completion event ──
    latency = (time.time() - start) * 1000
    complete = {
        "conversation_id": None,  # filled by caller
        "message_id": None,
        "answer": answer,
        "citations": [],  # filled by generator's early citations event
        "confidence": min(0.95, confidence),
        "mode": mode,
        "chunks_retrieved": len(chunks),
        "tokens_used": tokens_used,
        "latency_ms": round(latency, 2),
        "follow_up_questions": follow_ups,
    }
    yield f"data: {json.dumps({'type': 'complete', **complete})}\n\n"

    # ── 5. Cache ──
    if is_first_message and settings.CACHE_ENABLED and confidence > 0.3:
        try:
            await set_cached_response(
                complete, query=query, course_id=course_id, mode=mode,
                output_format=output_format, document_ids=document_ids,
                doc_type_filter=doc_type_filter,
            )
        except Exception as e:
            logger.warning("Cache write failed", error=str(e))

    # ── 6. Metrics ──
    try:
        record_rag_metrics(RAGMetrics(
            course_id=course_id or "", mode=mode, retrieval_type=retrieval_type,
            latency_ms=latency, confidence=min(0.95, confidence),
            tokens_used=tokens_used, chunks_retrieved=len(chunks),
            retrieval_success=True,
        ))
    except Exception as e:
        logger.warning("Metrics recording failed", error=str(e))


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
