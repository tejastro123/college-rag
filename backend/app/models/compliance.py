import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.db.database import Base


class DataResidencyConfig(Base):
    __tablename__ = "data_residency_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scope: Mapped[str] = mapped_column(String(50), default="system")  # system | organization
    scope_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)  # org_id or none
    allowed_regions: Mapped[list[str]] = mapped_column(JSON, default=list)  # ["US", "EU", "APAC"]
    enforce_strict: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EncryptionKey(Base):
    __tablename__ = "encryption_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    key_alias: Mapped[str] = mapped_column(String(100), default="master-doc-key")
    algorithm: Mapped[str] = mapped_column(String(50), default="AES-256-GCM")
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | retired
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    rotated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
