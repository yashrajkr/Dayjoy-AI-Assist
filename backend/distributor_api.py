"""
Phase 3 — Distributor AI Copilot API endpoints.

Adds the /distributor/* routes for the Distributor Success Platform:
  - /distributor/dashboard           — personalized dashboard KPIs
  - /distributor/goals               — CRUD goals
  - /distributor/customers           — CRUD customer profiles + AI recommendations
  - /distributor/follow-ups          — CRUD follow-up tasks + AI reminder generation
  - /distributor/content/generate    — AI content generator (WhatsApp/email/social)
  - /distributor/content             — list/favorite/delete generated content
  - /distributor/team                — team overview + leaderboard
  - /distributor/analytics           — business analytics + health score
  - /distributor/suggestions         — AI-generated smart notifications
  - /distributor/events              — upcoming events
  - /distributor/role-play           — AI sales role-play sessions

All endpoints require authentication. Data is scoped to the current user
via RLS (distributor_id = auth.uid()).
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/distributor", tags=["distributor"])

# Reuse helpers from main
try:
    from .main import (
        verify_jwt,
        get_user_id,
        require_user_id,
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY,
        GROQ_API_KEY,
        GROQ_MODEL,
        SYSTEM_PROMPT,
        stream_groq,
        load_safety_rules,
        run_safety_check,
    )
except ImportError:
    pass


def _svc_headers(token: Optional[str] = None, json_body: bool = False) -> Dict[str, str]:
    h = {"apikey": SUPABASE_ANON_KEY}
    if json_body:
        h["Content-Type"] = "application/json"
    if SUPABASE_SERVICE_ROLE_KEY:
        h["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    elif token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _prefer_headers(token: Optional[str] = None) -> Dict[str, str]:
    h = _svc_headers(token, json_body=True)
    h["Prefer"] = "return=representation"
    return h


async def _select(table: str, columns: str = "*", filters: Optional[Dict[str, Any]] = None,
                  limit: int = 50, order: Optional[str] = None, token: Optional[str] = None) -> List[Dict[str, Any]]:
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={columns}&limit={limit}"
    if filters:
        for col, val in filters.items():
            if val is None:
                continue
            url += f"&{col}=eq.{val}"
    if order:
        url += f"&order={order}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


async def _insert(table: str, payload: Dict[str, Any], token: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*"
    headers = _prefer_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                return None
            data = resp.json()
            return data[0] if isinstance(data, list) and data else None
    except Exception:
        return None


async def _update(table: str, filters: Dict[str, Any], payload: Dict[str, Any], token: Optional[str] = None) -> List[Dict[str, Any]]:
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}?"
    for col, val in filters.items():
        url += f"&{col}=eq.{val}"
    url += "&select=*"
    headers = _prefer_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


async def _delete(table: str, filters: Dict[str, Any], token: Optional[str] = None) -> bool:
    if not SUPABASE_URL:
        return False
    url = f"{SUPABASE_URL}/rest/v1/{table}?"
    for col, val in filters.items():
        url += f"&{col}=eq.{val}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(url, headers=headers)
            return resp.status_code < 400
    except Exception:
        return False


async def _rpc(fn: str, params: Dict[str, Any], token: Optional[str] = None) -> Any:
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/rest/v1/rpc/{fn}"
    headers = _svc_headers(token, json_body=True)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=params)
            if resp.status_code >= 400:
                return None
            return resp.json()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class GoalCreate(BaseModel):
    goal_type: str = "daily"
    category: str = "sales"
    target_value: float
    current_value: float = 0
    period_start: str
    period_end: str
    notes: Optional[str] = None


class GoalUpdate(BaseModel):
    current_value: Optional[float] = None
    is_achieved: Optional[bool] = None
    notes: Optional[str] = None


class CustomerCreate(BaseModel):
    full_name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    location: Optional[str] = None
    interests: Optional[List[str]] = None
    health_goals: Optional[List[str]] = None
    lifestyle: Optional[str] = None
    preferred_language: str = "en"
    budget_range: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    status: str = "lead"
    next_contact_at: Optional[str] = None
    birthday: Optional[str] = None


class CustomerUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    location: Optional[str] = None
    interests: Optional[List[str]] = None
    health_goals: Optional[List[str]] = None
    lifestyle: Optional[str] = None
    preferred_language: Optional[str] = None
    budget_range: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    next_contact_at: Optional[str] = None
    birthday: Optional[str] = None
    last_contacted_at: Optional[str] = None


class FollowUpCreate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    task_type: str = "call"
    title: str
    description: Optional[str] = None
    due_date: str
    priority: str = "normal"
    ai_generated: bool = False
    ai_suggestion: Optional[str] = None


class FollowUpUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    completed_at: Optional[str] = None
    outcome: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None


class ContentGenerateRequest(BaseModel):
    content_type: str  # whatsapp, email, facebook, instagram, etc.
    prompt: str
    language: str = "en"
    tone: str = "professional"
    customer_name: Optional[str] = None
    product_name: Optional[str] = None
    save: bool = True


class RolePlayStartRequest(BaseModel):
    scenario: str = "objection_price"
    custom_context: Optional[str] = None


class RolePlayMessageRequest(BaseModel):
    message: str


# ---------------------------------------------------------------------------
# Module 1 — Dashboard
# ---------------------------------------------------------------------------
@router.get("/dashboard")
async def distributor_dashboard(request: Request) -> Dict[str, Any]:
    """Personalized distributor dashboard KPIs."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Goals (daily + monthly)
    goals = await _select("distributor_goals", "*", filters={"user_id": user_id}, limit=20, order="period_end.asc", token=token)
    daily_goals = [g for g in goals if g.get("goal_type") == "daily"]
    monthly_goals = [g for g in goals if g.get("goal_type") == "monthly"]

    # Customers
    customers = await _select("customer_profiles", "*", filters={"distributor_id": user_id}, limit=500, token=token)
    active_customers = [c for c in customers if c.get("status") == "active_customer"]

    # Follow-ups
    follow_ups = await _select("follow_ups", "*", filters={"distributor_id": user_id}, limit=50, order="due_date.asc", token=token)
    pending_follow_ups = [f for f in follow_ups if f.get("status") == "pending"]
    overdue = [f for f in pending_follow_ups if f.get("due_date", "") < time.strftime("%Y-%m-%dT%H:%M:%S")]
    due_today = [f for f in pending_follow_ups if (f.get("due_date") or "")[:10] == time.strftime("%Y-%m-%d")]

    # Team
    team = await _select("team_members", "*", filters={"leader_id": user_id}, limit=100, token=token)
    active_team = [t for t in team if t.get("status") == "active"]

    # Recent content
    recent_content = await _select("generated_content", "*", filters={"user_id": user_id}, limit=5, order="created_at.desc", token=token)

    # AI suggestions (unread)
    suggestions = await _select("ai_suggestions", "*", limit=5, order="created_at.desc", token=token)
    unread_suggestions = [s for s in suggestions if not s.get("is_read") and not s.get("is_dismissed")]

    # Upcoming events
    events = await _select("distributor_events", "*", limit=5, order="start_time.asc", token=token)
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S")
    upcoming_events = [e for e in events if (e.get("start_time") or "") >= now_iso and e.get("is_published")]

    # Today's analytics
    today_analytics = await _select("distributor_analytics", "*", filters={"distributor_id": user_id, "metric_date": time.strftime("%Y-%m-%d")}, limit=1, token=token)
    today = today_analytics[0] if today_analytics else {}

    # Business health score (latest)
    health_scores = await _select("business_health_scores", "*", filters={"distributor_id": user_id}, limit=1, order="score_date.desc", token=token)
    health_score = health_scores[0].get("overall_score") if health_scores else None

    return {
        "user_id": user_id,
        "goals": {
            "daily": daily_goals,
            "monthly": monthly_goals,
            "pending_count": len([g for g in goals if not g.get("is_achieved")]),
        },
        "customers": {
            "total": len(customers),
            "active": len(active_customers),
            "leads": len([c for c in customers if c.get("status") == "lead"]),
        },
        "follow_ups": {
            "pending": len(pending_follow_ups),
            "overdue": len(overdue),
            "due_today": len(due_today),
            "recent": follow_ups[:5],
        },
        "team": {
            "total": len(team),
            "active": len(active_team),
        },
        "today": {
            "sales_amount": today.get("sales_amount", 0),
            "calls_made": today.get("calls_made", 0),
            "ai_queries": today.get("ai_queries", 0),
            "content_generated": today.get("content_generated", 0),
        },
        "recent_content": recent_content,
        "suggestions": unread_suggestions[:3],
        "upcoming_events": upcoming_events,
        "business_health_score": health_score,
    }


