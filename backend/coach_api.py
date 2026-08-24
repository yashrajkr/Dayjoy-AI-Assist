"""
Persistent AI Coach + Goal -> Plan -> Execute API (Next-Generation spec,
Phases 5 and 13).

Goal -> Plan -> Tasks -> Progress -> Review -> Adaptation, all persisted
across sessions (unlike orchestrator/user_goal.py's per-message,
never-persisted goal PROFILE — that's an internal signal for how to
answer one question; this is a durable object the user creates, works,
and returns to). Follows reminders_api.py's exact conventions: same
_svc_headers/_select/_insert/_update helper shape, same "server always
forces user_id from the verified caller" pattern, same "schema file
exists but isn't auto-applied" convention
(database/supabase_schema_v30_ai_coach.sql).

`backend.main` is imported LAZILY inside `_cfg()` below, not at module
level — a real bug was found and fixed here during testing: a module-level
`from .main import require_user_id, SUPABASE_URL, ...` (the pattern
reminders_api.py already uses) is only safe when something ELSE imports
backend.main first. If this module is imported before backend.main has
started loading (e.g. a test importing `backend.coach_api` directly, or
any future tool doing the same), Python's circular-import reentrancy means
backend.main's own `app.include_router(coach_router)` call fires against
this module's `router` object BEFORE any of the `@router.*` decorators
below have executed — so `include_router` snapshots an EMPTY route list,
and every /coach/* endpoint silently 404s despite importing without error.
Lazy import avoids the reentrancy trigger entirely: nothing in this file
touches backend.main until a request actually arrives, by which point
backend.main (the real ASGI entrypoint) is always the one already fully
loaded.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/coach", tags=["coach"])

from backend.orchestrator.coach_planner import generate_plan  # noqa: E402


@dataclass
class _Cfg:
    require_user_id: Any
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str


def _cfg() -> _Cfg:
    import backend.main as backend_main  # lazy — see module docstring for why

    return _Cfg(
        require_user_id=backend_main.require_user_id,
        supabase_url=backend_main.SUPABASE_URL,
        supabase_anon_key=backend_main.SUPABASE_ANON_KEY,
        supabase_service_role_key=backend_main.SUPABASE_SERVICE_ROLE_KEY,
    )


def _svc_headers(cfg: _Cfg, token: Optional[str] = None, json_body: bool = False) -> Dict[str, str]:
    h: Dict[str, str] = {"apikey": cfg.supabase_anon_key}
    if json_body:
        h["Content-Type"] = "application/json"
    if cfg.supabase_service_role_key:
        h["Authorization"] = f"Bearer {cfg.supabase_service_role_key}"
    elif token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def _select(cfg: _Cfg, table: str, columns: str = "*", filters: Optional[Dict[str, Any]] = None,
                   limit: int = 200, order: Optional[str] = None, token: Optional[str] = None) -> List[Dict[str, Any]]:
    if not cfg.supabase_url:
        return []
    url = f"{cfg.supabase_url}/rest/v1/{table}?select={columns}&limit={limit}"
    if filters:
        for col, val in filters.items():
            if val is None:
                continue
            url += f"&{col}=eq.{val}"
    if order:
        url += f"&order={order}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=_svc_headers(cfg, token))
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


async def _insert(cfg: _Cfg, table: str, payload: Dict[str, Any], token: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if not cfg.supabase_url:
        return None
    url = f"{cfg.supabase_url}/rest/v1/{table}?select=*"
    headers = _svc_headers(cfg, token, json_body=True)
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


async def _insert_many(cfg: _Cfg, table: str, rows: List[Dict[str, Any]], token: Optional[str] = None) -> List[Dict[str, Any]]:
    if not cfg.supabase_url or not rows:
        return []
    url = f"{cfg.supabase_url}/rest/v1/{table}?select=*"
    headers = _svc_headers(cfg, token, json_body=True)
    headers["Prefer"] = "return=representation"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=rows)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


async def _update(cfg: _Cfg, table: str, row_id: str, payload: Dict[str, Any], user_id: str, token: Optional[str] = None) -> bool:
    if not cfg.supabase_url:
        return False
    url = f"{cfg.supabase_url}/rest/v1/{table}?id=eq.{row_id}&user_id=eq.{user_id}"
    headers = _svc_headers(cfg, token, json_body=True)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(url, headers=headers, json=payload)
            return resp.status_code < 400
    except Exception:
        return False


class GoalCreate(BaseModel):
    goal_text: str = Field(..., min_length=1, max_length=500)


class GoalUpdate(BaseModel):
    goal_text: Optional[str] = Field(default=None, max_length=500)
    status: Optional[str] = Field(default=None, description="active | completed | abandoned")


GOAL_STATUSES = ("active", "completed", "abandoned")


async def _goal_with_tasks(cfg: _Cfg, goal: Dict[str, Any], token: Optional[str]) -> Dict[str, Any]:
    tasks = await _select(
        cfg, "ai_coach_tasks", filters={"goal_id": goal["id"]}, order="sort_order.asc", token=token,
    )
    return {**goal, "tasks": tasks}


@router.post("/goals")
async def create_goal(req: GoalCreate, request: Request) -> Dict[str, Any]:
    """Goal -> Plan: creates the goal, then generates and persists an
    ordered task plan for it in the same call — the user always gets a
    plan back immediately, never an empty goal to fill in themselves."""
    cfg = _cfg()
    user_id = await cfg.require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    goal = await _insert(cfg, "ai_coach_goals", {"user_id": user_id, "goal_text": req.goal_text}, token=token)
    if goal is None:
        raise HTTPException(status_code=502, detail="Failed to save goal")

    plan = await generate_plan(req.goal_text)
    task_rows = [
        {
            "goal_id": goal["id"], "user_id": user_id,
            "task_text": t.task_text, "day_label": t.day_label, "sort_order": i,
        }
        for i, t in enumerate(plan)
    ]
    tasks = await _insert_many(cfg, "ai_coach_tasks", task_rows, token=token)
    return {**goal, "tasks": tasks}


@router.get("/goals")
async def list_goals(request: Request, include_inactive: bool = False) -> Dict[str, Any]:
    cfg = _cfg()
    user_id = await cfg.require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters: Dict[str, Any] = {"user_id": user_id}
    if not include_inactive:
        filters["status"] = "active"
    goals = await _select(cfg, "ai_coach_goals", filters=filters, order="created_at.desc", token=token)
    goals_with_tasks = [await _goal_with_tasks(cfg, g, token) for g in goals]
    return {"goals": goals_with_tasks, "total": len(goals_with_tasks)}


@router.get("/goals/{goal_id}")
async def get_goal(goal_id: str, request: Request) -> Dict[str, Any]:
    """Also serves "Continue my plan" / "What should I do today?" — the
    client derives next-up tasks from the returned task list's pending
    items in sort_order, no separate endpoint needed for that."""
    cfg = _cfg()
    user_id = await cfg.require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _select(cfg, "ai_coach_goals", filters={"id": goal_id, "user_id": user_id}, limit=1, token=token)
    if not rows:
        raise HTTPException(status_code=404, detail="Goal not found")
    return await _goal_with_tasks(cfg, rows[0], token)


@router.patch("/goals/{goal_id}")
async def update_goal(goal_id: str, req: GoalUpdate, request: Request) -> Dict[str, Any]:
    """Adaptation: update the goal's text or status (e.g. mark completed
    or abandoned)."""
    cfg = _cfg()
    user_id = await cfg.require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    if req.status is not None and req.status not in GOAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {GOAL_STATUSES}")
    payload: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if req.goal_text is not None:
        payload["goal_text"] = req.goal_text
    if req.status is not None:
        payload["status"] = req.status
    ok = await _update(cfg, "ai_coach_goals", goal_id, payload, user_id, token=token)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to update goal")
    return {"updated": True}


@router.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, request: Request) -> Dict[str, Any]:
    """Progress: marks one task done. Review is computed client-side from
    the task list's done/pending counts — no separate "review" object to
    keep in sync."""
    cfg = _cfg()
    user_id = await cfg.require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _update(
        cfg, "ai_coach_tasks", task_id,
        {"status": "done", "completed_at": datetime.now(timezone.utc).isoformat()},
        user_id, token=token,
    )
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to update task")
    return {"completed": True}


@router.post("/tasks/{task_id}/reopen")
async def reopen_task(task_id: str, request: Request) -> Dict[str, Any]:
    cfg = _cfg()
    user_id = await cfg.require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _update(cfg, "ai_coach_tasks", task_id, {"status": "pending", "completed_at": None}, user_id, token=token)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to update task")
    return {"reopened": True}
