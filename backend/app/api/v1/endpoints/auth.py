"""Authentication endpoints: register, login, me."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.db.database import get_db
from app.models.user import User
from app.auth.security import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=50)
    full_name: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=8)
    role: str = "student"
    department: str = ""
    semester: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    full_name: str
    role: str
    department: str | None
    semester: str | None
    is_active: bool


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check duplicates
    existing = await db.execute(
        select(User).where((User.email == data.email) | (User.username == data.username))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email or username already registered")

    user = User(
        email=data.email,
        username=data.username,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        role=data.role if data.role in ("student", "ta", "faculty") else "student",
        department=data.department or None,
        semester=data.semester or None,
        is_verified=True,  # skip email verification for now
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "email": user.email, "username": user.username,
              "full_name": user.full_name, "role": user.role},
    )


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "email": user.email, "username": user.username,
              "full_name": user.full_name, "role": user.role},
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        department=current_user.department,
        semester=current_user.semester,
        is_active=current_user.is_active,
    )


class ProfileUpdateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    username: str = Field(min_length=3, max_length=50)
    department: str | None = None
    semester: str | None = None


class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)


@router.put("/profile", response_model=UserResponse)
async def update_profile(
    data: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.username != current_user.username:
        existing = await db.execute(
            select(User).where(User.username == data.username)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already taken")

    current_user.full_name = data.full_name
    current_user.username = data.username
    current_user.department = data.department
    current_user.semester = data.semester

    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.put("/password")
async def update_password(
    data: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect old password")

    current_user.hashed_password = hash_password(data.new_password)
    await db.commit()
    return {"status": "success", "message": "Password updated successfully"}
