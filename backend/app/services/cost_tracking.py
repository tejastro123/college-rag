"""
Cost & Usage tracking service.

Provides:
  - Model pricing registry (price per 1M tokens)
  - Cost calculation helpers
  - Per-user / per-course / per-org breakdowns from existing Message + UsageRecord tables
  - Budget management (in-process store, no migration needed)
  - Linear usage forecasting
"""
from __future__ import annotations

import json
import math
import os
from datetime import date, datetime, timedelta
from typing import Optional

# ── Model pricing registry (USD per 1M tokens, blended input+output) ──────────
# Adjust prices to match actual provider invoices.
MODEL_PRICING: dict[str, dict] = {
    "gemini-2.0-flash": {
        "label": "Gemini 2.0 Flash",
        "provider": "Google",
        "input_per_1m": 0.10,
        "output_per_1m": 0.40,
        "blended_per_1m": 0.25,   # assume ~60% input, 40% output
        "context_window": 1_000_000,
    },
    "gemini-1.5-pro": {
        "label": "Gemini 1.5 Pro",
        "provider": "Google",
        "input_per_1m": 1.25,
        "output_per_1m": 5.00,
        "blended_per_1m": 2.625,
        "context_window": 2_000_000,
    },
    "gpt-4o": {
        "label": "GPT-4o",
        "provider": "OpenAI",
        "input_per_1m": 2.50,
        "output_per_1m": 10.00,
        "blended_per_1m": 5.50,
        "context_window": 128_000,
    },
    "gpt-4o-mini": {
        "label": "GPT-4o Mini",
        "provider": "OpenAI",
        "input_per_1m": 0.15,
        "output_per_1m": 0.60,
        "blended_per_1m": 0.33,
        "context_window": 128_000,
    },
    "claude-3-5-sonnet": {
        "label": "Claude 3.5 Sonnet",
        "provider": "Anthropic",
        "input_per_1m": 3.00,
        "output_per_1m": 15.00,
        "blended_per_1m": 7.80,
        "context_window": 200_000,
    },
    "claude-3-haiku": {
        "label": "Claude 3 Haiku",
        "provider": "Anthropic",
        "input_per_1m": 0.25,
        "output_per_1m": 1.25,
        "blended_per_1m": 0.65,
        "context_window": 200_000,
    },
}

# Which model is actually in use (read from env or default)
ACTIVE_MODEL = os.environ.get("LLM_MODEL", "gemini-2.0-flash")


def tokens_to_usd(tokens: int, model: str = ACTIVE_MODEL) -> float:
    """Convert token count to USD cost."""
    pricing = MODEL_PRICING.get(model, MODEL_PRICING[ACTIVE_MODEL])
    return round((tokens / 1_000_000) * pricing["blended_per_1m"], 6)


def compare_model_costs(tokens: int) -> list[dict]:
    """Return cost for given token count across all known models, sorted by cost."""
    results = []
    for model_id, pricing in MODEL_PRICING.items():
        cost = round((tokens / 1_000_000) * pricing["blended_per_1m"], 6)
        results.append({
            "model_id": model_id,
            "label": pricing["label"],
            "provider": pricing["provider"],
            "cost_usd": cost,
            "blended_per_1m": pricing["blended_per_1m"],
            "is_active": model_id == ACTIVE_MODEL,
        })
    return sorted(results, key=lambda x: x["cost_usd"])


# ── In-process budget store (persisted to a JSON file) ───────────────────────
# Format: { "user:{id}": <tokens>, "course:{id}": <tokens>, "org:{id}": <tokens> }
_BUDGET_FILE = os.path.join(os.path.dirname(__file__), "../../.budget_store.json")

def _load_budgets() -> dict:
    try:
        with open(_BUDGET_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _save_budgets(data: dict) -> None:
    try:
        with open(_BUDGET_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass

def get_budget(entity_type: str, entity_id: str) -> Optional[int]:
    """Return token budget for a user/course/org, or None if unset."""
    key = f"{entity_type}:{entity_id}"
    return _load_budgets().get(key)

def set_budget(entity_type: str, entity_id: str, tokens: int) -> None:
    """Set/update token budget."""
    data = _load_budgets()
    data[f"{entity_type}:{entity_id}"] = tokens
    _save_budgets(data)

def delete_budget(entity_type: str, entity_id: str) -> None:
    data = _load_budgets()
    data.pop(f"{entity_type}:{entity_id}", None)
    _save_budgets(data)

def list_budgets() -> dict:
    return _load_budgets()


# ── Forecasting ───────────────────────────────────────────────────────────────

def forecast_tokens(daily_series: list[int], days_ahead: int = 30) -> dict:
    """
    Linear regression forecast on daily token usage.
    `daily_series` is ordered oldest→newest.
    Returns slope, r2, projected 7d/30d totals, next-day estimate.
    """
    n = len(daily_series)
    if n < 2:
        avg = daily_series[0] if daily_series else 0
        return {
            "slope": 0,
            "r2": 0,
            "next_day": avg,
            "projected_7d": avg * 7,
            "projected_30d": avg * 30,
            "confidence": "low",
        }

    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(daily_series) / n

    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, daily_series))
    ss_xx = sum((x - mean_x) ** 2 for x in xs)
    slope = ss_xy / ss_xx if ss_xx else 0
    intercept = mean_y - slope * mean_x

    # R²
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, daily_series))
    ss_tot = sum((y - mean_y) ** 2 for y in daily_series)
    r2 = max(0.0, 1 - ss_res / ss_tot) if ss_tot else 0

    def predict(x):
        return max(0, slope * x + intercept)

    next_day = predict(n)
    projected_7d = sum(predict(n + i) for i in range(7))
    projected_30d = sum(predict(n + i) for i in range(30))

    return {
        "slope": round(slope, 2),
        "r2": round(r2, 4),
        "next_day": round(next_day),
        "projected_7d": round(projected_7d),
        "projected_30d": round(projected_30d),
        "confidence": "high" if r2 > 0.7 else "medium" if r2 > 0.4 else "low",
    }
