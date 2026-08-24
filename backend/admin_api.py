"""
Admin Console API endpoints for Dayjoy AI Assist.

Adds the Phase 2 enterprise admin routes:
  - /admin/stats              — executive dashboard KPIs
  - /admin/search             — universal search across entities
  - /admin/ai-config          — get/update AI configuration
  - /admin/safety-rules       — get/update safety rules
  - /admin/roles/permissions  — RBAC matrix get/update
  - /admin/users              — list/create/update/suspend/reset-password
  - /admin/products           — CRUD + archive + bulk
  - /admin/faqs               — CRUD + approve + bulk
  - /admin/training/courses   — CRUD + modules + lessons + quizzes
  - /admin/support/tickets    — list/assign/escalate/resolve + notes + attachments
  - /admin/analytics          — real-time metrics
  - /admin/audit              — filtered audit log
  - /admin/notifications      — list/create/broadcast
  - /admin/org-settings       — get/update organization settings
  - /admin/api-keys           — manage admin API keys

All endpoints require staff JWT; most require admin role. Authorization
is enforced both here (role check) and via Supabase RLS.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import time
import uuid
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, Depends
from pydantic import BaseModel, Field

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Config (re-reads from env so this module is self-contained)
# ---------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

# Reuse helpers from main module
try:
    from .main import (
        verify_jwt,
        get_user_id,
        _is_staff,
        _require_staff,
        _require_rag,
        RAG_AVAILABLE,
    )
except ImportError:
    # Allow standalone import for testing
    verify_jwt = None  # type: ignore
    get_user_id = None  # type: ignore
    _is_staff = None  # type: ignore
    _require_staff = None  # type: ignore
    _require_rag = None  # type: ignore
    RAG_AVAILABLE = False


def _svc_headers(token: Optional[str] = None, json_body: bool = False) -> Dict[str, str]:
    h = {"apikey": SUPABASE_ANON_KEY}
    if json_body:
        h["Content-Type"] = "application/json"
    if SUPABASE_SERVICE_ROLE_KEY:
        h["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    elif token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _prefer_headers(token: Optional[str] = None, json_body: bool = True) -> Dict[str, str]:
    h = _svc_headers(token=token, json_body=json_body)
    h["Prefer"] = "return=representation"
    return h


async def _count(table: str, filter_str: str = "", token: Optional[str] = None) -> int:
    """Count rows in a table via PostgREST Content-Range header."""
    if not SUPABASE_URL:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=none{filter_str}"
    headers = {**_svc_headers(token), "Prefer": "count=exact"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            rng = resp.headers.get("Content-Range", "0-0/0")
            return int(rng.split("/")[-1]) if "/" in rng else 0
    except Exception:
        return 0


async def _select_view(view_name: str, columns: str = "*", limit: int = 100, token: Optional[str] = None) -> List[Dict[str, Any]]:
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{view_name}?select={columns}&limit={limit}"
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
# Models
# ---------------------------------------------------------------------------
class AIConfigUpdate(BaseModel):
    groq_model: Optional[str] = None
    openai_model: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(None, ge=100, le=8000)
    streaming_enabled: Optional[bool] = None
    system_prompt: Optional[str] = None
    fallback_message: Optional[str] = None
    confidence_floor: Optional[float] = Field(None, ge=0.0, le=1.0)
    handoff_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    top_k: Optional[int] = Field(None, ge=1, le=20)
    min_similarity: Optional[float] = Field(None, ge=0.0, le=1.0)
    memory_enabled: Optional[bool] = None
    max_history_turns: Optional[int] = Field(None, ge=0, le=20)
    supported_languages: Optional[List[str]] = None
    default_language: Optional[str] = None


class RolePermissionUpdate(BaseModel):
    role: str
    page: str
    action: str
    allowed: bool


class BulkRolePermissionUpdate(BaseModel):
    permissions: List[RolePermissionUpdate]


class UserCreate(BaseModel):
    email: str
    password: str
    full_name: str
    role: str = "customer"
    language: Optional[str] = None
    region: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    language: Optional[str] = None
    region: Optional[str] = None
    is_suspended: Optional[bool] = None


class ProductCreate(BaseModel):
    product_name: str
    sku: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    benefits: Optional[str] = None
    ingredients: Optional[str] = None
    usage: Optional[str] = None
    warnings: Optional[str] = None
    safety_note: Optional[str] = None
    faqs_json: Optional[Dict[str, Any]] = None
    approval_status: str = "pending"


class ProductUpdate(BaseModel):
    product_name: Optional[str] = None
    sku: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    benefits: Optional[str] = None
    ingredients: Optional[str] = None
    usage: Optional[str] = None
    warnings: Optional[str] = None
    safety_note: Optional[str] = None
    faqs_json: Optional[Dict[str, Any]] = None
    approval_status: Optional[str] = None
    is_archived: Optional[bool] = None


class ProductImageCreate(BaseModel):
    image_url: str
    alt_text: Optional[str] = None
    is_primary: bool = False
    display_order: int = 0


class ProductImageUpdate(BaseModel):
    alt_text: Optional[str] = None
    is_primary: Optional[bool] = None
    display_order: Optional[int] = None


class FAQCreate(BaseModel):
    question: str
    answer: str
    category: Optional[str] = None
    approval_status: str = "pending"


class FAQUpdate(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    category: Optional[str] = None
    approval_status: Optional[str] = None


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    issue_category: Optional[str] = None
    escalated: Optional[bool] = None
    resolution_notes: Optional[str] = None


class TicketNoteCreate(BaseModel):
    note: str
    is_internal: bool = True


class NotificationCreate(BaseModel):
    title: str
    body: str
    category: str = "system"
    target_role: Optional[str] = None  # null = broadcast
    target_user_id: Optional[str] = None
    channels: List[str] = Field(default_factory=lambda: ["in_app"])


class OrgSettingsUpdate(BaseModel):
    company_name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None
    support_email: Optional[str] = None
    support_phone: Optional[str] = None
    default_language: Optional[str] = None
    enabled_languages: Optional[List[str]] = None
    storage_quota_mb: Optional[int] = None
    password_min_length: Optional[int] = None
    session_timeout_minutes: Optional[int] = None


class APIKeyCreate(BaseModel):
    name: str
    scopes: List[str] = Field(default_factory=lambda: ["read"])
    expires_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Module 1 — Executive dashboard stats
# ---------------------------------------------------------------------------
@router.get("/stats")
async def admin_stats(request: Request) -> Dict[str, Any]:
    """Executive KPI dashboard."""
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Run counts in parallel-ish (sequentially since we don't have asyncio.gather here)
    total_users = await _count("profiles", token=token)
    active_users_7d = await _count("profiles", "&last_seen_at=gte." + _days_ago(7), token=token) if await _has_column("profiles", "last_seen_at") else total_users
    chats_today = await _count("chat_conversations", "&created_at=gte." + _today_start(), token=token)
    total_products = await _count("products", "&is_archived=eq.false", token=token) if await _has_column("products", "is_archived") else await _count("products", token=token)
    total_documents = await _count("knowledge_documents", "&is_archived=eq.false", token=token) if await _has_column("knowledge_documents", "is_archived") else await _count("knowledge_documents", token=token)
    total_chunks = await _count("knowledge_chunks", token=token)
    pending_tickets = await _count("support_tickets", "&status=neq.closed", token=token)
    pending_approvals_docs = await _count("knowledge_documents", "&approval_status=eq.pending", token=token)
    pending_approvals_products = await _count("products", "&approval_status=eq.pending", token=token)
    pending_approvals_faqs = await _count("faqs", "&approval_status=eq.pending", token=token)

    # AI stats from rag_queries (if available) or analytics
    failed_queries = await _count("rag_queries", "&verification_status=eq.unverified", token=token) if RAG_AVAILABLE else 0
    total_rag_queries = await _count("rag_queries", token=token) if RAG_AVAILABLE else 0
    escalations = await _count("support_tickets", "&issue_category=eq.unverified_answer", token=token)
    ai_accuracy = round((1 - (failed_queries / total_rag_queries)) * 100, 1) if total_rag_queries > 0 else None

    # Top products / questions
    top_products = await _select_view("product_view_stats", columns="product_name,category,view_count", limit=10, token=token)
    top_questions = await _select_view("top_questions", columns="question,ask_count,last_asked", limit=10, token=token)

    # Training completion
    training_stats = await _select_view("training_completion_stats", limit=10, token=token)
    avg_completion = (
        round(sum(t.get("completion_pct") or 0 for t in training_stats) / len(training_stats), 1)
        if training_stats else 0
    )

    return {
        "users": {
            "total": total_users,
            "active_7d": active_users_7d,
        },
        "ai": {
            "conversations_today": chats_today,
            "total_rag_queries": total_rag_queries,
            "failed_queries": failed_queries,
            "accuracy_pct": ai_accuracy,
            "escalations": escalations,
            "avg_response_time_ms": None,  # requires timing instrumentation
        },
        "knowledge": {
            "total_products": total_products,
            "total_documents": total_documents,
            "total_chunks": total_chunks,
            "pending_approvals": pending_approvals_docs + pending_approvals_products + pending_approvals_faqs,
        },
        "support": {
            "pending_tickets": pending_tickets,
        },
        "training": {
            "avg_completion_pct": avg_completion,
            "course_count": len(training_stats),
        },
        "top_products": top_products,
        "top_questions": top_questions,
    }


def _today_start() -> str:
    import datetime
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT00:00:00")


def _days_ago(days: int) -> str:
    import datetime
    return (datetime.datetime.utcnow() - datetime.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")


async def _has_column(table: str, column: str) -> bool:
    """Best-effort check: just try a select with that column."""
    if not SUPABASE_URL:
        return False
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={column}&limit=0"
    headers = _svc_headers()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, headers=headers)
            return resp.status_code < 400
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Module 13 — Universal search
# ---------------------------------------------------------------------------
@router.get("/search")
async def admin_universal_search(
    request: Request,
    q: str = "",
    entity_type: Optional[str] = None,
    limit: int = 20,
) -> Dict[str, Any]:
    """Search across users, products, documents, FAQs, training, tickets, courses."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    if not q or len(q) < 2:
        return {"results": [], "total": 0, "query": q}

    # Try the materialized view first
    results: List[Dict[str, Any]] = []
    try:
        results = await _select_view(
            "admin_search_index",
            columns="entity_id,entity_type,title,subtitle,metadata,created_at",
            limit=limit * 3,
            token=token,
        )
    except Exception:
        results = []

    # Filter by query and optional entity_type
    q_lower = q.lower()
    filtered = [
        r for r in results
        if (r.get("title") or "").lower().find(q_lower) >= 0
        or (r.get("subtitle") or "").lower().find(q_lower) >= 0
    ]
    if entity_type:
        filtered = [r for r in filtered if r.get("entity_type") == entity_type]

    return {
        "results": filtered[:limit],
        "total": len(filtered),
        "query": q,
    }


