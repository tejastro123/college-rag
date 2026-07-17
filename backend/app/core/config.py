"""
CollegeRAG - Advanced Academic RAG Platform
Core configuration settings
"""
from __future__ import annotations

import json
from typing import List, Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ────────────────────────────────────────────────
    APP_NAME: str = "CollegeRAG"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days

    # ── Database ───────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./rag_platform.db"

    # ── Vector Store ───────────────────────────────────────
    CHROMA_PERSIST_DIR: str = "./data/chroma"
    CHROMA_COLLECTION_NAME: str = "rag_documents"

    # ── File Storage ───────────────────────────────────────
    UPLOAD_DIR: str = "./data/uploads"
    MAX_FILE_SIZE_MB: int = 100

    # ── LLM ────────────────────────────────────────────────
    LLM_PROVIDER: str = "ollama"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "mistral"
    OLLAMA_EMBEDDING_MODEL: str = "nomic-embed-text"

    # ── Cohere (reranking) ─────────────────────────────────
    COHERE_API_KEY: Optional[str] = None

    # ── Redis ──────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── OCR ────────────────────────────────────────────────
    TESSERACT_CMD: str = "tesseract"

    # ── Retrieval ──────────────────────────────────────────
    RETRIEVAL_TOP_K: int = 10
    RERANK_TOP_K: int = 5
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 100

    # ── CORS ───────────────────────────────────────────────
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_origins(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return [o.strip() for o in v.split(",")]
        return v

    # ── Logging ────────────────────────────────────────────
    LOG_LEVEL: str = "INFO"

    @property
    def active_llm_model(self) -> str:
        return self.OLLAMA_MODEL

    @property
    def active_llm_key(self) -> Optional[str]:
        return "local"


settings = Settings()
