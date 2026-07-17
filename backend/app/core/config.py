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
    SENTRY_DSN: Optional[str] = None

    # ── Database ───────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./rag_platform.db"

    # ── Vector Store ───────────────────────────────────────
    CHROMA_PERSIST_DIR: str = "./data/chroma"
    CHROMA_COLLECTION_NAME: str = "rag_documents"
    CHROMA_HOST: Optional[str] = None
    CHROMA_PORT: Optional[int] = None

    # ── File Storage ───────────────────────────────────────
    STORAGE_BACKEND: str = "local"  # local | s3
    UPLOAD_DIR: str = "./data/uploads"
    MAX_FILE_SIZE_MB: int = 100

    # S3 / MinIO
    S3_ENDPOINT: Optional[str] = None
    S3_ACCESS_KEY: Optional[str] = None
    S3_SECRET_KEY: Optional[str] = None
    S3_BUCKET_NAME: str = "rag-uploads"
    S3_REGION: str = "us-east-1"

    # ── LLM ────────────────────────────────────────────────
    LLM_PROVIDER: str = "ollama"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "mistral"
    OLLAMA_EMBEDDING_MODEL: str = "nomic-embed-text"
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    GROQ_API_KEY: Optional[str] = None
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    ANTHROPIC_API_KEY: Optional[str] = None
    ANTHROPIC_MODEL: str = "claude-3-haiku-20240307"

    # ── Embeddings ─────────────────────────────────────────
    EMBEDDING_PROVIDER: str = "auto"  # ollama | sentence-transformers | auto
    SENTENCE_TRANSFORMERS_MODEL: str = "all-mpnet-base-v2"  # 768-dim, matches nomic-embed-text
    SENTENCE_TRANSFORMERS_CACHE: str = "./data/sentence_transformers"

    # ── Cohere (reranking) ─────────────────────────────────
    COHERE_API_KEY: Optional[str] = None

    # ── Reranking ──────────────────────────────────────────
    RERANK_PROVIDER: str = "auto"  # cohere | local | auto (try cohere → fallback local)
    RERANK_MODEL: str = "BAAI/bge-reranker-base"

    # ── Redis ──────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Semantic Cache ─────────────────────────────────────
    CACHE_ENABLED: bool = True
    CACHE_TTL: int = 3600  # 1 hour

    # ── OCR ────────────────────────────────────────────────
    TESSERACT_CMD: str = "tesseract"

    # ── Retrieval ──────────────────────────────────────────
    RETRIEVAL_TOP_K: int = 10
    RERANK_TOP_K: int = 5
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 100
    CHUNKING_STRATEGY: str = "hierarchical"  # hierarchical | recursive

    # ── BM25 Index ─────────────────────────────────────────
    BM25_INDEX_DIR: str = "./data/bm25"
    BM25_SEARCH_K: int = 40

    # ── Query Expansion ────────────────────────────────────
    QUERY_EXPANSION_ENABLED: bool = True
    QUERY_EXPANSION_VARIANTS: int = 3

    # ── HyDE ───────────────────────────────────────────────
    HYDE_ENABLED: bool = True

    # ── Rate Limiting ──────────────────────────────────────
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT: str = "60/minute"

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

    # ── Admin Seed ─────────────────────────────────────────
    ADMIN_EMAIL: str = "admin@collegerag.com"
    ADMIN_PASSWORD: str = "admin123"
    ADMIN_USERNAME: str = "admin"
    ADMIN_FULL_NAME: str = "System Administrator"

    # ── Logging ────────────────────────────────────────────
    LOG_LEVEL: str = "INFO"

    @property
    def active_llm_model(self) -> str:
        if self.LLM_PROVIDER == "openai":
            return self.OPENAI_MODEL
        elif self.LLM_PROVIDER == "groq":
            return self.GROQ_MODEL
        elif self.LLM_PROVIDER == "anthropic":
            return self.ANTHROPIC_MODEL
        return self.OLLAMA_MODEL

    @property
    def active_llm_key(self) -> Optional[str]:
        if self.LLM_PROVIDER == "openai":
            return self.OPENAI_API_KEY
        elif self.LLM_PROVIDER == "groq":
            return self.GROQ_API_KEY
        elif self.LLM_PROVIDER == "anthropic":
            return self.ANTHROPIC_API_KEY
        return None


settings = Settings()
