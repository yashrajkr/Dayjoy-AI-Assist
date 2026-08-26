"""
Phase 4 — Customer Experience Platform (CXP) API endpoints.

Adds the /customer/* routes:
  - /customer/dashboard           — personalized dashboard KPIs
  - /customer/favorites           — CRUD favorites (products/FAQs/conversations)
  - /customer/collections         — CRUD collections + items
  - /customer/recently-viewed     — list + track
  - /customer/comparisons         — save/list product comparisons
  - /customer/wellness/goals      — CRUD wellness goals
  - /customer/wellness/activities — log activities
  - /customer/wellness/reminders  — CRUD reminders
  - /customer/feedback            — submit AI/product/support feedback
  - /customer/profile-prefs       — get/update extended profile
  - /customer/announcements       — list published announcements
  - /customer/knowledge-search    — universal knowledge search
  - /customer/tickets             — list own tickets + replies + ratings
  - /customer/recommendations     — AI personalized recommendations

All endpoints require authentication. Data scoped to auth.uid() via RLS.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/customer", tags=["customer"])

try:
    from .main import (
        require_user_id, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
        GROQ_API_KEY, stream_groq, load_safety_rules, run_safety_check,
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


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class FavoriteCreate(BaseModel):
    entity_type: str  # product, faq, conversation, training, document, policy
    entity_id: str
    entity_name: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class CollectionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#0f766e"
    icon: str = "📁"
    is_public: bool = False


class CollectionItemCreate(BaseModel):
    entity_type: str
    entity_id: str
    entity_name: Optional[str] = None


class ComparisonCreate(BaseModel):
    name: Optional[str] = None
    product_ids: List[str]
    product_data: Optional[Dict[str, Any]] = None


class WellnessGoalCreate(BaseModel):
    goal_type: str = "general"
    title: str
    description: Optional[str] = None
    target_value: Optional[float] = None
    current_value: float = 0
    unit: str = ""
    target_date: Optional[str] = None


class WellnessGoalUpdate(BaseModel):
    current_value: Optional[float] = None
    is_completed: Optional[bool] = None
    description: Optional[str] = None


class WellnessActivityCreate(BaseModel):
    activity_type: str = "custom"
    title: str
    description: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    activity_date: Optional[str] = None
    # Links this activity to the goal it counts toward (wellness_activities.
    # goal_id, migration v28) — when set, log_wellness_activity() below also
    # auto-advances that goal's current_value, so Goals and Activities are no
    # longer two disconnected tabs.
    goal_id: Optional[str] = None


class ReminderCreate(BaseModel):
    reminder_type: str = "product"
    title: str
    description: Optional[str] = None
    product_id: Optional[str] = None
    frequency: str = "daily"
    time_of_day: Optional[str] = None
    days_of_week: Optional[List[int]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class WellnessCheckinCreate(BaseModel):
    # Merged into today's row rather than replacing it — the check-in is
    # adaptive (asks 1-3 questions, not all of them), so a second check-in
    # later the same day (e.g. answering a question skipped this morning)
    # must add to today's signals, not overwrite the ones already answered.
    signals: Dict[str, int] = Field(default_factory=dict)


class WellnessPreferenceUpsert(BaseModel):
    """Public, human-facing upsert (Settings UI / chat "remember this").
    `provenance` is deliberately NOT accepted here — this endpoint always
    writes provenance='user_provided', confidence=None, server-side,
    regardless of what a client sends, so a tentative AI-side write can never
    masquerade as a user-confirmed fact by posting to the public endpoint.
    AI-side tentative writes go through save_inferred_wellness_signal()
    (backend/orchestrator/tools/wellness_profile.py) instead, which is not
    reachable from any public route."""

    key: str = Field(..., min_length=1, max_length=80)
    value: str = Field(..., min_length=1, max_length=500)


_MILESTONE_TYPES = ("first_checkin", "streak_3", "streak_7", "goal_completed", "personal_best")


class WellnessMilestoneCreate(BaseModel):
    milestone_type: str
    goal_id: Optional[str] = None


class WellnessReflectionUpdate(BaseModel):
    reflection: str = Field(..., min_length=1, max_length=2000)


class FeedbackCreate(BaseModel):
    feedback_type: str = "ai_response"
    rating: Optional[int] = Field(None, ge=1, le=5)
    category: Optional[str] = None
    message_id: Optional[str] = None
    conversation_id: Optional[str] = None
    feedback_text: Optional[str] = None
    is_reported: bool = False
    report_reason: Optional[str] = None


class ProfilePrefsUpdate(BaseModel):
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    preferred_language: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    health_goals: Optional[List[str]] = None
    interests: Optional[List[str]] = None
    allergies: Optional[List[str]] = None
    dietary_preferences: Optional[List[str]] = None
    email_notifications: Optional[bool] = None
    push_notifications: Optional[bool] = None
    sms_notifications: Optional[bool] = None
    whatsapp_updates: Optional[bool] = None
    marketing_emails: Optional[bool] = None
    share_data_with_distributor: Optional[bool] = None
    share_analytics: Optional[bool] = None
    public_profile: Optional[bool] = None
    ai_personalization: Optional[bool] = None
    preferred_ai_tone: Optional[str] = None
    onboarding_completed: Optional[bool] = None


class TicketReplyCreate(BaseModel):
    body: str
    is_internal: bool = False


class TicketRatingCreate(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    feedback: Optional[str] = None


class KnowledgeSearchRequest(BaseModel):
    query: str
    entity_types: Optional[List[str]] = None
    language: str = "en"


class RecommendationRequest(BaseModel):
    health_goals: Optional[List[str]] = None
    age: Optional[int] = None
    lifestyle: Optional[str] = None
    preferences: Optional[List[str]] = None
    budget_range: Optional[str] = None
    language: str = "en"


# ---------------------------------------------------------------------------
# Module 1 — Dashboard
# ---------------------------------------------------------------------------
@router.get("/dashboard")
async def customer_dashboard(request: Request) -> Dict[str, Any]:
    """Personalized customer dashboard KPIs + content."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # KPIs from view
    dash_rows = await _select("customer_dashboard_summary", "*", filters={"user_id": user_id}, limit=1, token=token)
    kpis = dash_rows[0] if dash_rows else {}

    # Favorites (products)
    fav_products = await _select("customer_favorites", "*", filters={"user_id": user_id, "entity_type": "product"}, limit=10, order="created_at.desc", token=token)

    # Recently viewed
    recent = await _select("recently_viewed", "*", filters={"user_id": user_id}, limit=10, order="last_viewed_at.desc", token=token)

    # Wellness goals (active)
    goals = await _select("wellness_goals", "*", filters={"user_id": user_id, "is_completed": "false"}, limit=5, order="created_at.desc", token=token)

    # Active reminders
    reminders = await _select("wellness_reminders", "*", filters={"user_id": user_id, "is_active": "true"}, limit=5, token=token)

    # Support tickets (open)
    tickets = await _select("support_tickets", "id,query,issue_category,status,priority,created_at", filters={"user_id": user_id}, limit=5, order="created_at.desc", token=token)
    open_tickets = [t for t in tickets if t.get("status") != "closed"]

    # Announcements
    import datetime
    now_iso = datetime.datetime.utcnow().isoformat()
    ann_url = f"{SUPABASE_URL}/rest/v1/customer_announcements?select=id,title,body,category,action_url,action_label,image_url,published_at&is_published=eq.true&or=(expires_at.is.null,expires_at.gt.{now_iso})&order=published_at.desc&limit=5"
    ann_headers = _svc_headers(token)
    announcements: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(ann_url, headers=ann_headers)
            if resp.status_code < 400:
                announcements = resp.json()
    except Exception:
        pass

    # Recommended products (AI) — use approved products as fallback
    recommended = await _select("products", "id,product_name,category,benefits,ingredients,usage", filters={"approval_status": "approved"}, limit=5, order="created_at.desc", token=token)

    return {
        "user_id": user_id,
        "kpis": {
            "favorite_products": kpis.get("favorite_products", 0),
            "total_favorites": kpis.get("total_favorites", 0),
            "recently_viewed_count": kpis.get("recently_viewed_count", 0),
            "active_wellness_goals": kpis.get("active_wellness_goals", 0),
            "open_tickets": kpis.get("open_tickets", len(open_tickets)),
            "collection_count": kpis.get("collection_count", 0),
            "active_reminders": kpis.get("active_reminders", len(reminders)),
        },
        "favorites": fav_products,
        "recently_viewed": recent,
        "wellness_goals": goals,
        "reminders": reminders,
        "tickets": open_tickets,
        "announcements": announcements,
        "recommended_products": recommended,
    }


