"""
Reminders API — Scheduled / Proactive Assistance (Capability 33).

Scope, deliberately: client-triggered ("check for due reminders" called
by the frontend on load and periodically while the app is open — see
POST /reminders/check), NOT a server-side cron/pg_cron job. No external
actions are performed (no email/SMS) — a due reminder becomes a row in
the EXISTING `notifications` table (supabase_schema_v3.sql), which the
existing NotificationCenter UI already reads. This keeps the feature
fully within "the existing architecture" per the brief's own instruction,
without adding new production scheduling infrastructure that would need
separate operational buy-in to run unattended.

RLS (database/supabase_schema_v29_scheduled_reminders.sql, NOT auto-applied —
see that file's own header) is the second, independent enforcement layer.
Every write forces `user_id` from the server-verified caller, same
pattern as artifacts_api.py.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/reminders", tags=["reminders"])

try:
    from .main import require_user_id, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
except ImportError:  # pragma: no cover — standalone import for testing
    require_user_id = None  # type: ignore
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

RECURRENCE_VALUES = ("once", "daily", "weekly", "monthly")
_RECURRENCE_DELTA = {"daily": timedelta(days=1), "weekly": timedelta(weeks=1), "monthly": timedelta(days=30)}


def _svc_headers(token: Optional[str] = None, json_body: bool = False) -> Dict[str, str]:
    h: Dict[str, str] = {"apikey": SUPABASE_ANON_KEY}
    if json_body:
        h["Content-Type"] = "application/json"
    if SUPABASE_SERVICE_ROLE_KEY:
        h["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    elif token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def _select(table: str, columns: str = "*", filters: Optional[Dict[str, Any]] = None,
                   limit: int = 100, order: Optional[str] = None, token: Optional[str] = None) -> List[Dict[str, Any]]:
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
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=_svc_headers(token))
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


async def _insert(table: str, payload: Dict[str, Any], token: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*"
    headers = _svc_headers(token, json_body=True)
    headers["Prefer"] = "return=representation"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                return None
            data = resp.json()
            return data[0] if isinstance(data, list) and data else None
    except Exception:
        return None


async def _update(table: str, row_id: str, payload: Dict[str, Any], token: Optional[str] = None) -> bool:
    if not SUPABASE_URL:
        return False
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}"
    headers = _svc_headers(token, json_body=True)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(url, headers=headers, json=payload)
            return resp.status_code < 400
    except Exception:
        return False


async def _delete(table: str, row_id: str, user_id: str, token: Optional[str] = None) -> bool:
    if not SUPABASE_URL:
        return False
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}&user_id=eq.{user_id}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(url, headers=headers)
            return resp.status_code < 400
    except Exception:
        return False


class ReminderCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: Optional[str] = Field(default=None, max_length=1000)
    due_at: str  # ISO 8601
    recurrence: str = Field(default="once", description=f"One of {RECURRENCE_VALUES}")
    conversation_id: Optional[str] = None
    artifact_id: Optional[str] = None


def _validate_recurrence(recurrence: str) -> None:
    if recurrence not in RECURRENCE_VALUES:
        raise HTTPException(status_code=400, detail=f"recurrence must be one of {RECURRENCE_VALUES}")


@router.post("")
async def create_reminder(req: ReminderCreate, request: Request) -> Dict[str, Any]:
    """Feature: Scheduled Summaries / Follow-up Tasks / Reminders."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    _validate_recurrence(req.recurrence)

    payload = {
        "user_id": user_id,
        "title": req.title,
        "body": req.body,
        "due_at": req.due_at,
        "recurrence": req.recurrence,
        "conversation_id": req.conversation_id,
        "artifact_id": req.artifact_id,
        "is_active": True,
    }
    row = await _insert("scheduled_reminders", payload, token=token)
    if row is None:
        raise HTTPException(status_code=502, detail="Failed to save reminder")
    return row


@router.get("")
async def list_reminders(request: Request, include_inactive: bool = False) -> Dict[str, Any]:
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters: Dict[str, Any] = {"user_id": user_id}
    if not include_inactive:
        filters["is_active"] = "true"
    rows = await _select("scheduled_reminders", filters=filters, order="due_at.asc", token=token)
    return {"reminders": rows, "total": len(rows)}


@router.delete("/{reminder_id}")
async def cancel_reminder(reminder_id: str, request: Request) -> Dict[str, Any]:
    """Cancels (soft-deletes via is_active=false) rather than hard-deleting
    — keeps history for "what reminders did I have" without a separate
    audit table."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _update("scheduled_reminders", reminder_id, {"is_active": False}, token=token)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to cancel reminder")
    return {"cancelled": True}


@router.post("/check")
async def check_due_reminders(request: Request) -> Dict[str, Any]:
    """Client-triggered due-reminder check (called on app load / while
    active — see module docstring for why this isn't a server cron job).
    Scoped to the CALLING user's own reminders only. Delivers each due
    reminder as a row in the existing `notifications` table; recurring
    reminders get their due_at advanced instead of being deactivated."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    rows = await _select("scheduled_reminders", filters={"user_id": user_id, "is_active": "true"}, limit=200, token=token)
    now = datetime.now(timezone.utc)
    delivered: List[Dict[str, Any]] = []

    for r in rows:
        due_at_raw = r.get("due_at")
        if not due_at_raw:
            continue
        try:
            due_at = datetime.fromisoformat(str(due_at_raw).replace("Z", "+00:00"))
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        if due_at > now:
            continue

        await _insert(
            "notifications",
            {
                "user_id": user_id,
                "type": "system",
                "title": r["title"],
                "body": r.get("body"),
                "link": (
                    f"/chat/{r['conversation_id']}" if r.get("conversation_id")
                    else ("/saved" if r.get("artifact_id") else None)
                ),
            },
            token=token,
        )
        delivered.append({"id": r["id"], "title": r["title"]})

        recurrence = r.get("recurrence", "once")
        if recurrence == "once":
            await _update("scheduled_reminders", r["id"], {"is_active": False, "last_delivered_at": now.isoformat()}, token=token)
        else:
            next_due = due_at + _RECURRENCE_DELTA.get(recurrence, timedelta(days=1))
            # If the app was closed for a while, don't fire the same
            # recurring reminder repeatedly for every missed interval —
            # jump straight to the next interval AFTER now.
            while next_due <= now:
                next_due += _RECURRENCE_DELTA.get(recurrence, timedelta(days=1))
            await _update(
                "scheduled_reminders", r["id"],
                {"due_at": next_due.isoformat(), "last_delivered_at": now.isoformat()},
                token=token,
            )

    return {"delivered": delivered, "count": len(delivered)}