# ---------------------------------------------------------------------------
# Module 9 — AI Configuration
# ---------------------------------------------------------------------------
@router.get("/ai-config")
async def get_ai_config(request: Request) -> Dict[str, Any]:
    """Get the current AI configuration (single row)."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    if not SUPABASE_URL:
        return _default_ai_config()
    url = f"{SUPABASE_URL}/rest/v1/ai_configuration?select=*&limit=1"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return _default_ai_config()
            data = resp.json()
            return data[0] if data else _default_ai_config()
    except Exception:
        return _default_ai_config()


def _default_ai_config() -> Dict[str, Any]:
    return {
        "groq_model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "openai_model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "temperature": 0.20,
        "max_tokens": 800,
        "streaming_enabled": True,
        "system_prompt": "You are Dayjoy AI Assist...",
        "fallback_message": "I don't have enough approved information to answer that safely.",
        "confidence_floor": 0.55,
        "handoff_threshold": 0.40,
        "top_k": 5,
        "min_similarity": 0.20,
        "memory_enabled": True,
        "max_history_turns": 6,
        "supported_languages": ["en", "hi"],
        "default_language": "en",
    }


@router.patch("/ai-config")
async def update_ai_config(req: AIConfigUpdate, request: Request) -> Dict[str, Any]:
    """Update AI configuration. Admin only."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    payload["updated_by"] = user_id
    payload["updated_at"] = "now()"

    if not SUPABASE_URL:
        return {"status": "noop", "config": payload}

    url = f"{SUPABASE_URL}/rest/v1/ai_configuration?id=neq.00000000-0000-0000-0000-000000000000&select=*"
    headers = _prefer_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
            data = resp.json()
            # Log audit
            await _log_audit(token, user_id, "AI_CONFIG_CHANGE", "ai_configuration", None, payload)
            return {"config": data[0] if data else payload}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Module 9 — Safety rules
