"""
Event bus: thin wrapper to broadcast admin dashboard events.
Import admin_ws_manager lazily to avoid circular imports.
"""
from __future__ import annotations

import asyncio
import hmac
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import select

from app.core.logging import get_logger
from app.db.database import AsyncSessionLocal
from app.models.security import WebhookSubscription

logger = get_logger(__name__)


async def emit_admin_event(event: str, data: dict, swallow: bool = True) -> None:
    """Broadcast an event to all connected admin WebSocket clients."""
    try:
        # Lazy import prevents circular dependency with admin.py
        from app.api.v1.endpoints.admin import admin_ws_manager
        await admin_ws_manager.broadcast(event, {
            **data,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        if swallow:
            logger.warning("emit_admin_event failed", event=event, error=str(exc))
        else:
            raise


async def emit_ingestion_event(
    doc_id: str,
    filename: str,
    status: str,
    chunks: Optional[int] = None,
    error: Optional[str] = None,
    course_id: Optional[str] = None,
) -> None:
    await emit_admin_event("ingestion:update", {
        "doc_id": doc_id,
        "filename": filename,
        "status": status,
        "chunks": chunks,
        "error": error,
        "course_id": course_id,
    })
    if status == "completed":
        org_id = None
        if course_id:
            try:
                from app.models.course import Course
                async with AsyncSessionLocal() as session:
                    res = await session.execute(select(Course.organization_id).where(Course.id == course_id))
                    org_id = res.scalar_one_or_none()
            except Exception:
                pass
        asyncio.create_task(trigger_webhooks(
            "document.ingested",
            {
                "doc_id": doc_id,
                "filename": filename,
                "chunks": chunks,
                "course_id": course_id
            },
            organization_id=org_id
        ))


async def emit_audit_event(
    action: str,
    resource_type: Optional[str],
    resource_id: Optional[str],
    user_id: Optional[str],
    details: Optional[dict] = None,
    ip_address: Optional[str] = None,
) -> None:
    await emit_admin_event("audit:entry", {
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "user_id": user_id,
        "details": details,
        "ip_address": ip_address,
    })


# Alert thresholds (configurable)
ALERT_THRESHOLDS = {
    "error_spike_pct": 20.0,        # % failed docs triggers alert
    "ingestion_failure_count": 3,   # consecutive failures
    "storage_threshold_gb": 10.0,   # storage warning at Xgb
    "latency_p95_ms": 5000.0,       # slow query warning
}


async def check_and_emit_alerts(stats: dict) -> None:
    """Check stats snapshot against thresholds and emit alert events."""
    alerts = []

    failed_docs = stats.get("failed_ingestions", 0)
    total_docs = stats.get("documents", 0)
    if total_docs > 0:
        error_pct = (failed_docs / total_docs) * 100
        if error_pct >= ALERT_THRESHOLDS["error_spike_pct"]:
            alerts.append({
                "level": "error",
                "type": "ingestion_error_spike",
                "message": f"Ingestion failure rate {error_pct:.1f}% ({failed_docs}/{total_docs} docs)",
                "value": error_pct,
                "threshold": ALERT_THRESHOLDS["error_spike_pct"],
            })

    storage_gb = stats.get("storage_bytes", 0) / (1024 ** 3)
    if storage_gb >= ALERT_THRESHOLDS["storage_threshold_gb"]:
        alerts.append({
            "level": "warning",
            "type": "storage_threshold",
            "message": f"Storage usage {storage_gb:.2f} GB exceeds threshold",
            "value": storage_gb,
            "threshold": ALERT_THRESHOLDS["storage_threshold_gb"],
        })

    latency_p95 = stats.get("latency_p95")
    if latency_p95 and latency_p95 >= ALERT_THRESHOLDS["latency_p95_ms"]:
        alerts.append({
            "level": "warning",
            "type": "high_latency",
            "message": f"P95 query latency {latency_p95:.0f}ms exceeds {ALERT_THRESHOLDS['latency_p95_ms']:.0f}ms",
            "value": latency_p95,
            "threshold": ALERT_THRESHOLDS["latency_p95_ms"],
        })

    for alert in alerts:
        await emit_admin_event("alert:triggered", alert)
        asyncio.create_task(trigger_webhooks("alert.triggered", alert))


async def dispatch_webhook(url: str, secret: str, payload: dict) -> None:
    body = json.dumps(payload)
    signature = hmac.new(
        secret.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    
    headers = {
        "Content-Type": "application/json",
        "X-Collegerag-Signature": signature,
        "User-Agent": "CollegeRAG-Webhook-Dispatcher/1.0"
    }
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(url, content=body, headers=headers)
            logger.info("Webhook dispatched successfully", url=url, status_code=resp.status_code)
    except Exception as exc:
        logger.warning("Webhook dispatch failed", url=url, error=str(exc))


async def trigger_webhooks(event_type: str, data: dict, organization_id: Optional[str] = None) -> None:
    try:
        async with AsyncSessionLocal() as session:
            query = select(WebhookSubscription).where(
                WebhookSubscription.is_active == True
            )
            result = await session.execute(query)
            subscriptions = result.scalars().all()
            
            to_dispatch = []
            for sub in subscriptions:
                if event_type not in sub.event_types:
                    continue
                if sub.organization_id and sub.organization_id != organization_id:
                    continue
                to_dispatch.append(sub)
                
            if not to_dispatch:
                return
                
            payload = {
                "event": event_type,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": data
            }
            
            tasks = [
                dispatch_webhook(sub.url, sub.secret, payload)
                for sub in to_dispatch
            ]
            await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as exc:
        logger.warning("trigger_webhooks execution failed", error=str(exc))
