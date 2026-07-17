"""
LLM Generation Engine
Supports: Ollama Local (Mistral)
Answer modes: strict | normal | tutor | exam | revision
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import AsyncGenerator, Optional

from app.core.config import settings
from app.core.logging import get_logger
from app.retrieval.hybrid import RetrievedChunk
from app.services.http_client import get_ollama_client

logger = get_logger(__name__)


SYSTEM_PROMPTS = {
    "strict": """You are an academic assistant for college students. 
STRICT MODE: Answer ONLY using the provided context. Do not use external knowledge.
If the context does not contain the answer, say: "The provided materials do not contain information about this topic."
Always cite sources with [Source: filename, Page X] format.""",

    "normal": """You are a knowledgeable academic assistant for college students.
Use the provided context as your primary source. You may supplement with general knowledge when clearly needed, but always prioritize context.
Always cite sources when quoting from context using [Source: filename, Page X] format.
If context is insufficient, acknowledge it.""",

    "tutor": """You are a friendly, patient academic tutor for college students.
Use the provided context to explain concepts clearly. Add examples, analogies, and study tips when helpful.
Break down complex topics step by step. Encourage the student.
Cite sources using [Source: filename, Page X] format.""",

    "exam": """You are an exam preparation assistant. Provide concise, precise answers suitable for exam responses.
Focus on key facts, formulas, and definitions from the context.
Format answers clearly. Include relevant formulas or diagrams in text form when applicable.
Cite sources using [Source: filename, Page X] format.""",

    "revision": """You are a revision assistant helping students prepare for exams.
Create structured revision notes from the context. Use bullet points, key terms in **bold**, and memory hooks.
Include a summary, key points, and potential exam questions at the end.
Cite sources using [Source: filename, Page X] format.""",
}


@dataclass
class GenerationResult:
    answer: str
    citations: list[dict]
    confidence: float
    mode: str
    tokens_used: int = 0
    latency_ms: float = 0.0
    metadata: dict = field(default_factory=dict)


def _build_context(chunks: list[RetrievedChunk]) -> tuple[str, list[dict]]:
    """Build context string and citation list from retrieved chunks."""
    context_parts = []
    citations = []

    for i, chunk in enumerate(chunks, 1):
        filename = chunk.filename or chunk.metadata.get("filename", "Unknown")
        page = f", Page {chunk.page_number}" if chunk.page_number else ""
        section = f", Section: {chunk.section}" if chunk.section else ""
        heading = f" — {chunk.heading}" if chunk.heading else ""

        source_label = f"[Source {i}: {filename}{page}{section}]"
        context_parts.append(f"{source_label}\n{chunk.content}")

        citations.append({
            "index": i,
            "chunk_id": chunk.chunk_id,
            "document_id": chunk.document_id,
            "filename": filename,
            "page_number": chunk.page_number,
            "section": chunk.section,
            "heading": chunk.heading,
            "score": round(chunk.score, 4),
            "content_preview": chunk.content[:200] + ("..." if len(chunk.content) > 200 else ""),
        })

    context = "\n\n---\n\n".join(context_parts)
    return context, citations


def _estimate_confidence(chunks: list[RetrievedChunk], answer: str) -> float:
    if not chunks:
        return 0.1
    avg_score = sum(c.score for c in chunks) / len(chunks)
    if "do not contain" in answer.lower() or "not enough" in answer.lower():
        return 0.2
    return min(0.95, avg_score)


async def generate_answer(
    query: str,
    chunks: list[RetrievedChunk],
    mode: str = "normal",
    conversation_history: list[dict] = None,
    output_format: str = "text",  # text | bullets | table | flashcards | quiz | summary
) -> GenerationResult:
    """Generate an answer using the configured LLM."""
    start = time.time()
    context, citations = _build_context(chunks)
    system_prompt = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["normal"])
    conversation_history = conversation_history or []

    # Add format instructions
    format_instructions = ""
    if output_format == "bullets":
        format_instructions = "\n\nFormat your response as clear bullet points."
    elif output_format == "table":
        format_instructions = "\n\nFormat your response as a markdown table where appropriate."
    elif output_format == "flashcards":
        format_instructions = "\n\nGenerate 5-10 flashcards. Format: **Q:** question\n**A:** answer"
    elif output_format == "quiz":
        format_instructions = "\n\nGenerate 5 multiple choice questions with answers."
    elif output_format == "summary":
        format_instructions = "\n\nProvide a concise structured summary with key points."

    user_message = f"""CONTEXT FROM DOCUMENTS:
{context}

---