# ---------------------------------------------------------------------------
@router.get("/safety-rules")
async def get_safety_rules(request: Request) -> List[Dict[str, Any]]:
    """Get all safety rules."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/safety_rules?select=*&order=rule_key.asc&limit=100"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


@router.patch("/safety-rules/{rule_id}")
async def update_safety_rule(rule_id: str, payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    """Update a safety rule. Admin only."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    if not SUPABASE_URL:
        return {"status": "noop"}

    url = f"{SUPABASE_URL}/rest/v1/safety_rules?id=eq.{rule_id}&select=*"
    headers = _prefer_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
            await _log_audit(token, user_id, "SAFETY_RULE_CHANGE", "safety_rules", rule_id, payload)
            data = resp.json()
            return {"rule": data[0] if data else None}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Module 3 — RBAC permissions
# ---------------------------------------------------------------------------
@router.get("/roles/permissions")
async def get_role_permissions(request: Request) -> List[Dict[str, Any]]:
    """Get all role permissions (RBAC matrix)."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/role_permissions?select=*&order=role.asc,page.asc,action.asc&limit=500"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


@router.put("/roles/permissions")
async def update_role_permissions(req: BulkRolePermissionUpdate, request: Request) -> Dict[str, Any]:
    """Bulk update role permissions. Admin only."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    if not SUPABASE_URL:
        return {"status": "noop", "updated": 0}

    updated = 0
    for p in req.permissions:
        # Upsert: try update, then insert
        url = f"{SUPABASE_URL}/rest/v1/role_permissions?role=eq.{p.role}&page=eq.{p.page}&action=eq.{p.action}&select=*"
        headers = _prefer_headers(token)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Try update first
                resp = await client.patch(
                    url,
                    headers=headers,
                    json={"allowed": p.allowed, "updated_at": "now()"},
                )
                if resp.status_code < 400:
                    data = resp.json()
                    if not data:
                        # No row exists → insert
                        resp = await client.post(
                            f"{SUPABASE_URL}/rest/v1/role_permissions?select=*",
                            headers=headers,
                            json={
                                "role": p.role,
                                "page": p.page,
                                "action": p.action,
                                "allowed": p.allowed,
                            },
                        )
                updated += 1
        except Exception:
            pass

    await _log_audit(token, user_id, "ROLE_PERMISSION_CHANGE", "role_permissions", None, {"count": updated})
    return {"status": "ok", "updated": updated}


# ---------------------------------------------------------------------------
# Module 2 — User management
# ---------------------------------------------------------------------------
@router.get("/users")
async def admin_list_users(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: Optional[str] = None,
    role: Optional[str] = None,
) -> Dict[str, Any]:
    """List users with filters + pagination."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    url = f"{SUPABASE_URL}/rest/v1/profiles?select=*&order=created_at.desc&limit={limit}&offset={offset}"
    if role:
        url += f"&role=eq.{role}"
    if search:
        url += f"&full_name=ilike.*{search}*"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Failed: {resp.text}")
        rows = resp.json()
    total = len(rows)
    rng = resp.headers.get("Content-Range", "")
    if "/" in rng:
        try:
            total = int(rng.split("/")[-1])
        except ValueError:
            pass
    return {"users": rows, "total": total, "limit": limit, "offset": offset}


@router.patch("/users/{user_id}")
async def admin_update_user(user_id: str, req: UserUpdate, request: Request) -> Dict[str, Any]:
    """Update a user's profile (role, name, language, region, suspend)."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id_actor = claims.get("sub")

    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    if not payload:
        return {"status": "noop"}

    url = f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{user_id}&select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
        data = resp.json()
    if req.role:
        await _log_audit(token, user_id_actor, "USER_ROLE_CHANGE", "profiles", user_id, {"new_role": req.role})
    return {"user": data[0] if data else None}


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, request: Request) -> Dict[str, Any]:
    """Trigger a password reset email for a user. Admin only."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id_actor = claims.get("sub")

    # We need the user's email — fetch from profiles
    url = f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{user_id}&select=id"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=504, detail="User not found")

    # Use Supabase Auth admin API to send reset email
    auth_url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}/password_reset"
    auth_headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY or token}",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(auth_url, headers=auth_headers)
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Reset failed: {resp.text}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    await _log_audit(token, user_id_actor, "USER_RESET_PASSWORD", "profiles", user_id, {})
    return {"status": "reset_email_sent"}


@router.post("/users/export")
async def admin_export_users(request: Request, role: Optional[str] = None) -> Dict[str, Any]:
    """Export users as CSV. Admin only."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    url = f"{SUPABASE_URL}/rest/v1/profiles?select=id,full_name,role,language,region,created_at&limit=10000"
    if role:
        url += f"&role=eq.{role}"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Export failed: {resp.text}")
        users = resp.json()

    # Build CSV
    import csv
    import io
    output = io.StringIO()
    if users:
        writer = csv.DictWriter(output, fieldnames=users[0].keys())
        writer.writeheader()
        writer.writerows(users)
    return {"csv": output.getvalue(), "count": len(users)}


