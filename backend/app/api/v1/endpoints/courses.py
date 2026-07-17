"""Course management endpoints with UserCourse-based RBAC."""
from __future__ import annotations

import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

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
    role: Optional[str] = None
    member_count: int = 0
    created_at: str


async def require_course_member(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> tuple[Course, UserCourse]:
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.is_active == True)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    uc_result = await db.execute(
        select(UserCourse).where(
            UserCourse.course_id == course_id,
            UserCourse.user_id == current_user.id,
        )
    )
    uc = uc_result.scalar_one_or_none()
    if not uc:
        raise HTTPException(status_code=403, detail="Not a member of this course")
    return course, uc


def _course_to_response(course: Course, role: Optional[str] = None, member_count: int = 0) -> CourseResponse:
    return CourseResponse(
        id=course.id, name=course.name, code=course.code,
        description=course.description, semester=course.semester,
        year=course.year, department=course.department,
        professor=course.professor, color=course.color,
        icon=course.icon, is_active=course.is_active,
        role=role, member_count=member_count,
        created_at=str(course.created_at),
    )


@router.post("/", response_model=CourseResponse, status_code=201)
async def create_course(
    data: CourseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course = Course(
        owner_id=current_user.id,
        name=data.name, code=data.code, description=data.description,
        semester=data.semester, year=data.year, department=data.department,
        professor=data.professor, color=data.color, icon=data.icon,
    )
    db.add(course)
    await db.flush()
    uc = UserCourse(user_id=current_user.id, course_id=course.id, role="owner")
    db.add(uc)
    await db.commit()
    await db.refresh(course)
    return _course_to_response(course, role="owner", member_count=1)


@router.get("/", response_model=list[CourseResponse])
async def list_courses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course)
        .join(UserCourse, UserCourse.course_id == Course.id)
        .where(UserCourse.user_id == current_user.id, Course.is_active == True)
        .order_by(Course.created_at.desc())
    )
    courses = result.scalars().all()
    responses = []
    for c in courses:
        uc_result = await db.execute(
            select(UserCourse).where(
                UserCourse.course_id == c.id,
                UserCourse.user_id == current_user.id,
            )
        )
        uc = uc_result.scalar_one_or_none()
        count_result = await db.execute(
            select(UserCourse).where(UserCourse.course_id == c.id)
        )
        member_count = len(count_result.scalars().all())
        responses.append(_course_to_response(c, role=uc.role if uc else "member", member_count=member_count))
    return responses


@router.get("/{course_id}", response_model=CourseResponse)
async def get_course(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.id == course_id)
        .join(UserCourse, UserCourse.course_id == Course.id)
        .where(UserCourse.user_id == current_user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    uc_result = await db.execute(
        select(UserCourse).where(
            UserCourse.course_id == course_id,
            UserCourse.user_id == current_user.id,
        )
    )
    uc = uc_result.scalar_one_or_none()
    count_result = await db.execute(
        select(UserCourse).where(UserCourse.course_id == course_id)
    )
    member_count = len(count_result.scalars().all())
    return _course_to_response(course, role=uc.role if uc else None, member_count=member_count)


@router.get("/{course_id}/members")
async def list_members(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course, _ = await require_course_member(course_id, db, current_user)
    result = await db.execute(
        select(UserCourse).where(UserCourse.course_id == course_id)
    )
    members = result.scalars().all()
    member_list = []
    for m in members:
        user_result = await db.execute(select(User).where(User.id == m.user_id))
        u = user_result.scalar_one_or_none()
        if u:
            member_list.append({
                "user_id": u.id, "username": u.username, "full_name": u.full_name,
                "email": u.email, "role": m.role, "joined_at": str(m.joined_at),
            })
    return member_list


@router.post("/join")
async def join_course(
    code: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Course).where(Course.code == code, Course.is_active == True)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found with that code")
    existing = await db.execute(
        select(UserCourse).where(
            UserCourse.course_id == course.id,
            UserCourse.user_id == current_user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already a member of this course")
    uc = UserCourse(user_id=current_user.id, course_id=course.id, role="member")
    db.add(uc)
    await db.commit()
    return {"message": "Joined course", "course_id": course.id, "name": course.name}


@router.post("/{course_id}/invite")
async def invite_member(
    course_id: str,
    email: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course, uc = await require_course_member(course_id, db, current_user)
    if uc.role not in ("owner", "admin", "ta"):
        raise HTTPException(status_code=403, detail="Insufficient permissions to invite")
    user_result = await db.execute(select(User).where(User.email == email))
    target = user_result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found with that email")
    existing = await db.execute(
        select(UserCourse).where(
            UserCourse.course_id == course_id,
            UserCourse.user_id == target.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User is already a member")
    uc_new = UserCourse(user_id=target.id, course_id=course_id, role="member")
    db.add(uc_new)
    await db.commit()
    return {"message": "User invited", "user_id": target.id}


@router.put("/{course_id}/role/{user_id}")
async def update_member_role(
    course_id: str,
    user_id: str,
    role: str = Query(..., pattern=r"^(owner|admin|ta|member|viewer)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course, uc = await require_course_member(course_id, db, current_user)
    if uc.role != "owner":
        raise HTTPException(status_code=403, detail="Only the course owner can change roles")
    target_uc = await db.execute(
        select(UserCourse).where(
            UserCourse.course_id == course_id,
            UserCourse.user_id == user_id,
        )
    )
    target = target_uc.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User is not a member of this course")
    target.role = role
    await db.commit()
    return {"message": "Role updated"}


@router.delete("/{course_id}/members/{user_id}", status_code=204)
async def remove_member(
    course_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course, uc = await require_course_member(course_id, db, current_user)
    if uc.role not in ("owner", "admin", "ta"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    target_uc = await db.execute(
        select(UserCourse).where(
            UserCourse.course_id == course_id,
            UserCourse.user_id == user_id,
        )
    )
    target = target_uc.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User is not a member")
    if target.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove the course owner")
    await db.delete(target)
    await db.commit()


@router.delete("/{course_id}", status_code=204)
async def delete_course(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    course, uc = await require_course_member(course_id, db, current_user)
    if uc.role != "owner":
        raise HTTPException(status_code=403, detail="Only the course owner can delete")
    course.is_active = False
    await db.commit()