STUDENT QUERY: {query}{format_instructions}"""

    messages = []
    # Include last 6 messages of history
    for msg in conversation_history[-6:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    answer = ""
    tokens_used = 0

    try:
        provider = settings.LLM_PROVIDER

        if provider == "ollama":
            client = get_ollama_client()
            payload = {
                "model": settings.OLLAMA_MODEL,
                "messages": [{"role": "system", "content": system_prompt}] + messages,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 2000,
                }
            }
            response = await client.post("/api/chat", json=payload)
            response.raise_for_status()
            res_data = response.json()
            answer = res_data.get("message", {}).get("content", "")
            
            prompt_tokens = res_data.get("prompt_eval_count", 0)
            completion_tokens = res_data.get("eval_count", 0)
            tokens_used = prompt_tokens + completion_tokens

        else:
            # Fallback: return context without LLM
            answer = _fallback_answer(query, chunks)

    except Exception as e:
        logger.error("LLM generation failed", error=str(e), provider=provider)
        answer = f"I encountered an error generating a response. Here are the most relevant excerpts:\n\n" + \
                 "\n\n".join(f"**{c.filename}** (Page {c.page_number}):\n{c.content[:300]}..." for c in chunks[:3])

    latency = (time.time() - start) * 1000
    confidence = _estimate_confidence(chunks, answer)

    return GenerationResult(
        answer=answer,
        citations=citations,
        confidence=confidence,
        mode=mode,
        tokens_used=tokens_used,
        latency_ms=round(latency, 2),
    )


def _fallback_answer(query: str, chunks: list[RetrievedChunk]) -> str:
    """When no LLM is configured, return structured context."""
    if not chunks:
        return "No relevant content found in your documents."
    parts = [f"**Relevant content for: {query}**\n"]
    for i, chunk in enumerate(chunks[:5], 1):
        parts.append(f"**{i}. From {chunk.filename}** (Page {chunk.page_number or '?'}):\n{chunk.content}")
    return "\n\n".join(parts)


async def generate_answer_stream(
    query: str,
    chunks: list[RetrievedChunk],
    mode: str = "normal",
    conversation_history: list[dict] = None,
    output_format: str = "text",
) -> AsyncGenerator[str, None]:
    """Stream LLM tokens via SSE. Yields JSON lines: token, citations, done."""
    context, citations = _build_context(chunks)
    system_prompt = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["normal"])
    conversation_history = conversation_history or []

    format_instructions = ""
    if output_format == "bullets":
        format_instructions = "\n\nFormat your response as clear bullet points."
    elif output_format == "table":
        format_instructions = "\n\nFormat your response as a markdown table where appropriate."
    elif output_format == "flashcards":
        format_instructions = "\n\nGenerate 5-10 flashcards. Format: **Q:** question\n**A:** answer"
    elif output_format == "quiz":
        format_instructions = "\n\nGenerate 5 multiple choice questions with answers."
    elif output_format == "summary":
        format_instructions = "\n\nProvide a concise structured summary with key points."

    user_message = f"""CONTEXT FROM DOCUMENTS:
{context}

---

STUDENT QUERY: {query}{format_instructions}"""

    messages = []
    for msg in conversation_history[-6:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_message})

    # Yield citations early so frontend can show sources immediately
    yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"

    answer_parts = []
    prompt_tokens = 0
    completion_tokens = 0
    provider = settings.LLM_PROVIDER

    try:
        if provider == "ollama":
            client = get_ollama_client()
            payload = {
                "model": settings.OLLAMA_MODEL,
                "messages": [{"role": "system", "content": system_prompt}] + messages,
                "stream": True,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 2000,
                }
            }
            async with client.stream("POST", "/api/chat", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if "message" in data and "content" in data["message"]:
                        token = data["message"]["content"]
                        answer_parts.append(token)
                        yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                    if data.get("done"):
                        prompt_tokens = data.get("prompt_eval_count", 0)
                        completion_tokens = data.get("eval_count", 0)
        else:
            # Fallback: emit whole answer at once
            answer = _fallback_answer(query, chunks)
            answer_parts.append(answer)
            yield f"data: {json.dumps({'type': 'token', 'content': answer})}\n\n"

    except Exception as e:
        logger.error("LLM streaming failed", error=str(e), provider=provider)
        fallback = "\n\n".join(f"**{c.filename}** (Page {c.page_number}):\n{c.content[:300]}..." for c in chunks[:3]) if chunks else "No documents found."
        yield f"data: {json.dumps({'type': 'token', 'content': fallback})}\n\n"

    full_answer = "".join(answer_parts)
    tokens_used = prompt_tokens + completion_tokens

    # Signal completion
    yield f"data: {json.dumps({'type': 'done', 'answer': full_answer, 'tokens_used': tokens_used})}\n\n"