# ---------------------------------------------------------------------------
# Module 5 — Product CRUD
# ---------------------------------------------------------------------------
@router.post("/products")
async def admin_create_product(req: ProductCreate, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = req.model_dump()
    payload["created_by"] = user_id
    if not SUPABASE_URL:
        return {"status": "noop", "product": payload}
    url = f"{SUPABASE_URL}/rest/v1/products?select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Create failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "PRODUCT_CREATE", "products", data[0].get("id") if data else None, payload)
    return {"product": data[0] if data else None}


@router.patch("/products/{product_id}")
async def admin_update_product(product_id: str, req: ProductUpdate, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    if not payload:
        return {"status": "noop"}
    url = f"{SUPABASE_URL}/rest/v1/products?id=eq.{product_id}&select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "PRODUCT_UPDATE", "products", product_id, payload)
    return {"product": data[0] if data else None}


@router.delete("/products/{product_id}")
async def admin_delete_product(product_id: str, request: Request) -> Dict[str, Any]:
    """Hard delete a product. Admin only."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    url = f"{SUPABASE_URL}/rest/v1/products?id=eq.{product_id}"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.delete(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Delete failed: {resp.text}")
    await _log_audit(token, user_id, "PRODUCT_DELETE", "products", product_id, {})
    return {"status": "deleted", "product_id": product_id}


# ---------------------------------------------------------------------------
# Module 5b — Product images (the approved-media source for both Product
# Discovery and the chat Product Visual Intelligence cards — see
# backend/orchestrator/tools/product_media.py). Product Discovery and chat
# have read this table since it was added in schema v7, but until now there
# was no admin surface to actually populate it — every product photo had to
# be inserted by hand via SQL. Audited via `PRODUCT_UPDATE` (no dedicated
# audit action exists for image rows; treated as part of updating the
# product's media, consistent with the existing check constraint).
# ---------------------------------------------------------------------------
@router.post("/products/{product_id}/images")
async def admin_create_product_image(product_id: str, req: ProductImageCreate, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = req.model_dump()
    payload["product_id"] = product_id
    if not SUPABASE_URL:
        return {"status": "noop", "image": payload}
    url = f"{SUPABASE_URL}/rest/v1/product_images?select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Create image failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "PRODUCT_UPDATE", "product_images", data[0].get("id") if data else None, payload)
    return {"image": data[0] if data else None}


@router.patch("/products/{product_id}/images/{image_id}")
async def admin_update_product_image(
    product_id: str, image_id: str, req: ProductImageUpdate, request: Request
) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    if not payload:
        return {"status": "noop"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        if payload.get("is_primary") is True:
            # Exactly one primary per product — see setProductImagePrimary()
            # in src/app/lib/db.ts for why a stale second primary row is a
            # real bug, not a harmless duplicate.
            clear_url = f"{SUPABASE_URL}/rest/v1/product_images?product_id=eq.{product_id}"
            await client.patch(clear_url, headers=_svc_headers(token, json_body=True), json={"is_primary": False})
        url = f"{SUPABASE_URL}/rest/v1/product_images?id=eq.{image_id}&product_id=eq.{product_id}&select=*"
        resp = await client.patch(url, headers=_prefer_headers(token), json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Update image failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "PRODUCT_UPDATE", "product_images", image_id, payload)
    return {"image": data[0] if data else None}


@router.delete("/products/{product_id}/images/{image_id}")
async def admin_delete_product_image(product_id: str, image_id: str, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    url = f"{SUPABASE_URL}/rest/v1/product_images?id=eq.{image_id}&product_id=eq.{product_id}"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.delete(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Delete image failed: {resp.text}")
    await _log_audit(token, user_id, "PRODUCT_UPDATE", "product_images", image_id, {"deleted": True})
    return {"status": "deleted", "image_id": image_id}


# ---------------------------------------------------------------------------
# Module 6 — FAQ CRUD
# ---------------------------------------------------------------------------
@router.post("/faqs")
async def admin_create_faq(req: FAQCreate, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = req.model_dump()
    payload["created_by"] = user_id
    url = f"{SUPABASE_URL}/rest/v1/faqs?select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Create failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "FAQ_CREATE", "faqs", data[0].get("id") if data else None, payload)
    return {"faq": data[0] if data else None}


@router.patch("/faqs/{faq_id}")
async def admin_update_faq(faq_id: str, req: FAQUpdate, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    if not payload:
        return {"status": "noop"}
    url = f"{SUPABASE_URL}/rest/v1/faqs?id=eq.{faq_id}&select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "FAQ_UPDATE", "faqs", faq_id, payload)
    return {"faq": data[0] if data else None}


@router.delete("/faqs/{faq_id}")
async def admin_delete_faq(faq_id: str, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    url = f"{SUPABASE_URL}/rest/v1/faqs?id=eq.{faq_id}"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.delete(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Delete failed: {resp.text}")
    await _log_audit(token, user_id, "FAQ_DELETE", "faqs", faq_id, {})
    return {"status": "deleted", "faq_id": faq_id}


# ---------------------------------------------------------------------------
# Module 7 — Training courses
# ---------------------------------------------------------------------------
@router.get("/training/courses")
async def admin_list_courses(request: Request, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/training_courses?select=*&order=created_at.desc&limit={limit}&offset={offset}"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            return {"courses": [], "total": 0, "limit": limit, "offset": offset}
        rows = resp.json()
    total = len(rows)
    rng = resp.headers.get("Content-Range", "")
    if "/" in rng:
        try:
            total = int(rng.split("/")[-1])
        except ValueError:
            pass
    return {"courses": rows, "total": total, "limit": limit, "offset": offset}


@router.post("/training/courses")
async def admin_create_course(payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")
    payload["created_by"] = user_id
    url = f"{SUPABASE_URL}/rest/v1/training_courses?select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Create failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "TRAINING_CREATE", "training_courses", data[0].get("id") if data else None, payload)
    return {"course": data[0] if data else None}


@router.patch("/training/courses/{course_id}")
async def admin_update_course(course_id: str, payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")
    url = f"{SUPABASE_URL}/rest/v1/training_courses?id=eq.{course_id}&select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "TRAINING_UPDATE", "training_courses", course_id, payload)
    return {"course": data[0] if data else None}


@router.delete("/training/courses/{course_id}")
async def admin_delete_course(course_id: str, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")
    url = f"{SUPABASE_URL}/rest/v1/training_courses?id=eq.{course_id}"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.delete(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Delete failed: {resp.text}")
    await _log_audit(token, user_id, "TRAINING_DELETE", "training_courses", course_id, {})
    return {"status": "deleted", "course_id": course_id}


# ---------------------------------------------------------------------------
# Module 8 — Support ticket management
# ---------------------------------------------------------------------------
@router.patch("/support/tickets/{ticket_id}")
async def admin_update_ticket(ticket_id: str, req: TicketUpdate, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    if not payload:
        return {"status": "noop"}

    # Track escalation / resolution timestamps
    if req.escalated is True:
        payload["escalated_at"] = "now()"
        payload["escalated_by"] = user_id
    if req.status == "resolved" or req.status == "closed":
        payload["resolved_at"] = "now()"

    url = f"{SUPABASE_URL}/rest/v1/support_tickets?id=eq.{ticket_id}&select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
        data = resp.json()

    # Audit log
    if req.assigned_to:
        await _log_audit(token, user_id, "SUPPORT_TICKET_ASSIGN", "support_tickets", ticket_id, {"assigned_to": req.assigned_to})
    if req.escalated is True:
        await _log_audit(token, user_id, "SUPPORT_TICKET_ESCALATE", "support_tickets", ticket_id, {})
    if req.status in ("resolved", "closed"):
        await _log_audit(token, user_id, "SUPPORT_TICKET_RESOLVE", "support_tickets", ticket_id, {"status": req.status})
    return {"ticket": data[0] if data else None}


@router.post("/support/tickets/{ticket_id}/notes")
async def admin_add_ticket_note(ticket_id: str, req: TicketNoteCreate, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = {
        "ticket_id": ticket_id,
        "author_id": user_id,
        "note": req.note,
        "is_internal": req.is_internal,
    }
    url = f"{SUPABASE_URL}/rest/v1/support_ticket_notes?select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Note add failed: {resp.text}")
        data = resp.json()
    return {"note": data[0] if data else None}


@router.get("/support/tickets/{ticket_id}/notes")
async def admin_list_ticket_notes(ticket_id: str, request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/support_ticket_notes?ticket_id=eq.{ticket_id}&select=*&order=created_at.asc&limit=100"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            return []
        return resp.json()


# ---------------------------------------------------------------------------
# Module 10 — Analytics
# ---------------------------------------------------------------------------
@router.get("/analytics/summary")
async def admin_analytics_summary(request: Request, days: int = 30) -> Dict[str, Any]:
    """Daily query rollup for the last N days."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Try the analytics_summary view
    since = _days_ago(days)
    url = f"{SUPABASE_URL}/rest/v1/analytics_summary?select=day,total_queries,blocked_queries,safe_queries,unique_users&day=gte.{since}&order=day.asc&limit={days + 5}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                return {"days": resp.json()}
    except Exception:
        pass
    return {"days": []}


@router.get("/analytics/top-products")
async def admin_top_products(request: Request, limit: int = 10) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select_view("product_view_stats", columns="product_name,category,view_count", limit=limit, token=token)


@router.get("/analytics/top-questions")
async def admin_top_questions(request: Request, limit: int = 20) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select_view("top_questions", columns="question,ask_count,last_asked", limit=limit, token=token)


@router.get("/analytics/knowledge-gaps")
async def admin_knowledge_gaps(request: Request, limit: int = 50) -> List[Dict[str, Any]]:
    """Unresolved low-confidence queries — for the Knowledge Gaps review queue."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/knowledge_gaps?resolved=eq.false&select=*&order=occurrence_count.desc,last_occurred_at.desc&limit={limit}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                return resp.json()
    except Exception:
        pass
    return []


@router.get("/analytics/knowledge-freshness")
async def admin_knowledge_freshness(
    request: Request, stale_after_days: int = 180, limit: int = 200
) -> Dict[str, Any]:
    """Knowledge Freshness Monitoring (Capability 42) — flags real,
    checkable data-quality problems in `knowledge_documents` rather than
    a generic "documents" placeholder: stale approved documents (past
    `stale_after_days` since last update), documents missing category/tags
    metadata, and documents sharing a file_name with another non-archived
    document (likely duplicate uploads). Read-only — this surfaces
    problems for a human to act on via the existing document management
    endpoints, it doesn't archive/edit anything itself."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _select_view(
        "knowledge_documents",
        columns="id,document_id,file_name,category,tags,approval_status,is_archived,updated_at,created_at",
        limit=limit,
        token=token,
    )
    active = [r for r in rows if not r.get("is_archived")]

    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=stale_after_days)

    def _parse_dt(value: Optional[str]):
        if not value:
            return None
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return None

    stale: List[Dict[str, Any]] = []
    missing_metadata: List[Dict[str, Any]] = []
    for r in active:
        if r.get("approval_status") == "approved":
            updated = _parse_dt(r.get("updated_at")) or _parse_dt(r.get("created_at"))
            if updated and updated < cutoff:
                stale.append({
                    "id": r.get("id"), "file_name": r.get("file_name"),
                    "last_updated": r.get("updated_at") or r.get("created_at"),
                    "days_since_update": (datetime.now(timezone.utc) - updated).days,
                })
        if not r.get("category") or r.get("category") == "other" or not r.get("tags"):
            missing_metadata.append({
                "id": r.get("id"), "file_name": r.get("file_name"),
                "missing_category": not r.get("category") or r.get("category") == "other",
                "missing_tags": not r.get("tags"),
            })

    by_name: Dict[str, List[Dict[str, Any]]] = {}
    for r in active:
        name = (r.get("file_name") or "").strip().lower()
        if name:
            by_name.setdefault(name, []).append(r)
    duplicates: List[Dict[str, Any]] = [
        {"file_name": name, "count": len(group), "document_ids": [g.get("id") for g in group]}
        for name, group in by_name.items()
        if len(group) > 1
    ]

    return {
        "stale_documents": sorted(stale, key=lambda d: -d["days_since_update"]),
        "missing_metadata_documents": missing_metadata,
        "duplicate_documents": duplicates,
        "total_active_documents": len(active),
        "stale_after_days": stale_after_days,
    }


