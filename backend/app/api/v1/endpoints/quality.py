"""
Quality & RAG Eval admin endpoints.

GET /admin/quality/summary           — overall quality KPIs
GET /admin/quality/flagged           — auto-flagged low-quality messages
GET /admin/quality/distribution      — score histogram + percentile table
GET /admin/quality/rag-eval          — retrieval precision + faithfulness proxy trends
GET /admin/quality/ab-comparison     — per-mode (A/B) quality metrics
GET /admin/quality/feedback-trends   — good/bad/neutral ratio over time
GET /admin/quality/low-confidence    — messages below confidence threshold
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case

from app.db.database import get_db
from app.models.conversation import Conversation, Message
from app.models.user import User
from app.models.course import Course
from app.auth.security import get_current_user
from app.core.logging import get_logger
from app.services.quality import (
    compute_quality_score, flag_reason,
    faithfulness_proxy, retrieval_precision_proxy,
    QUALITY_FLAG_THRESHOLD, CONFIDENCE_LOW_THRESHOLD,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/admin/quality", tags=["Admin Quality"])


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _safe_int(v) -> int:
    try:
        return int(v or 0)
    except (ValueError, TypeError):
        return 0


def _safe_float(v) -> float:
    try:
        return float(v or 0.0)
    except (ValueError, TypeError):
        return 0.0


def _chunks_from_meta(meta: Optional[dict]) -> int:
    if not meta:
        return 0
    return _safe_int(meta.get("chunks_retrieved", 0))


# ── Summary ─────────────────────────────────────────────────────────────────

@router.get("/summary")
async def quality_summary(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow() - timedelta(days=days)

    rows = (await db.execute(
        select(
            Message.confidence,
            Message.feedback,
            Message.citations,
            Message.meta,
            Message.latency_ms,
            Message.tokens_used,
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
    )).all()

    if not rows:
        return {
            "period_days": days, "total_messages": 0,
            "avg_quality_score": 0, "avg_confidence": 0,
            "flagged_count": 0, "flagged_pct": 0,
            "good_feedback_pct": 0, "bad_feedback_pct": 0,
            "avg_precision_proxy": 0, "avg_faithfulness_proxy": 0,
            "avg_latency_ms": 0,
            "thresholds": {"quality_flag": QUALITY_FLAG_THRESHOLD, "confidence_low": CONFIDENCE_LOW_THRESHOLD},
        }

    scores, flagged, good_fb, bad_fb = [], 0, 0, 0
    precision_list, faithful_list = [], []
    latencies = []

    for r in rows:
        conf = _safe_float(r.confidence)
        chunks = _chunks_from_meta(r.meta)
        cits = r.citations or []
        score = compute_quality_score(conf, r.feedback, cits, chunks)
        scores.append(score)
        if flag_reason(conf, r.feedback, chunks, score):
            flagged += 1
        if r.feedback == "good":
            good_fb += 1
        elif r.feedback == "bad":
            bad_fb += 1
        precision_list.append(retrieval_precision_proxy(len(cits), chunks))
        faithful_list.append(faithfulness_proxy(conf, chunks, len(cits)))
        if r.latency_ms:
            latencies.append(_safe_float(r.latency_ms))

    n = len(rows)
    return {
        "period_days": days,
        "total_messages": n,
        "avg_quality_score": round(sum(scores) / n, 4),
        "avg_confidence": round(sum(_safe_float(r.confidence) for r in rows) / n, 4),
        "flagged_count": flagged,
        "flagged_pct": round(flagged / n * 100, 1),
        "good_feedback_pct": round(good_fb / n * 100, 1),
        "bad_feedback_pct": round(bad_fb / n * 100, 1),
        "neutral_feedback_pct": round((n - good_fb - bad_fb) / n * 100, 1),
        "avg_precision_proxy": round(sum(precision_list) / n, 4),
        "avg_faithfulness_proxy": round(sum(faithful_list) / n, 4),
        "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
        "thresholds": {"quality_flag": QUALITY_FLAG_THRESHOLD, "confidence_low": CONFIDENCE_LOW_THRESHOLD},
    }


# ── Flagged messages ──────────────────────────────────────────────────────────

@router.get("/flagged")
async def flagged_messages(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow() - timedelta(days=days)

    rows = (await db.execute(
        select(
            Message.id,
            Message.content,
            Message.confidence,
            Message.feedback,
            Message.citations,
            Message.meta,
            Message.latency_ms,
            Message.created_at,
            Conversation.user_id,
            Conversation.course_id,
            Conversation.mode,
            User.full_name,
            User.email,
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .join(User, User.id == Conversation.user_id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
        .order_by(Message.created_at.desc())
        .limit(2000)
    )).all()

    flagged = []
    for r in rows:
        conf = _safe_float(r.confidence)
        chunks = _chunks_from_meta(r.meta)
        cits = r.citations or []
        score = compute_quality_score(conf, r.feedback, cits, chunks)
        reason = flag_reason(conf, r.feedback, chunks, score)
        if reason:
            flagged.append({
                "message_id": r.id,
                "content_preview": (r.content or "")[:200],
                "confidence": round(conf, 3),
                "quality_score": score,
                "feedback": r.feedback,
                "flag_reason": reason,
                "mode": r.mode,
                "chunks_retrieved": chunks,
                "citations": len(cits),
                "latency_ms": _safe_float(r.latency_ms),
                "user": {"id": r.user_id, "name": r.full_name, "email": r.email},
                "course_id": r.course_id,
                "created_at": r.created_at.isoformat() + "Z",
            })
            if len(flagged) >= limit:
                break

    return {"period_days": days, "flagged": flagged, "total_flagged": len(flagged)}


# ── Score distribution ────────────────────────────────────────────────────────

@router.get("/distribution")
async def score_distribution(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow() - timedelta(days=days)

    rows = (await db.execute(
        select(Message.confidence, Message.feedback, Message.citations, Message.meta)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
    )).all()

    scores = []
    for r in rows:
        conf = _safe_float(r.confidence)
        chunks = _chunks_from_meta(r.meta)
        score = compute_quality_score(conf, r.feedback, r.citations or [], chunks)
        scores.append(score)

    if not scores:
        return {"distribution": [], "percentiles": {}, "period_days": days}

    scores_sorted = sorted(scores)
    n = len(scores_sorted)

    # Histogram buckets 0.0-1.0 in 0.1 steps
    buckets = [0] * 10
    for s in scores:
        idx = min(int(s * 10), 9)
        buckets[idx] += 1

    distribution = [
        {"range": f"{i/10:.1f}-{(i+1)/10:.1f}", "count": buckets[i], "pct": round(buckets[i] / n * 100, 1)}
        for i in range(10)
    ]

    def pct(p):
        return round(scores_sorted[int(p / 100 * (n - 1))], 4)

    return {
        "period_days": days,
        "total": n,
        "distribution": distribution,
        "percentiles": {"p10": pct(10), "p25": pct(25), "p50": pct(50), "p75": pct(75), "p90": pct(90), "p95": pct(95)},
        "mean": round(sum(scores) / n, 4),
        "flagged_pct": round(sum(1 for s in scores if s < QUALITY_FLAG_THRESHOLD) / n * 100, 1),
    }


# ── RAG eval metrics ─────────────────────────────────────────────────────────

@router.get("/rag-eval")
async def rag_eval(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow() - timedelta(days=days)

    rows = (await db.execute(
        select(
            Message.confidence,
            Message.citations,
            Message.meta,
            func.date(Message.created_at).label("day"),
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
        .order_by(func.date(Message.created_at))
    )).all()

    # Daily aggregation
    day_map: dict[str, dict] = {}
    for r in rows:
        day = str(r.day)
        if day not in day_map:
            day_map[day] = {"precision": [], "faithfulness": [], "confidence": [], "zero_retrieval": 0, "total": 0}
        conf = _safe_float(r.confidence)
        chunks = _chunks_from_meta(r.meta)
        cits = r.citations or []
        day_map[day]["precision"].append(retrieval_precision_proxy(len(cits), chunks))
        day_map[day]["faithfulness"].append(faithfulness_proxy(conf, chunks, len(cits)))
        day_map[day]["confidence"].append(conf)
        if chunks == 0:
            day_map[day]["zero_retrieval"] += 1
        day_map[day]["total"] += 1

    # Fill gaps
    since_date = (datetime.utcnow() - timedelta(days=days)).date()
    daily = []
    for i in range(days):
        d = (since_date + timedelta(days=i)).isoformat()
        dm = day_map.get(d)
        if dm and dm["total"] > 0:
            t = dm["total"]
            daily.append({
                "date": d,
                "avg_precision": round(sum(dm["precision"]) / t, 4),
                "avg_faithfulness": round(sum(dm["faithfulness"]) / t, 4),
                "avg_confidence": round(sum(dm["confidence"]) / t, 4),
                "zero_retrieval_pct": round(dm["zero_retrieval"] / t * 100, 1),
                "count": t,
            })
        else:
            daily.append({"date": d, "avg_precision": 0, "avg_faithfulness": 0, "avg_confidence": 0, "zero_retrieval_pct": 0, "count": 0})

    # Overall
    all_prec = [r2 for row in day_map.values() for r2 in row["precision"]]
    all_faith = [r2 for row in day_map.values() for r2 in row["faithfulness"]]
    all_conf = [r2 for row in day_map.values() for r2 in row["confidence"]]
    n = len(all_prec) or 1

    return {
        "period_days": days,
        "overall": {
            "avg_retrieval_precision": round(sum(all_prec) / n, 4),
            "avg_faithfulness": round(sum(all_faith) / n, 4),
            "avg_confidence": round(sum(all_conf) / n, 4),
        },
        "daily": daily,
    }


# ── A/B mode comparison ───────────────────────────────────────────────────────

@router.get("/ab-comparison")
async def ab_comparison(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow() - timedelta(days=days)

    rows = (await db.execute(
        select(
            Conversation.mode,
            Message.confidence,
            Message.feedback,
            Message.citations,
            Message.meta,
            Message.latency_ms,
            Message.tokens_used,
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
    )).all()

    mode_map: dict[str, dict] = {}
    for r in rows:
        mode = r.mode or "normal"
        if mode not in mode_map:
            mode_map[mode] = {
                "scores": [], "confidence": [], "latencies": [],
                "good": 0, "bad": 0, "precision": [], "faithful": [], "total": 0,
            }
        conf = _safe_float(r.confidence)
        chunks = _chunks_from_meta(r.meta)
        cits = r.citations or []
        score = compute_quality_score(conf, r.feedback, cits, chunks)
        m = mode_map[mode]
        m["scores"].append(score)
        m["confidence"].append(conf)
        m["precision"].append(retrieval_precision_proxy(len(cits), chunks))
        m["faithful"].append(faithfulness_proxy(conf, chunks, len(cits)))
        if r.latency_ms:
            m["latencies"].append(_safe_float(r.latency_ms))
        if r.feedback == "good":
            m["good"] += 1
        elif r.feedback == "bad":
            m["bad"] += 1
        m["total"] += 1

    result = []
    for mode, m in sorted(mode_map.items(), key=lambda x: -x[1]["total"]):
        t = m["total"] or 1
        result.append({
            "mode": mode,
            "total_messages": m["total"],
            "avg_quality_score": round(sum(m["scores"]) / t, 4),
            "avg_confidence": round(sum(m["confidence"]) / t, 4),
            "avg_precision": round(sum(m["precision"]) / t, 4),
            "avg_faithfulness": round(sum(m["faithful"]) / t, 4),
            "avg_latency_ms": round(sum(m["latencies"]) / len(m["latencies"]), 1) if m["latencies"] else 0,
            "good_feedback_pct": round(m["good"] / t * 100, 1),
            "bad_feedback_pct": round(m["bad"] / t * 100, 1),
            "flagged_pct": round(sum(1 for s in m["scores"] if s < QUALITY_FLAG_THRESHOLD) / t * 100, 1),
        })

    return {"period_days": days, "modes": result}


# ── Feedback trends ───────────────────────────────────────────────────────────

@router.get("/feedback-trends")
async def feedback_trends(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow() - timedelta(days=days)

    rows = (await db.execute(
        select(
            func.date(Message.created_at).label("day"),
            Message.feedback,
            func.count(Message.id).label("cnt"),
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
        .group_by(func.date(Message.created_at), Message.feedback)
        .order_by(func.date(Message.created_at))
    )).all()

    day_map: dict[str, dict] = {}
    for r in rows:
        d = str(r.day)
        if d not in day_map:
            day_map[d] = {"good": 0, "bad": 0, "neutral": 0}
        key = r.feedback if r.feedback in ("good", "bad") else "neutral"
        day_map[d][key] += r.cnt

    since_date = (datetime.utcnow() - timedelta(days=days)).date()
    series = []
    for i in range(days):
        d = (since_date + timedelta(days=i)).isoformat()
        dm = day_map.get(d, {"good": 0, "bad": 0, "neutral": 0})
        total = dm["good"] + dm["bad"] + dm["neutral"] or 1
        series.append({
            "date": d,
            "good": dm["good"],
            "bad": dm["bad"],
            "neutral": dm["neutral"],
            "good_pct": round(dm["good"] / total * 100, 1),
            "bad_pct": round(dm["bad"] / total * 100, 1),
        })

    return {"period_days": days, "series": series}


# ── Low-confidence messages ───────────────────────────────────────────────────

@router.get("/low-confidence")
async def low_confidence_messages(
    days: int = Query(30, ge=1, le=365),
    threshold: float = Query(CONFIDENCE_LOW_THRESHOLD, ge=0, le=1),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    since = datetime.utcnow() - timedelta(days=days)

    rows = (await db.execute(
        select(
            Message.id,
            Message.content,
            Message.confidence,
            Message.feedback,
            Message.citations,
            Message.meta,
            Message.created_at,
            Conversation.mode,
            Conversation.course_id,
            User.full_name,
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .join(User, User.id == Conversation.user_id)
        .where(Message.role == "assistant")
        .where(Message.created_at >= since)
        .where(Message.confidence < threshold)
        .order_by(Message.confidence.asc())
        .limit(limit)
    )).all()

    return {
        "period_days": days,
        "threshold": threshold,
        "messages": [
            {
                "message_id": r.id,
                "content_preview": (r.content or "")[:200],
                "confidence": round(_safe_float(r.confidence), 4),
                "feedback": r.feedback,
                "mode": r.mode,
                "chunks_retrieved": _chunks_from_meta(r.meta),
                "citations": len(r.citations or []),
                "user": r.full_name,
                "course_id": r.course_id,
                "created_at": r.created_at.isoformat() + "Z",
            }
            for r in rows
        ],
    }
