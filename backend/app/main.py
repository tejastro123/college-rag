"""
CollegeRAG - FastAPI Application Entry Point
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.db.database import init_db, seed_admin
from app.api.v1.api import api_router

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("Starting CollegeRAG", version=settings.APP_VERSION)

    # Ensure data directories exist
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.CHROMA_PERSIST_DIR).mkdir(parents=True, exist_ok=True)

    # Initialize database
    await init_db()
    logger.info("Database initialized")

    # Seed admin user
    try:
        await seed_admin()
    except Exception as e:
        logger.warning("Admin seed skipped", error=str(e))

    # Warm up vector store
    try:
        from app.embeddings.vector_store import get_vector_store
        await get_vector_store()
        logger.info("Vector store ready")
    except Exception as e:
        logger.warning("Vector store warmup failed", error=str(e))

    # Initialize rate limiter
    try:
        from app.middleware.rate_limit import init_rate_limiter
        init_rate_limiter()
        logger.info("Rate limiter ready")
    except Exception as e:
        logger.warning("Rate limiter init skipped", error=str(e))

    yield

    logger.info("CollegeRAG shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Advanced Academic RAG Platform for College Students",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# ── Middleware ─────────────────────────────────────────────
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Sentry ─────────────────────────────────────────────────
if settings.SENTRY_DSN:
    import sentry_sdk
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment="production" if not settings.DEBUG else "development",
        traces_sample_rate=0.1,
    )
    logger.info("Sentry initialized")

# ── Rate Limiting ──────────────────────────────────────────
if settings.RATE_LIMIT_ENABLED:
    from app.middleware.rate_limit import RateLimitMiddleware
    app.add_middleware(RateLimitMiddleware)

# ── Routes ─────────────────────────────────────────────────
app.include_router(api_router, prefix="/api/v1")

# ── Monitoring ────────────────────────────────────────────
from app.monitoring.endpoints import router as metrics_router
app.include_router(metrics_router)


@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "status": "running",
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "version": settings.APP_VERSION}