@router.get("/analytics/feedback-summary")
async def admin_feedback_summary(request: Request, limit: int = 500) -> Dict[str, Any]:
    """Feature: Feedback Learning — turns the 👍/👎 ratings the chat UI
    already captures (chat_messages.feedback/feedback_comment, written by
    POST /feedback in backend/main.py) into something an admin can actually
    act on, instead of leaving them sitting unused in the table. Aggregates
    by answer_source and ai_mode (the two enrichment columns chat_messages
    actually has — v17/v20 migrations) and surfaces the most recent
    negative-feedback comments verbatim so a real failure pattern is
    readable, not just a count."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = (
        f"{SUPABASE_URL}/rest/v1/chat_messages"
        f"?feedback=not.is.null&select=feedback,feedback_comment,answer_source,ai_mode,created_at"
        f"&order=created_at.desc&limit={limit}"
    )
    headers = _svc_headers(token)
    rows: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                rows = resp.json()
    except Exception:
        pass

    total_up = sum(1 for r in rows if r.get("feedback") == "up")
    total_down = sum(1 for r in rows if r.get("feedback") == "down")

    by_answer_source: Dict[str, Dict[str, int]] = {}
    by_ai_mode: Dict[str, Dict[str, int]] = {}
    for r in rows:
        rating = r.get("feedback")
        if rating not in ("up", "down"):
            continue
        src = r.get("answer_source") or "unknown"
        mode = r.get("ai_mode") or "normal"
        by_answer_source.setdefault(src, {"up": 0, "down": 0})[rating] += 1
        by_ai_mode.setdefault(mode, {"up": 0, "down": 0})[rating] += 1

    recent_negative_comments = [
        {
            "feedback_comment": r.get("feedback_comment"),
            "answer_source": r.get("answer_source"),
            "ai_mode": r.get("ai_mode"),
            "created_at": r.get("created_at"),
        }
        for r in rows
        if r.get("feedback") == "down" and r.get("feedback_comment")
    ][:20]

    return {
        "total_rated": total_up + total_down,
        "total_up": total_up,
        "total_down": total_down,
        "satisfaction_rate": round(total_up / (total_up + total_down), 3) if (total_up + total_down) else None,
        "by_answer_source": by_answer_source,
        "by_ai_mode": by_ai_mode,
        "recent_negative_comments": recent_negative_comments,
    }


@router.get("/analytics/improvement-candidates")
async def admin_improvement_candidates(request: Request, limit: int = 500) -> Dict[str, Any]:
    """Continuous Improvement System (Next-Generation spec, Phase 14) —
    turns negative feedback (chat_messages.feedback = 'down', the same
    real signal /analytics/feedback-summary already reads) into a ranked
    REVIEW QUEUE by classifying WHY each answer likely failed
    (orchestrator/failure_classifier.py — hallucination, wrong retrieval,
    wrong citation, tool failure, ambiguity, outdated knowledge, poor
    structure), from signals feedback-summary doesn't select
    (verification_status, rag_metadata, sources, handoff_required).

    Explicitly READ-ONLY reporting for a human to act on — per the
    brief's "DO NOT allow uncontrolled self-modification" rule, this
    endpoint never edits a prompt, a knowledge document, or routing
    behavior. A human reviews the candidates and decides what (if
    anything) changes, the same way /admin/analytics/knowledge-gaps and
    /admin/analytics/knowledge-freshness already work."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = (
        f"{SUPABASE_URL}/rest/v1/chat_messages"
        f"?feedback=eq.down&select=content,answer_source,verification_status,confidence,"
        f"sources,rag_metadata,handoff_required,feedback_comment,created_at"
        f"&order=created_at.desc&limit={limit}"
    )
    headers = _svc_headers(token)
    rows: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                rows = resp.json()
    except Exception:
        pass

    from backend.orchestrator.failure_classifier import ALL_CATEGORIES, classify_failure

    by_category: Dict[str, List[Dict[str, Any]]] = {c: [] for c in ALL_CATEGORIES}
    for r in rows:
        result = classify_failure(r)
        by_category[result.category].append({
            "question_or_answer_excerpt": (r.get("content") or "")[:200],
            "reason": result.reason,
            "feedback_comment": r.get("feedback_comment"),
            "answer_source": r.get("answer_source"),
            "created_at": r.get("created_at"),
        })

    candidates = [
        {"category": cat, "count": len(examples), "examples": examples[:5]}
        for cat, examples in by_category.items()
        if examples
    ]
    candidates.sort(key=lambda c: -c["count"])

    return {
        "total_negative_feedback_reviewed": len(rows),
        "candidates": candidates,
    }


