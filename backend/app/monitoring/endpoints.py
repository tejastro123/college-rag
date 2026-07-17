"""FastAPI endpoint for exposing Prometheus metrics."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from prometheus_client import generate_latest, REGISTRY

router = APIRouter(tags=["monitoring"])


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return PlainTextResponse(content=generate_latest(REGISTRY).decode("utf-8"))
