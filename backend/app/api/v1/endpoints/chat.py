"""Chat / RAG query endpoints."""
from __future__ import annotations

import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.logging import get_logger
from app.db.database import get_db
from app.models.conversation import Conversation, Message
from app.models.user import User
from app.auth.security import get_current_user
from app.rag.pipeline import run_rag, stream_rag

logger = get_logger(__name__)
router = APIRouter(prefix="/chat", tags=["Chat"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: Optional[str] = None
    course_id: Optional[str] = None
    document_ids: Optional[list[str]] = None
    mode: str = "normal"  # strict | normal | tutor | exam | revision
    output_format: str = "text"  # text | bullets | table | flashcards | quiz | summary
    generate_follow_ups: bool = True


class ChatResponse(BaseModel):
    conversation_id: str
    message_id: str
    answer: str
    citations: list[dict]
    confidence: float
    mode: str
    chunks_retrieved: int
    tokens_used: int
    latency_ms: float
    follow_up_questions: list[str]


@router.post("/", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # ── Load or create conversation ───────────────────────────
    if request.conversation_id:
        result = await db.execute(
            select(Conversation).where(
                (Conversation.id == request.conversation_id) &
                (Conversation.user_id == current_user.id)
            )
        )
        conv = result.scalar_one_or_none()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conv = Conversation(
            user_id=current_user.id,
            course_id=request.course_id,
            title=request.message[:60] + ("..." if len(request.message) > 60 else ""),
            mode=request.mode,
        )
        db.add(conv)
        await db.flush()

    # ── Load history ──────────────────────────────────────────
    history_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc())
        .limit(10)
    )
    history_msgs = list(reversed(history_result.scalars().all()))
    conversation_history = [{"role": m.role, "content": m.content} for m in history_msgs]

    # ── Save user message ─────────────────────────────────────
    user_msg = Message(
        conversation_id=conv.id,
        role="user",
        content=request.message,
    )
    db.add(user_msg)
    await db.flush()

    # ── Run RAG ───────────────────────────────────────────────
    try:
        rag_result = await run_rag(
            query=request.message,
            db=db,
            mode=request.mode,
            output_format=request.output_format,
            course_id=request.course_id,
            document_ids=request.document_ids,
            conversation_history=conversation_history,
            user_id=current_user.id,
            generate_follow_ups=request.generate_follow_ups,
        )
    except Exception as e:
        logger.error("RAG pipeline error", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to process query")

    # ── Save assistant message ────────────────────────────────
    assistant_msg = Message(
        conversation_id=conv.id,
        role="assistant",
        content=rag_result.answer,
        citations=rag_result.citations,
        confidence=rag_result.confidence,
        latency_ms=rag_result.latency_ms,
        tokens_used=str(rag_result.tokens_used),
        meta={
            "mode": rag_result.mode,
            "chunks_retrieved": rag_result.chunks_retrieved,
            "follow_up_questions": rag_result.follow_up_questions,
        },
    )
    db.add(assistant_msg)
    await db.commit()

    return ChatResponse(
        conversation_id=conv.id,
        message_id=assistant_msg.id,
        answer=rag_result.answer,
        citations=rag_result.citations,
        confidence=rag_result.confidence,
        mode=rag_result.mode,
        chunks_retrieved=rag_result.chunks_retrieved,
        tokens_used=rag_result.tokens_used,
        latency_ms=rag_result.latency_ms,
        follow_up_questions=rag_result.follow_up_questions,
    )


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # ── Load or create conversation ───────────────────────────
    if request.conversation_id:
        result = await db.execute(
            select(Conversation).where(
                (Conversation.id == request.conversation_id) &
                (Conversation.user_id == current_user.id)
            )
        )
        conv = result.scalar_one_or_none()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conv = Conversation(
            user_id=current_user.id,
            course_id=request.course_id,
            title=request.message[:60] + ("..." if len(request.message) > 60 else ""),
            mode=request.mode,
        )
        db.add(conv)
        await db.flush()

    # ── Load history ──────────────────────────────────────────
    history_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc())
        .limit(10)
    )
    history_msgs = list(reversed(history_result.scalars().all()))
    conversation_history = [{"role": m.role, "content": m.content} for m in history_msgs]

    # ── Save user message ─────────────────────────────────────
    user_msg = Message(
        conversation_id=conv.id,
        role="user",
        content=request.message,
    )
    db.add(user_msg)
    await db.flush()

    citations_accumulated = []
    complete_data = None
    metadata_sent = {"conversation_id": conv.id, "user_message_id": user_msg.id}

    async def event_stream():
        nonlocal citations_accumulated, complete_data
        yield f"data: {json.dumps({'type': 'metadata', **metadata_sent})}\n\n"

        async for event in stream_rag(
            query=request.message,
            db=db,
            mode=request.mode,
            output_format=request.output_format,
            course_id=request.course_id,
            document_ids=request.document_ids,
            conversation_history=conversation_history,
            user_id=current_user.id,
        ):
            yield event
            if event.startswith("data: "):
                try:
                    payload = json.loads(event[6:])
                    if payload.get("type") == "citations":
                        citations_accumulated = payload.get("citations", [])
                    elif payload.get("type") == "complete":
                        complete_data = payload
                except json.JSONDecodeError:
                    pass

        # Save assistant message to DB after streaming completes
        if complete_data:
            try:
                assistant_msg = Message(
                    conversation_id=conv.id,
                    role="assistant",
                    content=complete_data.get("answer", ""),
                    citations=citations_accumulated,
                    confidence=complete_data.get("confidence", 0),
                    latency_ms=complete_data.get("latency_ms", 0),
                    tokens_used=str(complete_data.get("tokens_used", 0)),
                    meta={
                        "mode": complete_data.get("mode", request.mode),
                        "chunks_retrieved": complete_data.get("chunks_retrieved", 0),
                        "follow_up_questions": complete_data.get("follow_up_questions", []),
                    },
                )
                db.add(assistant_msg)
                await db.commit()
            except Exception as e:
                logger.error("Failed to save assistant message", error=str(e))

    response = StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

    # Save assistant message after streaming completes
    # Use FastAPI's response background task or inline
    return response