@router.get("/analytics/observability")
async def admin_observability(request: Request, days: int = 7, limit: int = 2000) -> Dict[str, Any]:
    """Feature: Observability Dashboard. Aggregates the EXISTING `analytics`
    table (backend/main.py's `_log_analytics`, called on every /chat and
    /chat/stream request) — not a new/duplicate metrics store. `confidence`/
    `ai_mode`/`latency_ms` (database/supabase_schema_v27_analytics_
    observability.sql) are optional: `_has_column` detects whether that
    migration has been applied to this environment yet and the response's
    `migration_applied` flag tells the caller whether latency/confidence/
    mode breakdowns are actually populated, rather than silently returning
    zeros that look like real data. Privacy-safe: never returns the raw
    `query` text field, only aggregate counts/averages."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    migration_applied = await _has_column("analytics", "confidence")

    since = _days_ago(days)
    columns = "category,answer_route,safety_status,role,created_at"
    if migration_applied:
        columns += ",confidence,ai_mode,latency_ms"
    url = f"{SUPABASE_URL}/rest/v1/analytics?select={columns}&created_at=gte.{since}&order=created_at.desc&limit={limit}"
    headers = _svc_headers(token)
    rows: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                rows = resp.json()
    except Exception:
        pass

    total = len(rows)
    blocked = sum(1 for r in rows if r.get("safety_status") == "blocked")

    by_category: Dict[str, int] = {}
    by_answer_route: Dict[str, int] = {}
    by_ai_mode: Dict[str, int] = {}
    confidences: List[float] = []
    latencies: List[float] = []

    for r in rows:
        cat = r.get("category") or "unknown"
        by_category[cat] = by_category.get(cat, 0) + 1
        route = r.get("answer_route") or "unknown"
        by_answer_route[route] = by_answer_route.get(route, 0) + 1
        if migration_applied:
            mode = r.get("ai_mode") or "normal"
            by_ai_mode[mode] = by_ai_mode.get(mode, 0) + 1
            if isinstance(r.get("confidence"), (int, float)):
                confidences.append(r["confidence"])
            if isinstance(r.get("latency_ms"), (int, float)):
                latencies.append(r["latency_ms"])

    def _avg(values: List[float]) -> Optional[float]:
        return round(sum(values) / len(values), 3) if values else None

    def _p95(values: List[float]) -> Optional[float]:
        if not values:
            return None
        sorted_vals = sorted(values)
        idx = min(len(sorted_vals) - 1, int(len(sorted_vals) * 0.95))
        return round(sorted_vals[idx], 1)

    return {
        "migration_applied": migration_applied,
        "window_days": days,
        "total_requests": total,
        "blocked_requests": blocked,
        "safety_block_rate": round(blocked / total, 3) if total else None,
        "by_category": by_category,
        "by_answer_route": by_answer_route,
        "by_ai_mode": by_ai_mode if migration_applied else None,
        "avg_confidence": _avg(confidences) if migration_applied else None,
        "avg_latency_ms": _avg(latencies) if migration_applied else None,
        "p95_latency_ms": _p95(latencies) if migration_applied else None,
    }


# ---------------------------------------------------------------------------
# Module 11 — Audit logs
# ---------------------------------------------------------------------------
@router.get("/audit")
async def admin_audit_logs(
    request: Request,
    limit: int = 100,
    offset: int = 0,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/audit_logs?select=*&order=created_at.desc&limit={limit}&offset={offset}"
    if action:
        url += f"&action=eq.{action}"
    if entity_type:
        url += f"&entity_type=eq.{entity_type}"
    if created_by:
        url += f"&created_by=eq.{created_by}"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            return {"logs": [], "total": 0, "limit": limit, "offset": offset}
        rows = resp.json()
    total = len(rows)
    rng = resp.headers.get("Content-Range", "")
    if "/" in rng:
        try:
            total = int(rng.split("/")[-1])
        except ValueError:
            pass
    return {"logs": rows, "total": total, "limit": limit, "offset": offset}


# ---------------------------------------------------------------------------
# Module 12 — Notifications
# ---------------------------------------------------------------------------
@router.get("/notifications/templates")
async def admin_list_notification_templates(request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/notification_templates?select=*&order=template_key.asc&limit=100"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                return resp.json()
    except Exception:
        pass
    return []


@router.post("/notifications/broadcast")
async def admin_broadcast_notification(req: NotificationCreate, request: Request) -> Dict[str, Any]:
    """Broadcast a notification to all users (or a role / single user)."""
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    # Insert into notifications table
    payload = {
        "user_id": req.target_user_id,
        "title": req.title,
        "body": req.body,
        "category": req.category,
        "type": req.target_role or "broadcast",
        "action_url": None,
        "is_read": False,
    }
    url = f"{SUPABASE_URL}/rest/v1/notifications?select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Broadcast failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "INSERT", "notifications", data[0].get("id") if data else None, payload)
    return {"notification": data[0] if data else None}


# ---------------------------------------------------------------------------
# Module 14 — Org settings
# ---------------------------------------------------------------------------
@router.get("/org-settings")
async def get_org_settings(request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/organization_settings?select=*&limit=1"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                data = resp.json()
                return data[0] if data else _default_org_settings()
    except Exception:
        pass
    return _default_org_settings()


def _default_org_settings() -> Dict[str, Any]:
    return {
        "company_name": "Dayjoy",
        "logo_url": None,
        "primary_color": "#0f766e",
        "accent_color": "#f59e0b",
        "support_email": None,
        "support_phone": None,
        "default_language": "en",
        "enabled_languages": ["en", "hi"],
        "storage_quota_mb": 1024,
        "password_min_length": 8,
        "session_timeout_minutes": 60,
    }


@router.patch("/org-settings")
async def update_org_settings(req: OrgSettingsUpdate, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    payload["updated_by"] = user_id
    payload["updated_at"] = "now()"
    if not payload:
        return {"status": "noop"}
    url = f"{SUPABASE_URL}/rest/v1/organization_settings?id=neq.00000000-0000-0000-0000-000000000000&select=*"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "SETTINGS_UPDATE", "organization_settings", None, payload)
    return {"settings": data[0] if data else payload}


# ---------------------------------------------------------------------------
# Module 14 — API keys
# ---------------------------------------------------------------------------
@router.get("/api-keys")
async def admin_list_api_keys(request: Request) -> List[Dict[str, Any]]:
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/admin_api_keys?select=id,name,key_prefix,scopes,last_used_at,expires_at,is_active,created_at&order=created_at.desc&limit=50"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                return resp.json()
    except Exception:
        pass
    return []


@router.post("/api-keys")
async def admin_create_api_key(req: APIKeyCreate, request: Request) -> Dict[str, Any]:
    """Generate a new admin API key. Returns the full key ONCE."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    # Generate key: dj_ + 32 hex chars
    raw_key = "dj_" + secrets.token_hex(24)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:12]

    payload = {
        "name": req.name,
        "key_prefix": key_prefix,
        "key_hash": key_hash,
        "scopes": req.scopes,
        "created_by": user_id,
        "expires_at": req.expires_at,
        "is_active": True,
    }
    url = f"{SUPABASE_URL}/rest/v1/admin_api_keys?select=id,name,key_prefix,scopes,is_active,created_at,expires_at"
    headers = _prefer_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Create failed: {resp.text}")
        data = resp.json()
    await _log_audit(token, user_id, "API_KEY_ROTATE", "admin_api_keys", data[0].get("id") if data else None, {"name": req.name})
    return {"key": raw_key, "record": data[0] if data else None}


