"""Search tuning and analytics models."""
from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class SearchSetting(Base):
    __tablename__ = "search_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)


class SearchAnalytics(Base):
    __tablename__ = "search_analytics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    query: Mapped[str] = mapped_column(String(1000), nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    clicked: Mapped[bool] = mapped_column(Boolean, default=False)
    click_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reformulated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