# ---------------------------------------------------------------------------
# Module 1 — Goals
# ---------------------------------------------------------------------------
@router.get("/goals")
async def list_goals(request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("distributor_goals", "*", filters={"user_id": user_id}, limit=50, order="period_end.desc", token=token)


@router.post("/goals")
async def create_goal(req: GoalCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "user_id": user_id}
    row = await _insert("distributor_goals", payload, token=token)
    return row or {"status": "error", "detail": "Failed to create goal"}


@router.patch("/goals/{goal_id}")
async def update_goal(goal_id: str, req: GoalUpdate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("distributor_goals", {"id": goal_id, "user_id": user_id}, payload, token=token)
    return rows[0] if rows else {"status": "error", "detail": "Not found"}


@router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("distributor_goals", {"id": goal_id, "user_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 3 — Customer Profiles
# ---------------------------------------------------------------------------
@router.get("/customers")
async def list_customers(request: Request, search: Optional[str] = None, status: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/customer_profiles?select=*&distributor_id=eq.{user_id}&order=created_at.desc&limit={limit}"
    if search:
        url += f"&full_name=ilike.*{search}*"
    if status:
        url += f"&status=eq.{status}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return {"customers": [], "total": 0}
            rows = resp.json()
        total = len(rows)
        rng = resp.headers.get("Content-Range", "")
        if "/" in rng:
            try:
                total = int(rng.split("/")[-1])
            except ValueError:
                pass
        return {"customers": rows, "total": total}
    except Exception:
        return {"customers": [], "total": 0}


@router.post("/customers")
async def create_customer(req: CustomerCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "distributor_id": user_id}
    row = await _insert("customer_profiles", payload, token=token)
    return row or {"status": "error", "detail": "Failed to create customer"}


@router.patch("/customers/{customer_id}")
async def update_customer(customer_id: str, req: CustomerUpdate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("customer_profiles", {"id": customer_id, "distributor_id": user_id}, payload, token=token)
    return rows[0] if rows else {"status": "error", "detail": "Not found"}


@router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("customer_profiles", {"id": customer_id, "distributor_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 4 — Follow-up Manager
# ---------------------------------------------------------------------------
@router.get("/follow-ups")
async def list_follow_ups(request: Request, status: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/follow_ups?select=*&distributor_id=eq.{user_id}&order=due_date.asc&limit={limit}"
    if status:
        url += f"&status=eq.{status}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return {"follow_ups": [], "total": 0}
            rows = resp.json()
        return {"follow_ups": rows, "total": len(rows)}
    except Exception:
        return {"follow_ups": [], "total": 0}


@router.post("/follow-ups")
async def create_follow_up(req: FollowUpCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "distributor_id": user_id}
    row = await _insert("follow_ups", payload, token=token)
    return row or {"status": "error", "detail": "Failed to create follow-up"}


@router.patch("/follow-ups/{fu_id}")
async def update_follow_up(fu_id: str, req: FollowUpUpdate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    # Auto-set completed_at when status becomes completed
    if payload.get("status") == "completed" and "completed_at" not in payload:
        payload["completed_at"] = "now()"
    rows = await _update("follow_ups", {"id": fu_id, "distributor_id": user_id}, payload, token=token)
    return rows[0] if rows else {"status": "error", "detail": "Not found"}


@router.delete("/follow-ups/{fu_id}")
async def delete_follow_up(fu_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("follow_ups", {"id": fu_id, "distributor_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 6 — Content Generator (AI)
# ---------------------------------------------------------------------------
CONTENT_PROMPTS = {
    "whatsapp": "Generate a WhatsApp marketing message. Keep it short, friendly, with emojis. No medical or income claims.",
    "email": "Generate a professional email. Include a subject line and a clear call-to-action.",
    "facebook": "Generate a Facebook post. Engaging, with hashtags. No medical or income claims.",
    "instagram": "Generate an Instagram caption. Visual, with emojis and hashtags. No medical or income claims.",
    "training_invitation": "Generate a training invitation message. Include date, time, and topic placeholders.",
    "event_announcement": "Generate an event announcement. Exciting tone with event details.",
    "product_description": "Generate a product description. Highlight benefits (not medical claims), usage, and key ingredients.",
    "follow_up_message": "Generate a polite customer follow-up message. Personalized and not pushy.",
    "greeting": "Generate a warm greeting message. Can be for a festival or general.",
    "festival_promotion": "Generate a festival promotion message. Festive tone with a special offer placeholder.",
    "sms": "Generate a short SMS message. Under 160 characters.",
    "linkedin": "Generate a LinkedIn post. Professional tone with industry insights.",
}


@router.post("/content/generate")
async def generate_content(req: ContentGenerateRequest, request: Request) -> Dict[str, Any]:
    """Generate AI content for marketing / follow-up / social."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    content_prompt = CONTENT_PROMPTS.get(req.content_type, "Generate marketing content for a Dayjoy distributor.")
    full_prompt = f"{content_prompt}\n\nTone: {req.tone}\nLanguage: {req.language}\n"
    if req.customer_name:
        full_prompt += f"Customer name: {req.customer_name}\n"
    if req.product_name:
        full_prompt += f"Product: {req.product_name}\n"
    full_prompt += f"\nRequest: {req.prompt}\n\nGenerate only the content, no preamble."

    # Safety check
    rules = await load_safety_rules()
    is_blocked, rule_key = run_safety_check(full_prompt, rules)
    if is_blocked:
        raise HTTPException(status_code=400, detail=f"Content blocked by safety rule: {rule_key}")

    # Generate via Groq (or fallback)
    content = ""
    try:
        if GROQ_API_KEY:
            async for tok in stream_groq(full_prompt, [], "", req.language):
                content += tok
    except Exception:
        pass

    if not content:
        content = f"[Generated content for {req.content_type}]: {req.prompt[:200]}..."

    # Save to database
    saved_row = None
    if req.save:
        payload = {
            "user_id": user_id,
            "content_type": req.content_type,
            "title": req.prompt[:80],
            "content": content,
            "prompt": req.prompt,
            "language": req.language,
            "tone": req.tone,
        }
        saved_row = await _insert("generated_content", payload, token=token)

    return {"content": content, "saved": saved_row}


@router.get("/content")
async def list_content(request: Request, content_type: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/generated_content?select=*&user_id=eq.{user_id}&order=created_at.desc&limit={limit}"
    if content_type:
        url += f"&content_type=eq.{content_type}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return {"content": [], "total": 0}
            rows = resp.json()
        return {"content": rows, "total": len(rows)}
    except Exception:
        return {"content": [], "total": 0}


@router.patch("/content/{content_id}/favorite")
async def toggle_content_favorite(content_id: str, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    # Fetch current
    rows = await _select("generated_content", "id,is_favorite", filters={"id": content_id, "user_id": user_id}, limit=1, token=token)
    if not rows:
        raise HTTPException(status_code=404, detail="Content not found")
    new_val = not rows[0].get("is_favorite", False)
    updated = await _update("generated_content", {"id": content_id, "user_id": user_id}, {"is_favorite": new_val}, token=token)
    return {"is_favorite": new_val, "content": updated[0] if updated else None}


@router.delete("/content/{content_id}")
async def delete_content(content_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("generated_content", {"id": content_id, "user_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 8 — Team Management
# ---------------------------------------------------------------------------
@router.get("/team")
async def team_overview(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    members = await _select("team_members", "*", filters={"leader_id": user_id}, limit=100, order="total_sales.desc", token=token)
    active = [m for m in members if m.get("status") == "active"]
    total_sales = sum(float(m.get("total_sales") or 0) for m in active)
    avg_training = sum(float(m.get("training_completion") or 0) for m in active) / len(active) if active else 0

    # Recognition
    recognition = await _select("team_recognition", "*", filters={"leader_id": user_id}, limit=20, order="awarded_at.desc", token=token)

    return {
        "members": members,
        "active_count": len(active),
        "total_sales": total_sales,
        "avg_training": round(avg_training, 2),
        "recognition": recognition,
        "leaderboard": sorted(active, key=lambda m: float(m.get("total_sales") or 0), reverse=True)[:10],
    }


@router.post("/team/recognition")
async def add_recognition(payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload["leader_id"] = user_id
    row = await _insert("team_recognition", payload, token=token)
    return row or {"status": "error", "detail": "Failed to add recognition"}


# ---------------------------------------------------------------------------
# Module 9 — Business Analytics
# ---------------------------------------------------------------------------
@router.get("/analytics")
async def business_analytics(request: Request, days: int = 30) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    import datetime
    since = (datetime.datetime.utcnow() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    url = f"{SUPABASE_URL}/rest/v1/distributor_analytics?select=*&distributor_id=eq.{user_id}&metric_date=gte.{since}&order=metric_date.asc&limit={days + 5}"
    headers = _svc_headers(token)
    daily_metrics: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                daily_metrics = resp.json()
    except Exception:
        pass

    # Health score
    health_score = await _rpc("compute_business_health_score", {"p_user_id": user_id}, token=token)

    # Aggregates
    total_sales = sum(float(d.get("sales_amount") or 0) for d in daily_metrics)
    total_calls = sum(int(d.get("calls_made") or 0) for d in daily_metrics)
    total_follow_ups = sum(int(d.get("follow_ups_completed") or 0) for d in daily_metrics)
    total_ai_queries = sum(int(d.get("ai_queries") or 0) for d in daily_metrics)
    total_new_customers = sum(int(d.get("new_customers") or 0) for d in daily_metrics)

    return {
        "daily_metrics": daily_metrics,
        "aggregates": {
            "total_sales": total_sales,
            "total_calls": total_calls,
            "total_follow_ups": total_follow_ups,
            "total_ai_queries": total_ai_queries,
            "total_new_customers": total_new_customers,
            "days": days,
        },
        "business_health_score": health_score,
    }


# ---------------------------------------------------------------------------
# Module 10 — Smart Notifications / AI Suggestions
# ---------------------------------------------------------------------------
@router.get("/suggestions")
async def list_suggestions(request: Request, limit: int = 20) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/ai_suggestions?select=*&user_id=eq.{user_id}&is_dismissed=eq.false&order=created_at.desc&limit={limit}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


@router.patch("/suggestions/{suggestion_id}/read")
async def mark_suggestion_read(suggestion_id: str, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _update("ai_suggestions", {"id": suggestion_id, "user_id": user_id}, {"is_read": True}, token=token)
    return {"status": "read", "suggestion": rows[0] if rows else None}


@router.patch("/suggestions/{suggestion_id}/dismiss")
async def dismiss_suggestion(suggestion_id: str, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _update("ai_suggestions", {"id": suggestion_id, "user_id": user_id}, {"is_dismissed": True}, token=token)
    return {"status": "dismissed", "suggestion": rows[0] if rows else None}


# ---------------------------------------------------------------------------
# Module 7 — Events
# ---------------------------------------------------------------------------
@router.get("/events")
async def list_events(request: Request, limit: int = 20) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    import datetime
    now_iso = datetime.datetime.utcnow().isoformat()
    url = f"{SUPABASE_URL}/rest/v1/distributor_events?select=*&start_time=gte.{now_iso}&is_published=eq.true&order=start_time.asc&limit={limit}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Module 2 — AI Sales Coach (role-play)
# ---------------------------------------------------------------------------
@router.post("/role-play/start")
async def start_role_play(req: RolePlayStartRequest, request: Request) -> Dict[str, Any]:
    """Start a new AI sales role-play session. Returns the opening customer message."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    scenario_prompts = {
        "objection_price": "You are a skeptical customer who thinks the product is too expensive. Respond to the distributor's opening.",
        "objection_trust": "You are a customer who doesn't trust direct-selling companies. Respond to the distributor.",
        "objection_time": "You are a busy customer who says they don't have time. Respond to the distributor.",
        "objection_competitor": "You are a customer using a competitor's product. Respond to the distributor.",
        "closing": "You are a customer who is interested but hesitant to buy. Respond to the distributor's closing attempt.",
        "cold_call": "You are a stranger receiving a cold call. Respond to the distributor's introduction.",
        "follow_up": "You are a customer who was contacted a week ago. Respond to the follow-up.",
        "product_pitch": "You are a customer interested in health products. Respond to the distributor's pitch.",
        "recruitment": "You are a prospect being recruited into the business. Respond to the distributor.",
    }
    scenario_prompt = scenario_prompts.get(req.scenario, scenario_prompts["objection_price"])
    if req.custom_context:
        scenario_prompt += f"\n\nAdditional context: {req.custom_context}"

    # Generate opening customer message
    opening = ""
    try:
        if GROQ_API_KEY:
            prompt = f"{scenario_prompt}\n\nGenerate the customer's opening statement (1-2 sentences). Be realistic and challenging. Do not include any preamble — just the customer's words."
            async for tok in stream_groq(prompt, [], "", "en"):
                opening += tok
    except Exception:
        pass

    if not opening:
        opening = "Hi, I'm not sure I'm interested. What is this about?"

    # Create session
    payload = {
        "user_id": user_id,
        "scenario": req.scenario,
        "customer_persona": {"scenario_prompt": scenario_prompt},
        "messages": [{"role": "customer", "content": opening, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")}],
        "outcome": "in_progress",
    }
    row = await _insert("role_play_sessions", payload, token=token)
    return {"session": row, "opening_message": opening}


@router.post("/role-play/{session_id}/message")
async def role_play_message(session_id: str, req: RolePlayMessageRequest, request: Request) -> Dict[str, Any]:
    """Send a distributor message in a role-play session and get the customer's response."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Fetch session
    sessions = await _select("role_play_sessions", "*", filters={"id": session_id, "user_id": user_id}, limit=1, token=token)
    if not sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    session = sessions[0]

    messages = session.get("messages") or []
    persona = session.get("customer_persona") or {}
    scenario_prompt = persona.get("scenario_prompt", "You are a customer in a sales conversation.")

    # Add distributor's message
    messages.append({"role": "distributor", "content": req.message, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")})

    # Generate customer response
    history_text = "\n".join([f"{'Distributor' if m.get('role') == 'distributor' else 'Customer'}: {m.get('content', '')}" for m in messages[-6:]])
    prompt = f"{scenario_prompt}\n\nConversation so far:\n{history_text}\n\nDistributor just said: {req.message}\n\nRespond as the customer (1-2 sentences). Stay in character. Do not include any preamble."

    response = ""
    try:
        if GROQ_API_KEY:
            async for tok in stream_groq(prompt, [], "", "en"):
                response += tok
    except Exception:
        pass

    if not response:
        response = "Hmm, I see. Tell me more."

    # Add customer response
    messages.append({"role": "customer", "content": response, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")})

    # Update session
    await _update("role_play_sessions", {"id": session_id, "user_id": user_id}, {"messages": messages}, token=token)

    return {"customer_response": response, "messages": messages}


@router.post("/role-play/{session_id}/end")
async def end_role_play(session_id: str, request: Request) -> Dict[str, Any]:
    """End a role-play session and get AI feedback."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    sessions = await _select("role_play_sessions", "*", filters={"id": session_id, "user_id": user_id}, limit=1, token=token)
    if not sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    session = sessions[0]

    messages = session.get("messages") or []
    history_text = "\n".join([f"{'Distributor' if m.get('role') == 'distributor' else 'Customer'}: {m.get('content', '')}" for m in messages])

    # Generate feedback
    prompt = f"You are a sales coach reviewing a role-play session. Scenario: {session.get('scenario')}\n\nConversation:\n{history_text}\n\nProvide:\n1. Overall score (0-100)\n2. What went well\n3. What could be improved\n4. One key tip\n\nBe constructive and specific."

    feedback = ""
    score = 70.0
    try:
        if GROQ_API_KEY:
            async for tok in stream_groq(prompt, [], "", "en"):
                feedback += tok
    except Exception:
        pass

    if not feedback:
        feedback = "Good effort! Try to listen more and ask open-ended questions."

    payload = {
        "outcome": "completed",
        "completed_at": "now()",
        "ai_feedback": feedback,
        "score": score,
    }
    rows = await _update("role_play_sessions", {"id": session_id, "user_id": user_id}, payload, token=token)

    return {"feedback": feedback, "score": score, "session": rows[0] if rows else None}


@router.get("/role-play/history")
async def role_play_history(request: Request, limit: int = 20) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("role_play_sessions", "id,scenario,outcome,score,started_at,completed_at", filters={"user_id": user_id}, limit=limit, order="created_at.desc", token=token)