@router.delete("/api-keys/{key_id}")
async def admin_revoke_api_key(key_id: str, request: Request) -> Dict[str, Any]:
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin access required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    url = f"{SUPABASE_URL}/rest/v1/admin_api_keys?id=eq.{key_id}"
    headers = _svc_headers(token)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.delete(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Revoke failed: {resp.text}")
    await _log_audit(token, user_id, "API_KEY_ROTATE", "admin_api_keys", key_id, {"action": "revoke"})
    return {"status": "revoked", "key_id": key_id}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _is_staff_admin(claims: Dict[str, Any]) -> bool:
    """Check if the user is admin or super_admin.

    NOTE: `claims["role"]` on a Supabase-issued token is the *Postgres*
    role ("authenticated"/"anon"), not the app's business role — checking
    it first meant this always evaluated to "authenticated" and returned
    False for every real signed-in admin. See `main._is_staff` for the
    same fix.
    """
    role = (
        (claims.get("app_metadata") or {}).get("role")
        or (claims.get("user_metadata") or {}).get("role")
        or (claims.get("raw_user_meta_data") or {}).get("role")
        or "customer"
    )
    return role in {"admin", "super_admin"}


async def _log_audit(
    token: Optional[str],
    user_id: Optional[str],
    action: str,
    entity_type: str,
    entity_id: Optional[str],
    metadata: Dict[str, Any],
) -> None:
    """Best-effort audit log insert."""
    if not SUPABASE_URL:
        return
    payload = {
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id or "",
        "metadata": metadata,
        "created_by": user_id,
    }
    url = f"{SUPABASE_URL}/rest/v1/audit_logs"
    headers = _svc_headers(token, json_body=True)
    headers["Prefer"] = "return=minimal"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, headers=headers, json=payload)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# RAG embedding provider health + re-embedding (admin-only, mutations gated)
