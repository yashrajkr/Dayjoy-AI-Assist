"""
Business Intelligence API — the AI Business Operating System dashboard.

Adds the /distributor/bi/* routes that power the "Business Intelligence"
page (formerly "Dashboard"): real KPI aggregation, AI-generated insights,
an "Ask AI" business copilot, a unified activity timeline, simple statistical
forecasting, team analytics, live smart alerts, and goal tracking.

Every number returned here is computed from real rows in Supabase (BV
ledger, commissions, purchases, team_members, follow_ups, ...). Nothing is
hardcoded per-distributor; new distributors simply see zeros/empty states
until real activity accumulates. Rank thresholds and commission rates are
configurable business rules (see rank_definitions), not fabricated metrics.
"""

from __future__ import annotations

import datetime
import statistics
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/distributor/bi", tags=["business-intelligence"])

try:
    from .main import (
        require_user_id,
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        GROQ_API_KEY,
        GROQ_MODEL,
        OPENAI_API_KEY,
        OPENAI_MODEL,
    )
    from .distributor_api import _select, _insert, _rpc, _svc_headers
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _token_from(request: Request) -> Optional[str]:
    return request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None


def _today() -> str:
    return time.strftime("%Y-%m-%d")


def _iso_days_ago(days: int) -> str:
    return (datetime.datetime.utcnow() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")


async def _select_range(table: str, columns: str, distributor_col: str, user_id: str,
                         date_col: str, since: str, token: Optional[str] = None,
                         limit: int = 2000) -> List[Dict[str, Any]]:
    """SELECT rows for a distributor filtered by date_col >= since."""
    if not SUPABASE_URL:
        return []
    url = (
        f"{SUPABASE_URL}/rest/v1/{table}?select={columns}"
        f"&{distributor_col}=eq.{user_id}&{date_col}=gte.{since}&limit={limit}"
    )
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


async def _call_llm(system_prompt: str, user_prompt: str, max_tokens: int = 700) -> str:
    """Single-shot (non-streaming) LLM call — Groq primary, OpenAI fallback."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    if GROQ_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                    json={"model": GROQ_MODEL, "messages": messages, "temperature": 0.3, "max_tokens": max_tokens},
                )
                if resp.status_code < 400:
                    data = resp.json()
                    return data["choices"][0]["message"]["content"].strip()
        except Exception:
            pass
    if OPENAI_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                    json={"model": OPENAI_MODEL, "messages": messages, "temperature": 0.3, "max_tokens": max_tokens},
                )
                if resp.status_code < 400:
                    data = resp.json()
                    return data["choices"][0]["message"]["content"].strip()
        except Exception:
            pass
    return ""


def _sum(rows: List[Dict[str, Any]], key: str) -> float:
    return round(sum(float(r.get(key) or 0) for r in rows), 2)


# ---------------------------------------------------------------------------
# Overview — the KPI grid
# ---------------------------------------------------------------------------
@router.get("/overview")
async def bi_overview(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = _token_from(request)

    profile_rows = await _select("profiles", "*", filters={"id": user_id}, limit=1, token=token)
    profile = profile_rows[0] if profile_rows else {}

    today = _today()
    week_start = _iso_days_ago(7)
    month_start = _iso_days_ago(30)
    year_start = _iso_days_ago(365)

    bv_today = await _select_range("business_volume_ledger", "bv,pv,created_at", "distributor_id", user_id, "created_at", today, token)
    bv_week = await _select_range("business_volume_ledger", "bv,pv,created_at", "distributor_id", user_id, "created_at", week_start, token)
    bv_month = await _select_range("business_volume_ledger", "bv,pv,created_at", "distributor_id", user_id, "created_at", month_start, token)
    bv_year = await _select_range("business_volume_ledger", "bv,pv,created_at", "distributor_id", user_id, "created_at", year_start, token)

    purchases_today = await _select_range("customer_purchases", "amount,quantity", "distributor_id", user_id, "purchase_date", today, token)

    commissions_today = await _select_range("commissions", "amount,status,created_at", "distributor_id", user_id, "created_at", today, token)

    customers = await _select("customer_profiles", "id,status,created_at", filters={"distributor_id": user_id}, limit=1000, token=token)
    new_customers_today = len([c for c in customers if str(c.get("created_at") or "")[:10] == today])

    team = await _select("team_members", "*", filters={"leader_id": user_id}, limit=500, token=token)
    active_team = [t for t in team if t.get("status") == "active"]
    inactive_team = [t for t in team if t.get("status") in ("inactive", "left")]
    new_distributors_today = len([t for t in team if str(t.get("joined_date") or "")[:10] == today])
    retention_pct = round((len(active_team) / len(team)) * 100, 1) if team else 0.0

    # Rank + progress toward next rank
    ranks = await _select("rank_definitions", "*", filters=None, limit=20, order="level_order.asc", token=token)
    current_rank_id = await _rpc("compute_distributor_rank", {"p_user_id": user_id}, token=token)
    trailing_90_bv = _sum(
        await _select_range("business_volume_ledger", "bv", "distributor_id", user_id, "created_at", _iso_days_ago(90), token),
        "bv",
    )
    current_rank = next((r for r in ranks if r.get("id") == current_rank_id), ranks[0] if ranks else None)
    next_rank = None
    if current_rank and ranks:
        idx = next((i for i, r in enumerate(ranks) if r.get("id") == current_rank.get("id")), 0)
        next_rank = ranks[idx + 1] if idx + 1 < len(ranks) else None
    rank_progress_pct = 0.0
    if next_rank:
        target_bv = float(next_rank.get("min_business_volume") or 1)
        rank_progress_pct = round(min(100.0, (trailing_90_bv / target_bv) * 100), 1) if target_bv else 100.0

    # Monthly target + achievement
    targets = await _select("distributor_targets", "*", filters={"distributor_id": user_id, "period_type": "monthly"}, limit=1, order="period_start.desc", token=token)
    monthly_target = float(targets[0].get("target_amount")) if targets else (float(next_rank.get("min_business_volume")) if next_rank else 0.0)
    month_sales = _sum(bv_month, "bv")
    achievement_pct = round(min(100.0, (month_sales / monthly_target) * 100), 1) if monthly_target else 0.0

    # Incentives
    incentives = await _select("incentives", "*", filters={"is_active": True}, limit=10, token=token)
    current_incentive = None
    potential_incentive_value = 0.0
    for inc in incentives:
        crit = inc.get("criteria") or {}
        min_bv = float(crit.get("min_bv") or 0)
        if min_bv and trailing_90_bv >= min_bv:
            current_incentive = inc
        elif min_bv:
            potential_incentive_value = max(potential_incentive_value, float(inc.get("reward_value") or 0))

    # Health score (reuses existing v8 function)
    health_score = await _rpc("compute_business_health_score", {"p_user_id": user_id}, token=token)

    # Projected income: trailing 30-day commission run-rate extrapolated to month
    commission_30d = _sum(await _select_range("commissions", "amount", "distributor_id", user_id, "created_at", month_start, token), "amount")
    projected_income = round(commission_30d, 2)

    # AI Growth score: blend of health score + rank progress + retention (0-100)
    growth_score = round(
        min(100.0, (float(health_score or 0) * 0.5) + (rank_progress_pct * 0.3) + (retention_pct * 0.2)), 1
    )

    return {
        "distributor": {
            "id": user_id,
            "full_name": profile.get("full_name"),
            "distributor_code": profile.get("distributor_code"),
            "state": profile.get("state"),
            "city": profile.get("city"),
            "kyc_status": profile.get("kyc_status"),
        },
        "today": {
            "sales_amount": _sum(purchases_today, "amount"),
            "business_volume": _sum(bv_today, "bv"),
            "commission": _sum(commissions_today, "amount"),
            "new_customers": new_customers_today,
            "new_distributors": new_distributors_today,
            "orders": len(purchases_today),
            "revenue": _sum(purchases_today, "amount"),
        },
        "period": {
            "weekly_business": _sum(bv_week, "bv"),
            "monthly_business": _sum(bv_month, "bv"),
            "yearly_business": _sum(bv_year, "bv"),
        },
        "rank": {
            "current": current_rank.get("name") if current_rank else None,
            "badge_icon": current_rank.get("badge_icon") if current_rank else None,
            "next": next_rank.get("name") if next_rank else None,
            "progress_pct": rank_progress_pct,
            "trailing_90d_bv": trailing_90_bv,
            "bv_needed_for_next": max(0.0, float(next_rank.get("min_business_volume")) - trailing_90_bv) if next_rank else 0.0,
        },
        "team": {
            "total": len(team),
            "active": len(active_team),
            "inactive": len(inactive_team),
            "retention_pct": retention_pct,
        },
        "target": {
            "monthly_target": monthly_target,
            "month_to_date": month_sales,
            "achievement_pct": achievement_pct,
        },
        "incentive": {
            "current": current_incentive.get("title") if current_incentive else None,
            "current_reward": current_incentive.get("reward_text") if current_incentive else None,
            "potential_value": potential_incentive_value,
        },
        "projected_income": projected_income,
        "business_health_score": health_score,
        "ai_growth_score": growth_score,
    }


# ---------------------------------------------------------------------------
# AI Insights — grounded natural-language findings
# ---------------------------------------------------------------------------
@router.get("/insights")
async def bi_insights(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = _token_from(request)

    week_start = _iso_days_ago(7)
    prev_week_start = _iso_days_ago(14)

    this_week = await _select_range("business_volume_ledger", "bv,created_at", "distributor_id", user_id, "created_at", week_start, token)
    prev_window = await _select_range("business_volume_ledger", "bv,created_at", "distributor_id", user_id, "created_at", prev_week_start, token)
    last_week = [r for r in prev_window if r.get("created_at", "") < week_start]

    this_week_bv = _sum(this_week, "bv")
    last_week_bv = _sum(last_week, "bv")
    wow_change_pct = round(((this_week_bv - last_week_bv) / last_week_bv) * 100, 1) if last_week_bv else None

    team = await _select("team_members", "*", filters={"leader_id": user_id}, limit=500, token=token)
    cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=14)).isoformat()
    newly_inactive = [t for t in team if t.get("status") == "active" and (t.get("last_active_at") or "") < cutoff and t.get("last_active_at")]

    customers = await _select("customer_profiles", "*", filters={"distributor_id": user_id}, limit=500, token=token)
    stale_customers = [c for c in customers if c.get("status") == "active_customer" and (c.get("last_contacted_at") or "") < _iso_days_ago(21)]

    zero_activity_team = [t for t in team if t.get("status") == "active" and not t.get("last_active_at")]

    if not GROQ_API_KEY and not OPENAI_API_KEY:
        # No LLM configured — still return real, computed structured facts.
        facts = []
        if wow_change_pct is not None:
            facts.append(f"Business volume {'grew' if wow_change_pct >= 0 else 'dropped'} {abs(wow_change_pct)}% vs last week.")
        if newly_inactive:
            facts.append(f"{len(newly_inactive)} team member(s) have gone quiet in the last 14 days.")
        if stale_customers:
            facts.append(f"{len(stale_customers)} active customer(s) haven't been contacted in 3+ weeks.")
        if zero_activity_team:
            facts.append(f"{len(zero_activity_team)} distributor(s) on your team show zero recorded activity.")
        return {"insights": facts, "generated_by": "computed"}

    data_summary = (
        f"This week's business volume: ₹{this_week_bv}. Last week's: ₹{last_week_bv}. "
        f"Week-over-week change: {wow_change_pct}%. "
        f"Team members gone quiet (14d): {len(newly_inactive)} — names: {[t.get('member_name') for t in newly_inactive][:5]}. "
        f"Active customers not contacted in 21+ days: {len(stale_customers)}. "
        f"Team members with zero recorded activity: {len(zero_activity_team)}."
    )
    system_prompt = (
        "You are the AI Business Manager inside a direct-selling distributor's dashboard for Dayjoy. "
        "Given real, already-computed business data, write 3-5 short, specific insight bullets "
        "(max 20 words each) a distributor can act on today. Only state facts present in the data — "
        "never invent numbers, cities, or names not given. If a metric is zero or missing, skip it "
        "rather than fabricating. Output plain bullet lines, no markdown headers."
    )
    text = await _call_llm(system_prompt, data_summary, max_tokens=350)
    insights = [line.strip("-• ").strip() for line in text.splitlines() if line.strip()] if text else []
    if not insights:
        insights = ["Not enough recent activity yet to generate AI insights — insights appear as your business data grows."]

    return {"insights": insights, "generated_by": "ai", "wow_change_pct": wow_change_pct}


# ---------------------------------------------------------------------------
# Ask AI — business copilot Q&A grounded in the distributor's real data
# ---------------------------------------------------------------------------
class AskRequest(BaseModel):
    question: str
    session_id: Optional[str] = None


@router.post("/ask")
async def bi_ask(req: AskRequest, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = _token_from(request)

    overview = await bi_overview(request)
    team = await _select("team_members", "member_name,status,total_sales,rank,last_active_at", filters={"leader_id": user_id}, limit=100, order="total_sales.desc", token=token)
    customers = await _select("customer_profiles", "full_name,status,last_contacted_at,next_contact_at", filters={"distributor_id": user_id}, limit=200, token=token)
    goals = await _select("distributor_goals", "*", filters={"user_id": user_id}, limit=20, token=token)

    context = {
        "overview": overview,
        "team_sample": team[:15],
        "customer_sample": customers[:15],
        "goals": goals,
    }

    system_prompt = (
        "You are the AI Business Manager for a Dayjoy direct-selling distributor. "
        "Answer the distributor's question using ONLY the JSON data provided below — "
        "never invent figures, names, or dates that aren't present. If the data doesn't "
        "contain the answer, say so plainly and suggest what to check instead. Be concise, "
        "concrete, and action-oriented. Use ₹ for currency. Keep answers under 150 words "
        "unless asked for a plan/report."
    )
    user_prompt = f"Distributor's real business data (JSON):\n{context}\n\nQuestion: {req.question}"

    answer = await _call_llm(system_prompt, user_prompt, max_tokens=600)
    if not answer:
        answer = "AI is temporarily unavailable. Please try again in a moment."

    session_id = req.session_id
    saved_user = await _insert("ai_chat_messages", {
        "user_id": user_id, "session_id": session_id, "role": "user", "content": req.question,
    } if session_id else {
        "user_id": user_id, "role": "user", "content": req.question,
    }, token=token)
    session_id = session_id or (saved_user or {}).get("session_id")
    await _insert("ai_chat_messages", {
        "user_id": user_id, "session_id": session_id, "role": "assistant", "content": answer,
        "data_context": {"overview_snapshot": True},
    }, token=token)

    return {"answer": answer, "session_id": session_id}


@router.get("/ask/history")
async def bi_ask_history(request: Request, session_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = _token_from(request)
    filters = {"user_id": user_id}
    if session_id:
        filters["session_id"] = session_id
    return await _select("ai_chat_messages", "*", filters=filters, limit=limit, order="created_at.asc", token=token)


# ---------------------------------------------------------------------------
# Timeline — unified real activity feed
# ---------------------------------------------------------------------------
@router.get("/timeline")
async def bi_timeline(request: Request, days: int = 30) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = _token_from(request)
    since = _iso_days_ago(days)

    events: List[Dict[str, Any]] = []

    for c in await _select_range("customer_profiles", "id,full_name,created_at", "distributor_id", user_id, "created_at", since, token):
        events.append({"type": "new_customer", "title": f"New customer: {c.get('full_name')}", "timestamp": c.get("created_at")})

    for p in await _select_range("customer_purchases", "id,product_name,amount,purchase_date", "distributor_id", user_id, "purchase_date", since, token):
        events.append({"type": "order", "title": f"Order — {p.get('product_name') or 'Product'} (₹{p.get('amount')})", "timestamp": p.get("purchase_date")})

    for f in await _select_range("follow_ups", "id,title,status,completed_at", "distributor_id", user_id, "completed_at", since, token):
        if f.get("status") == "completed":
            events.append({"type": "follow_up", "title": f"Completed follow-up: {f.get('title')}", "timestamp": f.get("completed_at")})

    for t in await _select("team_recognition", "*", filters={"leader_id": user_id}, limit=50, token=token):
        if (t.get("awarded_at") or "") >= since:
            events.append({"type": "award", "title": f"{t.get('badge_icon', '🏆')} {t.get('title')} — {t.get('member_name')}", "timestamp": t.get("awarded_at")})

    for tm in await _select("team_members", "*", filters={"leader_id": user_id}, limit=200, token=token):
        if str(tm.get("joined_date") or "") >= since:
            events.append({"type": "new_distributor", "title": f"{tm.get('member_name')} joined your team", "timestamp": tm.get("joined_date")})

    for h in await _select_range("business_health_scores", "score_date,overall_score", "distributor_id", user_id, "score_date", since, token):
        events.append({"type": "health_score", "title": f"Business health score: {h.get('overall_score')}/100", "timestamp": h.get("score_date")})

    for e in await _select("distributor_events", "*", limit=20, order="start_time.desc", token=token):
        if str(e.get("start_time") or "") >= since:
            events.append({"type": "event", "title": e.get("title"), "timestamp": e.get("start_time")})

    events = [e for e in events if e.get("timestamp")]
    events.sort(key=lambda e: str(e["timestamp"]), reverse=True)
    return {"events": events[:150]}


# ---------------------------------------------------------------------------
# Forecast — simple, honest statistical projection (no ML fabrication)
# ---------------------------------------------------------------------------
@router.get("/forecast")
async def bi_forecast(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = _token_from(request)

    rows = await _select_range("business_volume_ledger", "bv,created_at", "distributor_id", user_id, "created_at", _iso_days_ago(90), token, limit=5000)
    daily: Dict[str, float] = {}
    for r in rows:
        d = str(r.get("created_at") or "")[:10]
        if not d:
            continue
        daily[d] = daily.get(d, 0.0) + float(r.get("bv") or 0)

    if len(daily) < 3:
        return {
            "has_enough_data": False,
            "message": "Not enough transaction history yet (need at least a few active days) to project a forecast.",
            "next_30_day_projection": None,
        }

    ordered = sorted(daily.items())
    values = [v for _, v in ordered]
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = statistics.fmean(values)
    numerator = sum((i - x_mean) * (values[i] - y_mean) for i in range(n))
    denominator = sum((i - x_mean) ** 2 for i in range(n)) or 1
    slope = numerator / denominator

    projected_daily_avg = max(0.0, statistics.fmean(values[-14:]) if n >= 14 else y_mean)
    next_30_day_bv = round(projected_daily_avg * 30, 2)
    trend_direction = "up" if slope > 0.5 else "down" if slope < -0.5 else "flat"

    return {
        "has_enough_data": True,
        "daily_history": [{"date": d, "bv": round(v, 2)} for d, v in ordered],
        "trend_direction": trend_direction,
        "next_30_day_projection": next_30_day_bv,
        "projected_daily_average": round(projected_daily_avg, 2),
    }


# ---------------------------------------------------------------------------
# Team analytics
# ---------------------------------------------------------------------------
@router.get("/team-analytics")
async def bi_team_analytics(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = _token_from(request)

    team = await _select("team_members", "*", filters={"leader_id": user_id}, limit=500, order="total_sales.desc", token=token)
    active = [t for t in team if t.get("status") == "active"]
    inactive_cutoff = _iso_days_ago(30) + "T00:00:00"
    inactive_leaders = [t for t in team if t.get("status") == "active" and (t.get("last_active_at") or "") < inactive_cutoff]
    needs_support = [t for t in active if float(t.get("total_sales") or 0) == 0 and float(t.get("training_completion") or 0) < 50]
    new_joiners = sorted([t for t in team if t.get("joined_date")], key=lambda t: t.get("joined_date"), reverse=True)[:10]

    customers = await _select("customer_profiles", "*", filters={"distributor_id": user_id}, limit=500, token=token)
    purchases = await _select("customer_purchases", "customer_id,amount", filters={"distributor_id": user_id}, limit=2000, token=token)
    spend_by_customer: Dict[str, float] = {}
    for p in purchases:
        cid = p.get("customer_id")
        if cid:
            spend_by_customer[cid] = spend_by_customer.get(cid, 0.0) + float(p.get("amount") or 0)
    top_customers = sorted(
        [{"id": c.get("id"), "name": c.get("full_name"), "total_spend": round(spend_by_customer.get(c.get("id"), 0.0), 2)} for c in customers],
        key=lambda c: c["total_spend"], reverse=True,
    )[:10]

    return {
        "top_leaders": sorted(active, key=lambda t: float(t.get("total_sales") or 0), reverse=True)[:10],
        "inactive_leaders": inactive_leaders[:10],
        "needs_support": needs_support[:10],
        "new_joiners": new_joiners,
        "top_customers": top_customers,
        "team_size": len(team),
        "active_count": len(active),
    }


# ---------------------------------------------------------------------------
# Smart alerts — computed live from real conditions, never stored fakes
# ---------------------------------------------------------------------------
@router.get("/alerts")
async def bi_alerts(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = _token_from(request)
    alerts: List[Dict[str, Any]] = []

    week_start = _iso_days_ago(7)
    prev_week_start = _iso_days_ago(14)
    this_week_bv = _sum(await _select_range("business_volume_ledger", "bv,created_at", "distributor_id", user_id, "created_at", week_start, token), "bv")
    prev = await _select_range("business_volume_ledger", "bv,created_at", "distributor_id", user_id, "created_at", prev_week_start, token)
    last_week_bv = _sum([r for r in prev if r.get("created_at", "") < week_start], "bv")
    if last_week_bv > 0 and this_week_bv < last_week_bv * 0.8:
        drop_pct = round((1 - this_week_bv / last_week_bv) * 100, 1)
        alerts.append({"type": "business_down", "severity": "high", "message": f"Business volume is down {drop_pct}% vs last week."})

    team = await _select("team_members", "*", filters={"leader_id": user_id}, limit=500, token=token)
    inactive_cutoff = _iso_days_ago(30) + "T00:00:00"
    inactive_now = [t for t in team if t.get("status") == "active" and (t.get("last_active_at") or "") < inactive_cutoff]
    if inactive_now:
        alerts.append({"type": "leader_inactive", "severity": "medium", "message": f"{len(inactive_now)} team member(s) inactive 30+ days."})

    follow_ups = await _select("follow_ups", "*", filters={"distributor_id": user_id, "status": "pending"}, limit=200, token=token)
    overdue = [f for f in follow_ups if (f.get("due_date") or "") < time.strftime("%Y-%m-%dT%H:%M:%S")]
    if overdue:
        alerts.append({"type": "customer_follow_up", "severity": "high", "message": f"{len(overdue)} follow-up(s) overdue."})

    customers = await _select("customer_profiles", "*", filters={"distributor_id": user_id}, limit=500, token=token)
    today_md = time.strftime("%m-%d")
    week_end = (datetime.datetime.utcnow() + datetime.timedelta(days=7)).strftime("%m-%d")
    birthdays = [c for c in customers if c.get("birthday") and today_md <= str(c["birthday"])[5:10] <= week_end]
    if birthdays:
        alerts.append({"type": "birthday_reminder", "severity": "low", "message": f"{len(birthdays)} customer birthday(s) coming up this week."})

    profile_rows = await _select("profiles", "kyc_status", filters={"id": user_id}, limit=1, token=token)
    if profile_rows and profile_rows[0].get("kyc_status") in ("pending", "rejected"):
        alerts.append({"type": "kyc_pending", "severity": "medium", "message": "Your KYC verification is pending — complete it to unlock payouts."})

    events = await _select("distributor_events", "*", limit=10, order="start_time.asc", token=token)
    soon = [e for e in events if e.get("is_published") and time.strftime("%Y-%m-%dT%H:%M:%S") <= str(e.get("start_time") or "") <= (datetime.datetime.utcnow() + datetime.timedelta(days=3)).isoformat()]
    if soon:
        alerts.append({"type": "meeting_reminder", "severity": "low", "message": f"{len(soon)} upcoming event/meeting in the next 3 days."})

    commissions_recent = await _select_range("commissions", "amount,status,created_at", "distributor_id", user_id, "created_at", _iso_days_ago(7), token)
    paid = [c for c in commissions_recent if c.get("status") == "paid"]
    if paid:
        alerts.append({"type": "commission_released", "severity": "low", "message": f"₹{_sum(paid, 'amount')} in commission released this week."})

    return {"alerts": alerts, "count": len(alerts)}


# ---------------------------------------------------------------------------
# Goal tracker — weekly/monthly/quarterly/yearly progress
# ---------------------------------------------------------------------------
@router.get("/goals-progress")
async def bi_goals_progress(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = _token_from(request)

    period_types = {"weekly": "monthly", "monthly": "monthly", "quarterly": "quarterly", "yearly": "yearly"}
    windows = {"weekly": 7, "monthly": 30, "quarterly": 90, "yearly": 365}
    targets = await _select("distributor_targets", "*", filters={"distributor_id": user_id}, limit=50, token=token)
    result: Dict[str, Any] = {}
    for period, days in windows.items():
        bv = _sum(await _select_range("business_volume_ledger", "bv,created_at", "distributor_id", user_id, "created_at", _iso_days_ago(days), token), "bv")
        target_row = next((t for t in targets if t.get("period_type") == period_types[period]), None)
        target_amount = float(target_row.get("target_amount")) if target_row else 0.0
        result[period] = {
            "actual": bv,
            "target": target_amount,
            "progress_pct": round(min(100.0, (bv / target_amount) * 100), 1) if target_amount else None,
        }

    goals = await _select("distributor_goals", "*", filters={"user_id": user_id}, limit=50, order="period_end.asc", token=token)
    return {"periods": result, "goals": goals}
