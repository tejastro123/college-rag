"""Course management endpoints."""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.models.course import Course, UserCourse
from app.models.user import User
from app.auth.security import get_current_user

router = APIRouter(prefix="/courses", tags=["Courses"])


class CourseCreate(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    semester: Optional[str] = None
    year: Optional[str] = None
    department: Optional[str] = None
    professor: Optional[str] = None
    color: str = "#6366f1"
    icon: str = "📚"


class CourseResponse(BaseModel):
    id: str
    name: str
    code: Optional[str]
    description: Optional[str]
    semester: Optional[str]
    year: Optional[str]
    department: Optional[str]
    professor: Optional[str]
    color: str
    icon: str
    is_active: bool
    created_at: str


@router.post("/", response_model=CourseResponse, status_code=201)
async def create_course(
    data: CourseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = Course(
        owner_id=current_user.id,
        name=data.name,
        code=data.code,
        description=data.description,
        semester=data.semester,
        year=data.year,
        department=data.department,
        professor=data.professor,
        color=data.color,
        icon=data.icon,
    )
    db.add(course)
    await db.flush()

    # Auto-join as owner
    uc = UserCourse(user_id=current_user.id, course_id=course.id, role="owner")
    db.add(uc)
    await db.commit()
    await db.refresh(course)

    return CourseResponse(
        id=course.id, name=course.name, code=course.code,
        description=course.description, semester=course.semester,
        year=course.year, department=course.department,
        professor=course.professor, color=course.color,
        icon=course.icon, is_active=course.is_active,
        created_at=str(course.created_at),
    )


@router.get("/", response_model=list[CourseResponse])
async def list_courses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.owner_id == current_user.id, Course.is_active == True)
        .order_by(Course.created_at.desc())
    )
    courses = result.scalars().all()
    return [
        CourseResponse(
            id=c.id, name=c.name, code=c.code, description=c.description,
            semester=c.semester, year=c.year, department=c.department,
            professor=c.professor, color=c.color, icon=c.icon,
            is_active=c.is_active, created_at=str(c.created_at),
        )
        for c in courses
    ]


@router.get("/{course_id}", response_model=CourseResponse)
async def get_course(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.owner_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return CourseResponse(
        id=course.id, name=course.name, code=course.code,
        description=course.description, semester=course.semester,
        year=course.year, department=course.department,
        professor=course.professor, color=course.color,
        icon=course.icon, is_active=course.is_active,
        created_at=str(course.created_at),
    )


@router.delete("/{course_id}", status_code=204)
async def delete_course(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.owner_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    course.is_active = False
    await db.commit()