# ---------------------------------------------------------------------------


@router.get("/rag/embedding-status")
async def admin_embedding_status(request: Request) -> Dict[str, Any]:
    """Current embedding provider + a live health check — surfaces exactly
    what production is actually running on (gemini/jina/local-hash/etc.),
    since RAG_EMBEDDING_PROVIDER + fallback state isn't otherwise visible
    without reading server logs."""
    await _require_staff(request)
    if not RAG_AVAILABLE:
        raise HTTPException(status_code=503, detail="RAG subsystem unavailable")

    from backend.rag.embeddings import check_provider_health, embedding_provider_status, get_embedding_provider

    try:
        provider = get_embedding_provider()
    except Exception as e:
        return {"configured": False, "error": str(e)[:500]}

    status = embedding_provider_status(provider)
    status["healthy"] = check_provider_health(provider)
    return status


class ReembedRequest(BaseModel):
    dry_run: bool = True
    max_chunks: Optional[int] = None
    deactivate_stale: bool = True


@router.post("/rag/reembed")
async def admin_reembed(req: ReembedRequest, request: Request) -> Dict[str, Any]:
    """Backfill knowledge_embeddings for the currently configured provider
    and (optionally) deactivate stale embeddings from a previous provider.
    Admin-only (not just staff) — this can rewrite/invalidate the live
    retrieval index. `dry_run=true` by default: reports counts without
    writing anything."""
    claims = await _require_staff(request)
    if not _is_staff_admin(claims):
        raise HTTPException(status_code=403, detail="Admin role required")
    if not RAG_AVAILABLE:
        raise HTTPException(status_code=503, detail="RAG subsystem unavailable")

    from backend.rag.embeddings import get_embedding_provider
    from backend.rag.reembed import reembed_active_chunks
    from backend.rag.vector_store import get_vector_store

    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = await get_user_id(request)

    try:
        provider = get_embedding_provider()
        store = get_vector_store()
        report = await reembed_active_chunks(
            store,
            provider,
            token=token,
            max_chunks=req.max_chunks,
            dry_run=req.dry_run,
            deactivate_stale=req.deactivate_stale,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Re-embed failed: {str(e)[:300]}")

    if not req.dry_run:
        await _log_audit(
            token, user_id, "rag_reembed", "knowledge_embeddings", None,
            {"provider": report.provider, "chunks_embedded": report.chunks_embedded, "stale_deactivated": report.stale_deactivated},
        )

    return {
        "provider": report.provider,
        "chunks_seen": report.chunks_seen,
        "already_embedded": report.already_embedded,
        "chunks_embedded": report.chunks_embedded,
        "chunks_failed": report.chunks_failed,
        "stale_deactivated": report.stale_deactivated,
        "dry_run": report.dry_run,
    }
