"""Document and Chunk models."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Text, Integer, Float, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    course_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("courses.id"), nullable=True)

    # File info
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)  # pdf|docx|pptx|txt|md|image
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=True)
    checksum: Mapped[str] = mapped_column(String(64), nullable=True)  # SHA256 for dedup

    # Academic metadata
    title: Mapped[str] = mapped_column(String(500), nullable=True)
    author: Mapped[str] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=True)
    semester: Mapped[str] = mapped_column(String(50), nullable=True)
    unit: Mapped[str] = mapped_column(String(255), nullable=True)
    doc_type: Mapped[str] = mapped_column(String(100), nullable=True)  # lecture|assignment|exam|manual|notes
    language: Mapped[str] = mapped_column(String(20), default="en")
    tags: Mapped[Optional[dict]] = mapped_column("tags", JSON, nullable=True)

    # Processing status
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending|processing|indexed|failed
    error_message: Mapped[str] = mapped_column(Text, nullable=True)
    total_pages: Mapped[int] = mapped_column(Integer, default=0)
    total_chunks: Mapped[int] = mapped_column(Integer, default=0)
    is_ocr_processed: Mapped[bool] = mapped_column(Boolean, default=False)

    # Access control
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    indexed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relationships
    owner: Mapped["User"] = relationship("User", back_populates="documents")  # noqa: F821
    course: Mapped[Optional["Course"]] = relationship("Course", back_populates="documents")  # noqa: F821
    chunks: Mapped[list["Chunk"]] = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(String(36), ForeignKey("documents.id"), nullable=False)
    vector_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # ID in vector store

    content: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    chunk_type: Mapped[str] = mapped_column(String(50), default="text")  # text|table|formula|code|figure

    # Position info
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    section: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    heading: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Rich metadata
    meta: Mapped[Optional[dict]] = mapped_column("meta", JSON, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    char_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationship
    document: Mapped["Document"] = relationship("Document", back_populates="chunks")
