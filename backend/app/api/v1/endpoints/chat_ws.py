"""WebSocket chat endpoint for streaming RAG responses."""
from __future__ import annotations

import json
import uuid
import asyncio
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.logging import get_logger
from app.core.config import settings
from app.db.database import get_db, AsyncSessionLocal
from app.models.user import User
from app.models.conversation import Conversation, Message
from app.auth.security import decode_token
from app.chat.ws_manager import manager
from app.rag.pipeline import run_rag
from app.services.cache import cache_get, cache_set

logger = get_logger(__name__)
router = APIRouter()


async def get_user_from_token(token: str) -> Optional[User]:
    payload = decode_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()


@router.websocket("/ws/chat")
async def websocket_chat(
    ws: WebSocket,
    token: str = Query(...),
    conversation_id: Optional[str] = Query(None),
    course_id: Optional[str] = Query(None),
    mode: str = Query("normal"),
):
    user = await get_user_from_token(token)
    if not user:
        await ws.close(code=4001)
        return

    await manager.connect(user.id, ws)

    try:
        # Load conversation
        async with AsyncSessionLocal() as db:
            if conversation_id:
                result = await db.execute(
                    select(Conversation).where(
                        Conversation.id == conversation_id,
                        Conversation.user_id == user.id,
                    )
                )
                conv = result.scalar_one_or_none()
                if not conv:
                    await ws.send_json({"type": "error", "detail": "Conversation not found"})
                    await ws.close()
                    return
            else:
                conv = Conversation(
                    user_id=user.id,
                    course_id=course_id,
                    title="New Chat",
                    mode=mode,
                )
                db.add(conv)
                await db.flush()
                await db.commit()

            await ws.send_json({"type": "connected", "conversation_id": conv.id})

        # Listen for messages
        async for raw in ws.iter_json():
            msg_text = raw.get("message", "").strip()
            if not msg_text:
                continue

            async with AsyncSessionLocal() as db:
                # Save user message
                user_msg = Message(
                    conversation_id=conv.id,
                    role="user",
                    content=msg_text,
                )
                db.add(user_msg)
                await db.flush()

                # Update title on first message
                if conv.title == "New Chat":
                    conv.title = msg_text[:60] + ("..." if len(msg_text) > 60 else "")
                    db.add(conv)

                # Load history
                history_result = await db.execute(
                    select(Message)
                    .where(Message.conversation_id == conv.id)
                    .order_by(Message.created_at.desc())
                    .limit(10)
                )
                history_msgs = list(reversed(history_result.scalars().all()))
                conversation_history = [{"role": m.role, "content": m.content} for m in history_msgs]

                await db.commit()

            # Stream RAG response
            await ws.send_json({"type": "query_received", "message_id": user_msg.id})

            try:
                rag_result = await run_rag(
                    query=msg_text,
                    db=AsyncSessionLocal(),
                    mode=mode,
                    course_id=course_id,
                    user_id=user.id,
                    conversation_history=conversation_history,
                )

                # Stream tokens
                answer = rag_result.answer
                chunk_size = 20
                for i in range(0, len(answer), chunk_size):
                    chunk = answer[i:i + chunk_size]
                    await ws.send_json({
                        "type": "token",
                        "content": chunk,
                        "done": i + chunk_size >= len(answer),
                    })
                    await asyncio.sleep(0.02)

                # Save assistant message
                async with AsyncSessionLocal() as db:
                    assistant_msg = Message(
                        conversation_id=conv.id,
                        role="assistant",
                        content=answer,
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

                    await ws.send_json({
                        "type": "complete",
                        "message_id": assistant_msg.id,
                        "answer": answer,
                        "citations": rag_result.citations,
                        "confidence": rag_result.confidence,
                        "latency_ms": rag_result.latency_ms,
                        "tokens_used": rag_result.tokens_used,
                        "follow_up_questions": rag_result.follow_up_questions,
                    })

            except Exception as e:
                logger.error("RAG pipeline error", error=str(e))
                await ws.send_json({"type": "error", "detail": "Failed to process query"})

    except WebSocketDisconnect:
        manager.disconnect(user.id, ws)
    except Exception as e:
        logger.error("WS error", error=str(e))
        manager.disconnect(user.id, ws)