@router.get("/conversations", response_model=list[dict])
async def list_conversations(
    course_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Conversation).where(Conversation.user_id == current_user.id)
    if course_id:
        query = query.where(Conversation.course_id == course_id)
    query = query.order_by(Conversation.updated_at.desc()).limit(50)
    result = await db.execute(query)
    convs = result.scalars().all()
    return [
        {
            "id": c.id, "title": c.title, "mode": c.mode,
            "is_bookmarked": c.is_bookmarked, "course_id": c.course_id,
            "created_at": str(c.created_at), "updated_at": str(c.updated_at),
        }
        for c in convs
    ]


@router.get("/conversations/{conv_id}/messages", response_model=list[dict])
async def get_messages(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation).where(
            (Conversation.id == conv_id) & (Conversation.user_id == current_user.id)
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Conversation not found")

    msgs_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at.asc())
    )
    msgs = msgs_result.scalars().all()
    return [
        {
            "id": m.id, "role": m.role, "content": m.content,
            "citations": m.citations, "confidence": m.confidence,
            "latency_ms": m.latency_ms, "is_bookmarked": m.is_bookmarked,
            "feedback": m.feedback, "created_at": str(m.created_at),
            "metadata": m.meta,
        }
        for m in msgs
    ]


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation).where(
            (Conversation.id == conv_id) & (Conversation.user_id == current_user.id)
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.delete(conv)
    await db.commit()


@router.post("/conversations/{conv_id}/bookmark")
async def toggle_bookmark(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation).where(
            (Conversation.id == conv_id) & (Conversation.user_id == current_user.id)
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv.is_bookmarked = not conv.is_bookmarked
    await db.commit()
    return {"is_bookmarked": conv.is_bookmarked}


@router.post("/messages/{msg_id}/feedback")
async def message_feedback(
    msg_id: str,
    feedback: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Message).where(Message.id == msg_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    msg.feedback = feedback.get("rating", "good")
    await db.commit()
    return {"ok": True}
