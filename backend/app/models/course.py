"""Course and UserCourse models."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.database import Base


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    semester: Mapped[str] = mapped_column(String(50), nullable=True)
    year: Mapped[str] = mapped_column(String(10), nullable=True)
    department: Mapped[str] = mapped_column(String(255), nullable=True)
    professor: Mapped[str] = mapped_column(String(255), nullable=True)
    color: Mapped[str] = mapped_column(String(20), default="#6366f1")
    icon: Mapped[str] = mapped_column(String(50), default="📚")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="course")  # noqa: F821
    members: Mapped[list["UserCourse"]] = relationship("UserCourse", back_populates="course")


class UserCourse(Base):
    __tablename__ = "user_courses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="member")  # owner|member|viewer
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="courses")  # noqa: F821
    course: Mapped["Course"] = relationship("Course", back_populates="members")
