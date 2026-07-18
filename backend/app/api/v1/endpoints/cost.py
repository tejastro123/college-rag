"""
Cost & Usage admin endpoints.

GET /admin/cost/summary          — overall token + USD totals
GET /admin/cost/by-user          — per-user breakdown with cost + budget + pct
GET /admin/cost/by-course        — per-course breakdown
GET /admin/cost/by-org           — per-org breakdown (from UsageRecord)
GET /admin/cost/daily            — daily token series (last N days) for charting
GET /admin/cost/forecast         — linear regression forecast
GET /admin/cost/model-comparison — pricing comparison across models for current usage
GET /admin/cost/budget           — list all budgets
POST /admin/cost/budget          — set/update budget
DELETE /admin/cost/budget/{type}/{id} — remove budget
GET /admin/cost/alerts           — entities currently over budget
"""
from __future__ import annotations

from datetime import datetime, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case

from app.db.database import get_db
from app.models.conversation import Conversation, Message
from app.models.user import User
from app.models.course import Course
from app.models.organization import Organization
from app.models.billing import UsageRecord
from app.auth.security import get_current_user
from app.core.logging import get_logger
from app.services.cost_tracking import (
    tokens_to_usd, compare_model_costs, forecast_tokens,
    get_budget, set_budget, delete_budget, list_budgets,
    MODEL_PRICING, ACTIVE_MODEL,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/admin/cost", tags=["Admin Cost"])


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _safe_tokens(val) -> int:
    try:
        return int(val or 0)
    except (ValueError, TypeError):
        return 0


# ── Summary ─────────────────────────────────────────────────────────────────

@router.get("/summary")
async def cost_summary(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow().date() - timedelta(days=days)

    # All assistant messages in period with token counts
    rows = (await db.execute(
        select(Message.tokens_used, Message.created_at)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
    )).all()

    total_tokens = sum(_safe_tokens(r.tokens_used) for r in rows)
    total_cost_usd = tokens_to_usd(total_tokens)
    msg_count = len(rows)

    # Previous period for growth
    prev_since = since - timedelta(days=days)
    prev_rows = (await db.execute(
        select(Message.tokens_used)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= prev_since)
        .where(Message.created_at < since)
    )).all()
    prev_tokens = sum(_safe_tokens(r.tokens_used) for r in prev_rows)

    growth = 0.0
    if prev_tokens > 0:
        growth = round(((total_tokens - prev_tokens) / prev_tokens) * 100, 1)

    return {
        "period_days": days,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost_usd,
        "messages": msg_count,
        "avg_tokens_per_message": round(total_tokens / msg_count, 1) if msg_count else 0,
        "avg_cost_per_message_usd": round(total_cost_usd / msg_count, 6) if msg_count else 0,
        "token_growth_pct": growth,
        "active_model": ACTIVE_MODEL,
        "active_model_label": MODEL_PRICING.get(ACTIVE_MODEL, {}).get("label", ACTIVE_MODEL),
    }


# ── Per-user ─────────────────────────────────────────────────────────────────

@router.get("/by-user")
async def cost_by_user(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow().date() - timedelta(days=days)

    # tokens per user (sum of Message.tokens_used joined to Conversation)
    rows = (await db.execute(
        select(
            Conversation.user_id,
            User.full_name,
            User.email,
            User.username,
            func.count(Message.id).label("messages"),
            func.sum(Message.tokens_used).label("tokens"),
        )
        .join(Message, Message.conversation_id == Conversation.id)
        .join(User, User.id == Conversation.user_id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
        .group_by(Conversation.user_id, User.full_name, User.email, User.username)
        .order_by(func.sum(Message.tokens_used).desc())
        .limit(limit)
    )).all()

    budgets = list_budgets()
    result = []
    for r in rows:
        tokens = _safe_tokens(r.tokens)
        cost = tokens_to_usd(tokens)
        budget_tokens = budgets.get(f"user:{r.user_id}")
        result.append({
            "user_id": r.user_id,
            "full_name": r.full_name,
            "email": r.email,
            "username": r.username,
            "messages": r.messages,
            "tokens": tokens,
            "cost_usd": cost,
            "budget_tokens": budget_tokens,
            "budget_pct": round((tokens / budget_tokens) * 100, 1) if budget_tokens else None,
            "over_budget": tokens > budget_tokens if budget_tokens else False,
        })

    return {"period_days": days, "users": result}


# ── Per-course ───────────────────────────────────────────────────────────────

@router.get("/by-course")
async def cost_by_course(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow().date() - timedelta(days=days)

    rows = (await db.execute(
        select(
            Conversation.course_id,
            Course.name,
            Course.code,
            func.count(Message.id).label("messages"),
            func.sum(Message.tokens_used).label("tokens"),
        )
        .join(Message, Message.conversation_id == Conversation.id)
        .outerjoin(Course, Course.id == Conversation.course_id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
        .group_by(Conversation.course_id, Course.name, Course.code)
        .order_by(func.sum(Message.tokens_used).desc())
        .limit(limit)
    )).all()

    budgets = list_budgets()
    result = []
    for r in rows:
        tokens = _safe_tokens(r.tokens)
        cost = tokens_to_usd(tokens)
        budget_tokens = budgets.get(f"course:{r.course_id}") if r.course_id else None
        result.append({
            "course_id": r.course_id,
            "name": r.name or "No Course",
            "code": r.code or "-",
            "messages": r.messages,
            "tokens": tokens,
            "cost_usd": cost,
            "budget_tokens": budget_tokens,
            "budget_pct": round((tokens / budget_tokens) * 100, 1) if budget_tokens else None,
            "over_budget": tokens > budget_tokens if budget_tokens else False,
        })

    return {"period_days": days, "courses": result}


# ── Per-org ──────────────────────────────────────────────────────────────────

@router.get("/by-org")
async def cost_by_org(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow().date() - timedelta(days=days)

    rows = (await db.execute(
        select(
            UsageRecord.organization_id,
            Organization.name,
            func.sum(UsageRecord.tokens_used).label("tokens"),
            func.sum(UsageRecord.api_calls).label("api_calls"),
        )
        .join(Organization, Organization.id == UsageRecord.organization_id)
        .where(UsageRecord.date >= since)
        .group_by(UsageRecord.organization_id, Organization.name)
        .order_by(func.sum(UsageRecord.tokens_used).desc())
    )).all()

    budgets = list_budgets()
    result = []
    for r in rows:
        tokens = _safe_tokens(r.tokens)
        cost = tokens_to_usd(tokens)
        budget_tokens = budgets.get(f"org:{r.organization_id}")
        result.append({
            "org_id": r.organization_id,
            "name": r.name,
            "tokens": tokens,
            "api_calls": r.api_calls or 0,
            "cost_usd": cost,
            "budget_tokens": budget_tokens,
            "budget_pct": round((tokens / budget_tokens) * 100, 1) if budget_tokens else None,
            "over_budget": tokens > budget_tokens if budget_tokens else False,
        })

    return {"period_days": days, "orgs": result}


# ── Daily series ──────────────────────────────────────────────────────────────

@router.get("/daily")
async def cost_daily(
    days: int = Query(30, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow().date() - timedelta(days=days)

    rows = (await db.execute(
        select(
            func.date(Message.created_at).label("day"),
            func.sum(Message.tokens_used).label("tokens"),
            func.count(Message.id).label("messages"),
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
        .group_by(func.date(Message.created_at))
        .order_by(func.date(Message.created_at))
    )).all()

    # Fill gaps
    row_map = {str(r.day): (_safe_tokens(r.tokens), r.messages) for r in rows}
    series = []
    for i in range(days):
        d = (since + timedelta(days=i)).isoformat()
        tokens, msgs = row_map.get(d, (0, 0))
        series.append({
            "date": d,
            "tokens": tokens,
            "cost_usd": tokens_to_usd(tokens),
            "messages": msgs,
        })

    return {"period_days": days, "series": series}


# ── Forecast ─────────────────────────────────────────────────────────────────

@router.get("/forecast")
async def cost_forecast(
    days: int = Query(30, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow().date() - timedelta(days=days)

    rows = (await db.execute(
        select(
            func.date(Message.created_at).label("day"),
            func.sum(Message.tokens_used).label("tokens"),
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
        .group_by(func.date(Message.created_at))
        .order_by(func.date(Message.created_at))
    )).all()

    row_map = {str(r.day): _safe_tokens(r.tokens) for r in rows}
    daily_tokens = [
        row_map.get((since + timedelta(days=i)).isoformat(), 0)
        for i in range(days)
    ]

    fc = forecast_tokens(daily_tokens)

    return {
        "historical_days": days,
        "historical_total_tokens": sum(daily_tokens),
        "historical_total_cost_usd": tokens_to_usd(sum(daily_tokens)),
        "forecast": {
            **fc,
            "projected_7d_cost_usd": tokens_to_usd(fc["projected_7d"]),
            "projected_30d_cost_usd": tokens_to_usd(fc["projected_30d"]),
        },
        "active_model": ACTIVE_MODEL,
    }


# ── Model comparison ──────────────────────────────────────────────────────────

@router.get("/model-comparison")
async def model_comparison(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow().date() - timedelta(days=days)

    total_tokens = (await db.execute(
        select(func.sum(Message.tokens_used))
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
    )).scalar() or 0
    total_tokens = _safe_tokens(total_tokens)

    return {
        "period_days": days,
        "total_tokens": total_tokens,
        "models": compare_model_costs(total_tokens),
        "pricing_registry": MODEL_PRICING,
    }


# ── Budget CRUD ───────────────────────────────────────────────────────────────

class BudgetRequest(BaseModel):
    entity_type: str   # user | course | org
    entity_id: str
    tokens: int        # token budget limit


@router.get("/budget")
async def get_all_budgets(admin: User = Depends(require_admin)):
    raw = list_budgets()
    result = []
    for key, tokens in raw.items():
        entity_type, entity_id = key.split(":", 1)
        result.append({
            "key": key,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "tokens": tokens,
            "cost_usd_limit": tokens_to_usd(tokens),
        })
    return {"budgets": result}


@router.post("/budget", status_code=201)
async def upsert_budget(
    req: BudgetRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    if req.entity_type not in ("user", "course", "org"):
        raise HTTPException(status_code=400, detail="entity_type must be user|course|org")
    if req.tokens <= 0:
        raise HTTPException(status_code=400, detail="tokens must be positive")
    set_budget(req.entity_type, req.entity_id, req.tokens)
    
    from app.api.v1.endpoints.admin import write_audit_log
    await write_audit_log(
        db=db,
        action="upsert_budget",
        resource_type=req.entity_type,
        resource_id=req.entity_id,
        user_id=admin.id,
        details={"tokens": req.tokens}
    )
    await db.commit()
    
    return {"ok": True, "key": f"{req.entity_type}:{req.entity_id}", "tokens": req.tokens}


@router.delete("/budget/{entity_type}/{entity_id}", status_code=204)
async def remove_budget(
    entity_type: str,
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin)
):
    delete_budget(entity_type, entity_id)
    
    from app.api.v1.endpoints.admin import write_audit_log
    await write_audit_log(
        db=db,
        action="remove_budget",
        resource_type=entity_type,
        resource_id=entity_id,
        user_id=admin.id
    )
    await db.commit()


# ── Budget alert check ────────────────────────────────────────────────────────

@router.get("/alerts")
async def budget_alerts(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Return users/courses/orgs currently exceeding their token budgets."""
    since = datetime.utcnow().date() - timedelta(days=days)
    budgets = list_budgets()
    if not budgets:
        return {"alerts": [], "period_days": days}

    # User budgets
    user_budgets = {k.split(":")[1]: v for k, v in budgets.items() if k.startswith("user:")}
    course_budgets = {k.split(":")[1]: v for k, v in budgets.items() if k.startswith("course:")}

    alerts = []

    if user_budgets:
        user_rows = (await db.execute(
            select(
                Conversation.user_id,
                User.full_name,
                User.email,
                func.sum(Message.tokens_used).label("tokens"),
            )
            .join(Message, Message.conversation_id == Conversation.id)
            .join(User, User.id == Conversation.user_id)
            .where(Message.role == "assistant")
            .where(Message.created_at >= since)
            .where(Conversation.user_id.in_(list(user_budgets.keys())))
            .group_by(Conversation.user_id, User.full_name, User.email)
        )).all()

        for r in user_rows:
            tokens = _safe_tokens(r.tokens)
            budget = user_budgets.get(r.user_id, 0)
            if tokens >= budget:
                alerts.append({
                    "type": "user",
                    "entity_id": r.user_id,
                    "label": f"{r.full_name} ({r.email})",
                    "tokens_used": tokens,
                    "budget_tokens": budget,
                    "pct": round((tokens / budget) * 100, 1),
                    "cost_usd": tokens_to_usd(tokens),
                    "level": "error" if tokens > budget else "warning",
                })

    if course_budgets:
        course_rows = (await db.execute(
            select(
                Conversation.course_id,
                Course.name,
                func.sum(Message.tokens_used).label("tokens"),
            )
            .join(Message, Message.conversation_id == Conversation.id)
            .join(Course, Course.id == Conversation.course_id)
            .where(Message.role == "assistant")
            .where(Message.created_at >= since)
            .where(Conversation.course_id.in_(list(course_budgets.keys())))
            .group_by(Conversation.course_id, Course.name)
        )).all()

        for r in course_rows:
            tokens = _safe_tokens(r.tokens)
            budget = course_budgets.get(r.course_id, 0)
            if tokens >= budget:
                alerts.append({
                    "type": "course",
                    "entity_id": r.course_id,
                    "label": r.name or r.course_id,
                    "tokens_used": tokens,
                    "budget_tokens": budget,
                    "pct": round((tokens / budget) * 100, 1),
                    "cost_usd": tokens_to_usd(tokens),
                    "level": "error" if tokens > budget else "warning",
                })

    return {"alerts": sorted(alerts, key=lambda x: x["pct"], reverse=True), "period_days": days}