# ---------------------------------------------------------------------------
# Module 7 — Favorites
# ---------------------------------------------------------------------------
@router.get("/favorites")
async def list_favorites(request: Request, entity_type: Optional[str] = None) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters = {"user_id": user_id}
    if entity_type:
        filters["entity_type"] = entity_type
    return await _select("customer_favorites", "*", filters=filters, limit=100, order="created_at.desc", token=token)


@router.post("/favorites")
async def add_favorite(req: FavoriteCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "user_id": user_id}
    # Upsert (ignore if exists)
    row = await _insert("customer_favorites", payload, token=token)
    return row or {"status": "exists"}


@router.delete("/favorites/{favorite_id}")
async def remove_favorite(favorite_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("customer_favorites", {"id": favorite_id, "user_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------
@router.get("/collections")
async def list_collections(request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("customer_collections", "*", filters={"user_id": user_id}, limit=50, order="created_at.desc", token=token)


@router.post("/collections")
async def create_collection(req: CollectionCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "user_id": user_id}
    return await _insert("customer_collections", payload, token=token) or {"status": "error"}


@router.delete("/collections/{collection_id}")
async def delete_collection(collection_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("customer_collections", {"id": collection_id, "user_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


@router.post("/collections/{collection_id}/items")
async def add_collection_item(collection_id: str, req: CollectionItemCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    # Verify ownership
    cols = await _select("customer_collections", "id", filters={"id": collection_id, "user_id": user_id}, limit=1, token=token)
    if not cols:
        raise HTTPException(status_code=404, detail="Collection not found")
    payload = {**req.model_dump(), "collection_id": collection_id}
    return await _insert("customer_collection_items", payload, token=token) or {"status": "exists"}


@router.get("/collections/{collection_id}/items")
async def list_collection_items(collection_id: str, request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("customer_collection_items", "*", filters={"collection_id": collection_id}, limit=100, order="added_at.desc", token=token)


# ---------------------------------------------------------------------------
# Recently Viewed
# ---------------------------------------------------------------------------
@router.get("/recently-viewed")
async def list_recently_viewed(request: Request, entity_type: Optional[str] = None) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters = {"user_id": user_id}
    if entity_type:
        filters["entity_type"] = entity_type
    return await _select("recently_viewed", "*", filters=filters, limit=20, order="last_viewed_at.desc", token=token)


@router.post("/recently-viewed")
async def track_recently_viewed(req: Dict[str, Any], request: Request) -> Dict[str, str]:
    """Track a recently viewed entity. Upserts — increments view_count."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    entity_type = req.get("entity_type", "product")
    entity_id = req.get("entity_id")
    entity_name = req.get("entity_name")
    if not entity_id:
        raise HTTPException(status_code=400, detail="entity_id required")

    # Check if exists
    existing = await _select("recently_viewed", "*", filters={"user_id": user_id, "entity_type": entity_type, "entity_id": entity_id}, limit=1, token=token)
    if existing:
        # Update view_count + last_viewed_at
        await _update("recently_viewed", {"id": existing[0]["id"]}, {
            "view_count": int(existing[0].get("view_count", 1)) + 1,
            "last_viewed_at": "now()",
            "entity_name": entity_name,
        }, token=token)
    else:
        await _insert("recently_viewed", {
            "user_id": user_id, "entity_type": entity_type,
            "entity_id": entity_id, "entity_name": entity_name,
        }, token=token)
    return {"status": "tracked"}


# ---------------------------------------------------------------------------
# Product Comparisons
# ---------------------------------------------------------------------------
@router.get("/comparisons")
async def list_comparisons(request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("product_comparisons", "*", filters={"user_id": user_id}, limit=20, order="created_at.desc", token=token)


@router.post("/comparisons")
async def save_comparison(req: ComparisonCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "user_id": user_id}
    return await _insert("product_comparisons", payload, token=token) or {"status": "error"}


@router.delete("/comparisons/{comparison_id}")
async def delete_comparison(comparison_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("product_comparisons", {"id": comparison_id, "user_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 8 — Wellness Journey
# ---------------------------------------------------------------------------
@router.get("/wellness/goals")
async def list_wellness_goals(request: Request, active_only: bool = False) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters = {"user_id": user_id}
    if active_only:
        filters["is_completed"] = "false"
    return await _select("wellness_goals", "*", filters=filters, limit=50, order="created_at.desc", token=token)


@router.post("/wellness/goals")
async def create_wellness_goal(req: WellnessGoalCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "user_id": user_id}
    return await _insert("wellness_goals", payload, token=token) or {"status": "error"}


@router.patch("/wellness/goals/{goal_id}")
async def update_wellness_goal(goal_id: str, req: WellnessGoalUpdate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    if payload.get("is_completed"):
        # A literal "now()" string here would insert the text "now()" into
        # completed_at, not an actual SQL NOW() — PostgREST payloads are
        # plain JSON values, not SQL expressions.
        payload["completed_at"] = _utc_now_iso()
    rows = await _update("wellness_goals", {"id": goal_id, "user_id": user_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.delete("/wellness/goals/{goal_id}")
async def delete_wellness_goal(goal_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("wellness_goals", {"id": goal_id, "user_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


@router.get("/wellness/activities")
async def list_wellness_activities(request: Request, limit: int = 50) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("wellness_activities", "*", filters={"user_id": user_id}, limit=limit, order="activity_date.desc", token=token)


async def _apply_activity_to_goal(
    goal_id: str, user_id: str, value: Optional[float], duration_minutes: Optional[int], token: Optional[str]
) -> None:
    """Advances a goal's current_value by whatever this activity logged
    (its numeric value, or duration in minutes, or 1 as a plain "did it"
    tick) — best-effort: a goal that doesn't exist, isn't this user's, or
    is already completed is silently skipped rather than raising, since a
    failed auto-advance shouldn't block the activity log itself."""
    rows = await _select("wellness_goals", "*", filters={"id": goal_id, "user_id": user_id}, limit=1, token=token)
    if not rows or rows[0].get("is_completed"):
        return
    goal = rows[0]
    delta = value if value is not None else (duration_minutes if duration_minutes is not None else 1)
    new_value = float(goal.get("current_value") or 0) + float(delta)
    target = goal.get("target_value")
    update_payload: Dict[str, Any] = {"current_value": new_value}
    if target is not None and new_value >= float(target):
        update_payload["is_completed"] = True
        update_payload["completed_at"] = _utc_now_iso()
    await _update("wellness_goals", {"id": goal_id, "user_id": user_id}, update_payload, token=token)


@router.post("/wellness/activities")
async def log_wellness_activity(req: WellnessActivityCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "user_id": user_id}
    result = await _insert("wellness_activities", payload, token=token)
    if not result:
        return {"status": "error"}
    if req.goal_id:
        await _apply_activity_to_goal(req.goal_id, user_id, req.value, req.duration_minutes, token)
    return result


@router.get("/wellness/reminders")
async def list_reminders(request: Request, active_only: bool = False) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters = {"user_id": user_id}
    if active_only:
        filters["is_active"] = "true"
    return await _select("wellness_reminders", "*", filters=filters, limit=50, order="created_at.desc", token=token)


@router.post("/wellness/reminders")
async def create_reminder(req: ReminderCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "user_id": user_id}
    return await _insert("wellness_reminders", payload, token=token) or {"status": "error"}


@router.patch("/wellness/reminders/{reminder_id}")
async def update_reminder(reminder_id: str, payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _update("wellness_reminders", {"id": reminder_id, "user_id": user_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.delete("/wellness/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("wellness_reminders", {"id": reminder_id, "user_id": user_id}, token=token)
    return {"status": "deleted" if ok else "error"}


@router.post("/wellness/reminders/check")
async def check_due_wellness_reminders(request: Request) -> Dict[str, Any]:
    """Client-triggered due-reminder check for Wellness Journey reminders —
    mirrors reminders_api.py's check_due_reminders() (Capability 33) but
    over `wellness_reminders`, a deliberately separate table (see the
    "ScheduledReminder vs Reminder" comment in src/lib/api.ts for why these
    two reminder systems were kept apart). Delivers each due reminder as a
    row in the SAME shared `notifications` table Capability 33 already
    uses, so the existing NotificationCenter UI picks it up with no new
    backend table or frontend list — the frontend additionally turns each
    delivered item into a real browser/OS notification via the existing
    src/app/lib/pushNotifications.ts (see UserLayout.tsx's polling effect).

    Simplification consistent with reminders_api.py's own scope: no
    per-user timezone is stored anywhere in this schema, so `time_of_day`
    is compared directly against server UTC wall-clock time — same
    approach already used (or rather, not yet solved) elsewhere in this
    codebase, not a new gap introduced here."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    rows = await _select("wellness_reminders", "*", filters={"user_id": user_id, "is_active": "true"}, limit=100, token=token)
    now = datetime.now(timezone.utc)
    delivered: List[Dict[str, Any]] = []

    for r in rows:
        time_of_day = r.get("time_of_day")
        if not time_of_day:
            continue
        try:
            hh, mm = str(time_of_day).split(":")[:2]
            due_today = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        except (ValueError, TypeError):
            continue
        if now < due_today:
            continue  # not due yet today

        last_triggered = r.get("last_triggered_at")
        if last_triggered:
            try:
                last_dt = datetime.fromisoformat(str(last_triggered).replace("Z", "+00:00"))
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                # Already fired recently — don't re-fire on every 5-minute
                # poll once due; ~20h keeps a daily reminder to once/day
                # without needing real cron/timezone-aware scheduling.
                if (now - last_dt) < timedelta(hours=20):
                    continue
            except (ValueError, TypeError):
                pass

        await _insert(
            "notifications",
            {
                "user_id": user_id,
                "type": "system",
                "title": r.get("title") or "Wellness reminder",
                "body": r.get("description") or "Time for your wellness reminder.",
                "link": "/wellness",
            },
            token=token,
        )
        delivered.append({"id": r["id"], "title": r.get("title")})
        await _update("wellness_reminders", {"id": r["id"], "user_id": user_id}, {"last_triggered_at": _utc_now_iso()}, token=token)

    return {"delivered": delivered, "count": len(delivered)}


# ---------------------------------------------------------------------------
# Module 11b — Wellness Daily Check-in (Phase 4) + Recovery Mode signal
# source (Phase 17 — Recovery Mode itself is derived client-side from
# today's signals; this is just where they're persisted) + Smart Journey
# Memory / Preferences (Phase 18).
# ---------------------------------------------------------------------------
@router.get("/wellness/checkins/today")
async def get_today_checkin(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    today = date.today().isoformat()
    rows = await _select(
        "wellness_checkins", "*", filters={"user_id": user_id, "checkin_date": today}, limit=1, token=token
    )
    return rows[0] if rows else {"checkin_date": today, "signals": {}}


@router.get("/wellness/checkins")
async def list_checkins(request: Request, limit: int = 30) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select(
        "wellness_checkins", "*", filters={"user_id": user_id}, limit=limit, order="checkin_date.desc", token=token
    )


@router.post("/wellness/checkins")
async def upsert_today_checkin(req: WellnessCheckinCreate, request: Request) -> Dict[str, Any]:
    """Merges `req.signals` into today's row rather than replacing it — the
    check-in only asks 1-3 questions at a time (adaptive, per Phase 4), so
    a later check-in the same day must add to what's already answered, not
    overwrite it."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    today = date.today().isoformat()
    existing = await _select(
        "wellness_checkins", "*", filters={"user_id": user_id, "checkin_date": today}, limit=1, token=token
    )
    if existing:
        merged_signals = {**(existing[0].get("signals") or {}), **req.signals}
        rows = await _update(
            "wellness_checkins", {"id": existing[0]["id"], "user_id": user_id},
            {"signals": merged_signals, "updated_at": _utc_now_iso()}, token=token,
        )
        return rows[0] if rows else {"status": "error"}
    payload = {"user_id": user_id, "checkin_date": today, "signals": req.signals}
    return await _insert("wellness_checkins", payload, token=token) or {"status": "error"}


@router.get("/wellness/preferences")
async def list_wellness_preferences(request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select(
        "wellness_preferences", "*", filters={"user_id": user_id}, limit=100, order="updated_at.desc", token=token
    )


@router.post("/wellness/preferences")
async def upsert_wellness_preference(req: WellnessPreferenceUpsert, request: Request) -> Dict[str, Any]:
    """Upsert-by-key — a preference is identified by its key
    (unique per user, per the v31 migration), not a row id the client has
    to track, so remembering "coaching_style" a second time updates the
    same row instead of accumulating duplicates.

    Always writes provenance='user_provided', confidence=None — this is the
    public, human-facing "I'm telling you this" path (see
    WellnessPreferenceUpsert docstring). Also the correction/edit path: a
    user editing an AI-inferred value through Settings promotes it to a
    confirmed fact, same as the dedicated /confirm endpoint below."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    existing = await _select(
        "wellness_preferences", "*", filters={"user_id": user_id, "key": req.key}, limit=1, token=token
    )
    if existing:
        rows = await _update(
            "wellness_preferences", {"id": existing[0]["id"], "user_id": user_id},
            {
                "value": req.value, "provenance": "user_provided", "confidence": None,
                "consent": True, "updated_at": _utc_now_iso(),
            },
            token=token,
        )
        return rows[0] if rows else {"status": "error"}
    payload = {
        "user_id": user_id, "key": req.key, "value": req.value,
        "provenance": "user_provided", "confidence": None, "consent": True,
    }
    return await _insert("wellness_preferences", payload, token=token) or {"status": "error"}


@router.post("/wellness/preferences/{key}/confirm")
async def confirm_wellness_preference(key: str, request: Request) -> Dict[str, Any]:
    """User accepts an AI-tentative signal (inferred_conversation /
    ai_recommendation) as correct — promotes it to a confirmed fact
    (provenance='user_provided', confidence cleared). This is the only way a
    tentative signal becomes something the AI is allowed to state as
    settled; nothing here lets a client set an arbitrary provenance."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    existing = await _select(
        "wellness_preferences", "*", filters={"user_id": user_id, "key": key}, limit=1, token=token
    )
    if not existing:
        raise HTTPException(status_code=404, detail="No such wellness preference")
    rows = await _update(
        "wellness_preferences", {"id": existing[0]["id"], "user_id": user_id},
        {"provenance": "user_provided", "confidence": None, "updated_at": _utc_now_iso()},
        token=token,
    )
    return rows[0] if rows else {"status": "error"}


@router.delete("/wellness/preferences/{key}")
async def delete_wellness_preference(key: str, request: Request) -> Dict[str, str]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("wellness_preferences", {"user_id": user_id, "key": key}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 11c — Journey Milestones (Phase 11) + AI Reflection (Phase 12)
# ---------------------------------------------------------------------------
@router.get("/wellness/milestones")
async def list_wellness_milestones(request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select(
        "wellness_milestones", "*", filters={"user_id": user_id}, limit=100, order="achieved_at.desc", token=token
    )


@router.post("/wellness/milestones")
async def create_wellness_milestone(req: WellnessMilestoneCreate, request: Request) -> Dict[str, Any]:
    """Idempotent by design (check-then-insert, not upsert): the frontend's
    milestone detection re-evaluates conditions on every load and calls
    this freely whenever a condition looks newly met — returning the
    existing row on a repeat call (rather than a 409) means the caller
    never has to pre-check first."""
    if req.milestone_type not in _MILESTONE_TYPES:
        raise HTTPException(status_code=400, detail=f"milestone_type must be one of {_MILESTONE_TYPES}")
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters: Dict[str, Any] = {"user_id": user_id, "milestone_type": req.milestone_type}
    if req.goal_id:
        filters["goal_id"] = req.goal_id
    existing = await _select("wellness_milestones", "*", filters=filters, limit=1, token=token)
    if existing:
        return existing[0]
    payload = {"user_id": user_id, "milestone_type": req.milestone_type, "goal_id": req.goal_id}
    return await _insert("wellness_milestones", payload, token=token) or {"status": "error"}


@router.patch("/wellness/milestones/{milestone_id}")
async def add_milestone_reflection(milestone_id: str, req: WellnessReflectionUpdate, request: Request) -> Dict[str, Any]:
    """AI Reflection (Phase 12) — the reflection is stored verbatim as the
    user's own words, never rewritten or summarized by the model. A future
    pass could offer to save a useful answer as a wellness_preference, but
    that requires a judgment call this endpoint deliberately doesn't make
    on the user's behalf."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _update(
        "wellness_milestones", {"id": milestone_id, "user_id": user_id},
        {"reflection": req.reflection}, token=token,
    )
    return rows[0] if rows else {"status": "error"}


# ---------------------------------------------------------------------------
# Module 12 — Feedback
# ---------------------------------------------------------------------------
@router.get("/feedback")
async def list_feedback(request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("customer_feedback", "*", filters={"user_id": user_id}, limit=50, order="created_at.desc", token=token)


@router.post("/feedback")
async def submit_feedback(req: FeedbackCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "user_id": user_id}
    return await _insert("customer_feedback", payload, token=token) or {"status": "error"}


# ---------------------------------------------------------------------------
# Module 6 — Profile Preferences
# ---------------------------------------------------------------------------
@router.get("/profile-prefs")
async def get_profile_prefs(request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _select("customer_profile_prefs", "*", filters={"user_id": user_id}, limit=1, token=token)
    if rows:
        return rows[0]
    # Return defaults
    return {
        "preferred_language": "en",
        "email_notifications": True,
        "push_notifications": True,
        "whatsapp_updates": True,
        "share_data_with_distributor": True,
        "share_analytics": True,
        "ai_personalization": True,
        "preferred_ai_tone": "friendly",
        "onboarding_completed": False,
        "health_goals": [],
        "interests": [],
        "allergies": [],
        "dietary_preferences": [],
    }


@router.patch("/profile-prefs")
async def update_profile_prefs(req: ProfilePrefsUpdate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    payload["updated_at"] = "now()"

    # Try update first
    rows = await _update("customer_profile_prefs", {"user_id": user_id}, payload, token=token)
    if rows:
        return rows[0]
    # If no row exists, insert with user_id
    payload["user_id"] = user_id
    row = await _insert("customer_profile_prefs", payload, token=token)
    return row or {"status": "error"}


# ---------------------------------------------------------------------------
# Module 11 — Announcements
# ---------------------------------------------------------------------------
@router.get("/announcements")
async def list_announcements(request: Request, limit: int = 10) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    import datetime
    now_iso = datetime.datetime.utcnow().isoformat()
    url = f"{SUPABASE_URL}/rest/v1/customer_announcements?select=id,title,body,category,priority,action_url,action_label,image_url,published_at&is_published=eq.true&or=(expires_at.is.null,expires_at.gt.{now_iso})&order=published_at.desc&limit={limit}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Module 10 — Knowledge Center Search
# ---------------------------------------------------------------------------
@router.post("/knowledge-search")
async def knowledge_search(req: KnowledgeSearchRequest, request: Request) -> Dict[str, Any]:
    """Search across FAQs, policies, products, training, and knowledge documents."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    q = req.query.strip()
    if not q or len(q) < 2:
        return {"results": [], "total": 0}

    # Was only assigned inside the "faq" branch below — any request whose
    # entity_types excluded "faq" (e.g. just ["product"], as the product
    # search UI sends) hit product/policy/training/document's use of
    # q_lower before it was ever set, crashing every such search with a
    # 500 UnboundLocalError. Defined once up front so every branch can use it.
    q_lower = q.lower()

    results: List[Dict[str, Any]] = []
    types = req.entity_types or ["faq", "policy", "product", "training", "document"]

    # Search FAQs
    if "faq" in types:
        faqs = await _select("faqs", "id,question,answer,category", filters={"approval_status": "approved"}, limit=200, token=token)
        for f in faqs:
            if q_lower in (f.get("question") or "").lower() or q_lower in (f.get("answer") or "").lower():
                results.append({"entity_type": "faq", "entity_id": str(f.get("id", "")), "title": f.get("question"), "snippet": (f.get("answer") or "")[:200], "category": f.get("category")})

    # Search policies
    if "policy" in types:
        policies = await _select("policies", "id,topic,content,category", filters={"approval_status": "approved"}, limit=200, token=token)
        for p in policies:
            if q_lower in (p.get("topic") or "").lower() or q_lower in (p.get("content") or "").lower():
                results.append({"entity_type": "policy", "entity_id": str(p.get("id", "")), "title": p.get("topic"), "snippet": (p.get("content") or "")[:200], "category": p.get("category")})

    # Search products
    if "product" in types:
        products = await _select("products", "id,product_name,category,benefits,ingredients,usage", filters={"approval_status": "approved"}, limit=200, token=token)
        for p in products:
            text = " ".join(str(p.get(k) or "") for k in ["product_name", "category", "benefits", "ingredients", "usage"]).lower()
            if q_lower in text:
                results.append({"entity_type": "product", "entity_id": str(p.get("id", "")), "title": p.get("product_name"), "snippet": (p.get("benefits") or "")[:200], "category": p.get("category")})

    # Search training
    if "training" in types:
        training = await _select("distributor_training", "id,title,content,category", filters={"approval_status": "approved"}, limit=200, token=token)
        for t in training:
            if q_lower in (t.get("title") or "").lower() or q_lower in (t.get("content") or "").lower():
                results.append({"entity_type": "training", "entity_id": str(t.get("id", "")), "title": t.get("title"), "snippet": (t.get("content") or "")[:200], "category": t.get("category")})

    # Search knowledge documents
    if "document" in types:
        docs = await _select("knowledge_documents", "id,file_name,extracted_text,category", filters={"approval_status": "approved"}, limit=100, token=token)
        for d in docs:
            if q_lower in (d.get("file_name") or "").lower() or q_lower in (d.get("extracted_text") or "").lower():
                results.append({"entity_type": "document", "entity_id": str(d.get("id", "")), "title": d.get("file_name"), "snippet": (d.get("extracted_text") or "")[:200], "category": d.get("category")})

    # Log search
    try:
        await _insert("knowledge_search_log", {
            "user_id": user_id, "query": q[:500],
            "entity_types": types, "result_count": len(results),
            "language": req.language,
        }, token=token)
    except Exception:
        pass

    return {"results": results[:30], "total": len(results)}


# ---------------------------------------------------------------------------
# Module 9 — Support Tickets (customer view)
# ---------------------------------------------------------------------------
@router.get("/tickets")
async def list_my_tickets(request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("support_tickets", "*", filters={"user_id": user_id}, limit=50, order="created_at.desc", token=token)


@router.get("/tickets/{ticket_id}/replies")
async def list_ticket_replies(ticket_id: str, request: Request) -> List[Dict[str, Any]]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    # Verify ownership
    tickets = await _select("support_tickets", "id", filters={"id": ticket_id, "user_id": user_id}, limit=1, token=token)
    if not tickets and not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Get non-internal replies
    url = f"{SUPABASE_URL}/rest/v1/ticket_replies?ticket_id=eq.{ticket_id}&is_internal=eq.false&select=*&order=created_at.asc&limit=100"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


@router.post("/tickets/{ticket_id}/replies")
async def add_ticket_reply(ticket_id: str, req: TicketReplyCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    # Verify ownership
    tickets = await _select("support_tickets", "id", filters={"id": ticket_id, "user_id": user_id}, limit=1, token=token)
    if not tickets:
        raise HTTPException(status_code=404, detail="Ticket not found")
    payload = {
        "ticket_id": ticket_id,
        "author_id": user_id,
        "author_role": "customer",
        "body": req.body,
        "is_internal": False,  # Customers can't post internal notes
    }
    return await _insert("ticket_replies", payload, token=token) or {"status": "error"}


@router.post("/tickets/{ticket_id}/rating")
async def rate_ticket(ticket_id: str, req: TicketRatingCreate, request: Request) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    # Verify ownership
    tickets = await _select("support_tickets", "id", filters={"id": ticket_id, "user_id": user_id}, limit=1, token=token)
    if not tickets:
        raise HTTPException(status_code=404, detail="Ticket not found")
    payload = {
        "ticket_id": ticket_id,
        "user_id": user_id,
        "rating": req.rating,
        "feedback": req.feedback,
    }
    return await _insert("ticket_ratings", payload, token=token) or {"status": "exists"}


# ---------------------------------------------------------------------------
# Module 5 — AI Recommendation Engine
# ---------------------------------------------------------------------------
@router.post("/recommendations")
async def get_recommendations(req: RecommendationRequest, request: Request) -> Dict[str, Any]:
    """Generate AI-powered personalized product recommendations."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Safety check
    rules = await load_safety_rules()
    is_blocked, rule_key = run_safety_check(req.lifestyle or "", rules)
    if is_blocked:
        raise HTTPException(status_code=400, detail=f"Blocked by safety rule: {rule_key}")

    # Build context
    context = "Customer profile for AI product recommendations:\n"
    if req.health_goals:
        context += f"Health goals: {', '.join(req.health_goals)}\n"
    if req.age:
        context += f"Age: {req.age}\n"
    if req.lifestyle:
        context += f"Lifestyle: {req.lifestyle}\n"
    if req.preferences:
        context += f"Preferences: {', '.join(req.preferences)}\n"
    if req.budget_range:
        context += f"Budget: {req.budget_range}\n"
    context += f"\nLanguage: {req.language}\n\nRecommend 3 suitable Dayjoy products. For each, explain WHY it's recommended (personalized reasoning). Include usage suggestions and precautions. Do NOT make medical claims."

    # Generate via Groq
    recommendation = ""
    try:
        if GROQ_API_KEY:
            async for tok in stream_groq(context, [], "", req.language):
                recommendation += tok
    except Exception:
        pass

    if not recommendation:
        # Fallback: return approved products
        products = await _select("products", "id,product_name,category,benefits", filters={"approval_status": "approved"}, limit=5, token=token)
        recommendation = "Based on your profile, here are some recommended products:\n\n" + "\n".join([f"• {p.get('product_name', '')} — {p.get('benefits', '')[:100]}" for p in products])

    return {"recommendation": recommendation, "context_used": context}
