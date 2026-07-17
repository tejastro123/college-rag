"""WebSocket connection manager for real-time chat."""
from __future__ import annotations

import json
from typing import Optional
from fastapi import WebSocket

from app.core.logging import get_logger

logger = get_logger(__name__)


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.setdefault(user_id, []).append(ws)
        logger.info("WS connected", user_id=user_id)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        conns = self._connections.get(user_id, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(user_id, None)
        logger.info("WS disconnected", user_id=user_id)

    async def send_json(self, user_id: str, data: dict) -> None:
        conns = self._connections.get(user_id, [])
        dead = []
        for ws in conns:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)

    async def broadcast(self, data: dict) -> None:
        for user_id in list(self._connections.keys()):
            await self.send_json(user_id, data)

    @property
    def active_connections(self) -> int:
        return sum(len(v) for v in self._connections.values())


manager = ConnectionManager()
