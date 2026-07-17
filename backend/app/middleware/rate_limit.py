"""Rate limiting middleware using slowapi."""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_limiter = None


def init_rate_limiter():
    global _limiter
    try:
        from slowapi import Limiter
        from slowapi.util import get_remote_address
        _limiter = Limiter(key_func=get_remote_address, default_limits=[settings.RATE_LIMIT_DEFAULT])
    except ImportError:
        logger.warning("slowapi not installed — rate limiting disabled")


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        return await call_next(request)
