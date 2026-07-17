"""Study tools endpoints: flashcards, quizzes, summaries."""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.models.document import Document
from app.models.user import User
from app.auth.security import get_current_user
from app.rag.pipeline import run_rag

router = APIRouter(prefix="/study", tags=["Study Tools"])


class StudyRequest(BaseModel):
    course_id: Optional[str] = None
    document_ids: Optional[list[str]] = None
    topic: Optional[str] = None
    count: int = 10


@router.post("/flashcards")
async def generate_flashcards(
    request: StudyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate Q&A flashcards from uploaded material."""
    query = f"Generate {request.count} flashcards covering key concepts" + (
        f" about {request.topic}" if request.topic else ""
    )
    result = await run_rag(
        query=query,
        db=db,
        mode="revision",
        output_format="flashcards",
        course_id=request.course_id,
        document_ids=request.document_ids,
        user_id=current_user.id,
        generate_follow_ups=False,
    )
    return {
        "flashcards_text": result.answer,
        "citations": result.citations,
        "confidence": result.confidence,
    }


@router.post("/quiz")
async def generate_quiz(
    request: StudyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate multiple choice quiz questions."""
    query = f"Generate {request.count} multiple choice quiz questions" + (
        f" about {request.topic}" if request.topic else " covering the main topics"
    )
    result = await run_rag(
        query=query,
        db=db,
        mode="exam",
        output_format="quiz",
        course_id=request.course_id,
        document_ids=request.document_ids,
        user_id=current_user.id,
        generate_follow_ups=False,
    )
    return {
        "quiz_text": result.answer,
        "citations": result.citations,
        "confidence": result.confidence,
    }


@router.post("/summary")
async def generate_summary(
    request: StudyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a comprehensive summary of uploaded material."""
    query = "Summarize all the key topics, concepts, and important points" + (
        f" related to {request.topic}" if request.topic else " from the document"
    )
    result = await run_rag(
        query=query,
        db=db,
        mode="revision",
        output_format="summary",
        course_id=request.course_id,
        document_ids=request.document_ids,
        user_id=current_user.id,
        generate_follow_ups=False,
    )
    return {
        "summary": result.answer,
        "citations": result.citations,
        "confidence": result.confidence,
    }


@router.post("/formula-sheet")
async def generate_formula_sheet(
    request: StudyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Extract all formulas and equations from documents."""
    query = "List all mathematical formulas, equations, and expressions with explanations"
    result = await run_rag(
        query=query,
        db=db,
        mode="strict",
        output_format="bullets",
        course_id=request.course_id,
        document_ids=request.document_ids,
        user_id=current_user.id,
        generate_follow_ups=False,
    )
    return {
        "formula_sheet": result.answer,
        "citations": result.citations,
    }
