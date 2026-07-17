"""Billing and subscription endpoints with Stripe integration."""
from __future__ import annotations

import os
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.db.database import get_db
from app.models.user import User
from app.models.billing import Subscription, UsageRecord, StripeWebhookEvent
from app.models.organization import Organization, OrganizationMember
from app.auth.security import get_current_user

router = APIRouter(prefix="/billing", tags=["Billing"])

# Stripe (optional — skip if not configured)
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
stripe = None
if STRIPE_SECRET_KEY:
    import stripe as stripe_lib
    stripe = stripe_lib
    stripe.api_key = STRIPE_SECRET_KEY


async def get_org_subscription(db: AsyncSession, org_id: str) -> Subscription:
    result = await db.execute(
        select(Subscription).where(Subscription.organization_id == org_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        sub = Subscription(organization_id=org_id, plan="free", status="active")
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
    return sub


@router.get("/plans")
async def list_plans():
    """Return available subscription plans."""
    return {
        "plans": [
            {
                "id": "free",
                "name": "Free",
                "price_monthly": 0,
                "price_yearly": 0,
                "features": [
                    "Up to 3 members",
                    "100 MB storage",
                    "1,000 API calls/month",
                    "Basic RAG features",
                ],
            },
            {
                "id": "pro",
                "name": "Pro",
                "price_monthly": 2900,  # $29.00
                "price_yearly": 29000,  # $290.00
                "stripe_price_id_monthly": "price_pro_monthly",
                "stripe_price_id_yearly": "price_pro_yearly",
                "features": [
                    "Up to 25 members",
                    "10 GB storage",
                    "50,000 API calls/month",
                    "Advanced RAG with reranking",
                    "Priority support",
                ],
            },
            {
                "id": "enterprise",
                "name": "Enterprise",
                "price_monthly": 9900,  # $99.00
                "price_yearly": 99000,  # $990.00
                "stripe_price_id_monthly": "price_enterprise_monthly",
                "stripe_price_id_yearly": "price_enterprise_yearly",
                "features": [
                    "Unlimited members",
                    "100 GB storage",
                    "Unlimited API calls",
                    "Custom integrations",
                    "Dedicated support",
                    "SSO",
                ],
            },
        ]
    }


@router.get("/my-subscription")
async def get_my_subscription(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = await get_org_subscription(db, org_id)
    usage_result = await db.execute(
        select(UsageRecord).where(
            UsageRecord.organization_id == org_id,
            UsageRecord.date == datetime.utcnow().date(),
        )
    )
    usage = usage_result.scalar_one_or_none()

    return {
        "plan": sub.plan,
        "status": sub.status,
        "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "trial_end": sub.trial_end.isoformat() if sub.trial_end else None,
        "canceled_at": sub.canceled_at.isoformat() if sub.canceled_at else None,
        "usage_today": {
            "api_calls": usage.api_calls if usage else 0,
            "documents_processed": usage.documents_processed if usage else 0,
            "storage_bytes": usage.storage_bytes if usage else 0,
            "tokens_used": usage.tokens_used if usage else 0,
        } if usage else {"api_calls": 0, "documents_processed": 0, "storage_bytes": 0, "tokens_used": 0},
    }


@router.post("/create-checkout-session")
async def create_checkout_session(
    org_id: str,
    plan: str,
    interval: str = "monthly",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not stripe:
        raise HTTPException(status_code=503, detail="Stripe is not configured. Set STRIPE_SECRET_KEY.")

    sub = await get_org_subscription(db, org_id)

    # Create or update Stripe customer
    if not sub.stripe_customer_id:
        customer = stripe.Customer.create(
            email=current_user.email,
            metadata={"org_id": org_id, "user_id": current_user.id},
        )
        sub.stripe_customer_id = customer.id
        await db.commit()

    if plan == "free":
        raise HTTPException(status_code=400, detail="Free plan does not require checkout")

    price_id_map = {
        ("pro", "monthly"): "price_pro_monthly",
        ("pro", "yearly"): "price_pro_yearly",
        ("enterprise", "monthly"): "price_enterprise_monthly",
        ("enterprise", "yearly"): "price_enterprise_yearly",
    }
    price_id = price_id_map.get((plan, interval))
    if not price_id:
        raise HTTPException(status_code=400, detail="Invalid plan or interval")

    checkout_session = stripe.checkout.Session.create(
        customer=sub.stripe_customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=os.environ.get("STRIPE_SUCCESS_URL", "http://localhost:5173/billing/success"),
        cancel_url=os.environ.get("STRIPE_CANCEL_URL", "http://localhost:5173/billing"),
        metadata={"org_id": org_id, "plan": plan},
    )

    return {"url": checkout_session.url, "session_id": checkout_session.id}


@router.post("/create-portal-session")
async def create_portal_session(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not stripe:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    sub = await get_org_subscription(db, org_id)
    if not sub.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer found")

    portal = stripe.billing_portal.Session.create(
        customer=sub.stripe_customer_id,
        return_url=os.environ.get("STRIPE_RETURN_URL", "http://localhost:5173/billing"),
    )
    return {"url": portal.url}


@router.post("/stripe-webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle Stripe webhook events."""
    if not stripe:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    payload = await request.body()
    sig_header = request.headers.get("Stripe-Signature")
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid signature")

    # Idempotency check
    existing = await db.execute(
        select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event.id)
    )
    if existing.scalar_one_or_none():
        return {"status": "already_processed"}

    # Store event
    webhook_event = StripeWebhookEvent(
        stripe_event_id=event.id,
        type=event.type,
        data=event.data.object,
    )
    db.add(webhook_event)

    # Handle specific events
    if event.type == "checkout.session.completed":
        session = event.data.object
        org_id = session.metadata.org_id
        plan = session.metadata.plan
        sub_result = await db.execute(
            select(Subscription).where(Subscription.organization_id == org_id)
        )
        sub = sub_result.scalar_one_or_none()
        if sub:
            sub.plan = plan
            sub.status = "active"
            sub.stripe_subscription_id = session.subscription
            sub.current_period_start = datetime.fromtimestamp(session.created)
            sub.current_period_end = datetime.fromtimestamp(
                session.get("expires_at", session.created + 2592000)
            )
        webhook_event.processed = True

    elif event.type == "invoice.payment_failed":
        sub_result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == event.data.object.subscription
            )
        )
        sub = sub_result.scalar_one_or_none()
        if sub:
            sub.status = "past_due"
        webhook_event.processed = True

    elif event.type == "customer.subscription.deleted":
        sub_result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == event.data.object.id
            )
        )
        sub = sub_result.scalar_one_or_none()
        if sub:
            sub.status = "canceled"
            sub.canceled_at = datetime.utcnow()
        webhook_event.processed = True

    await db.commit()
    return {"status": "processed"}
