"""
Phase 5 — Executive AI Analytics & Business Intelligence API.

Adds the /analytics/* routes for the Executive BI Platform:
  - /analytics/executive          — all executive KPIs in one call
  - /analytics/ai                 — AI performance metrics + trends
  - /analytics/products           — product engagement analytics
  - /analytics/distributors       — distributor performance
  - /analytics/customers          — customer engagement
  - /analytics/knowledge          — knowledge base health
  - /analytics/support            — support team performance
  - /analytics/training           — training completion
  - /analytics/health             — system health monitor
  - /analytics/alerts             — list/acknowledge/resolve alerts
  - /analytics/export/{type}      — CSV/JSON export
  - /analytics/dashboard-layout   — get/save custom widget layouts
  - /analytics/refresh            — trigger cache refresh

All endpoints require staff JWT.
"""

from __future__ import annotations

import csv
import io
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

router = APIRouter(prefix="/analytics", tags=["analytics"])

try:
    from .main import (
        require_user_id, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
        GROQ_API_KEY, OPENAI_API_KEY, RAG_AVAILABLE,
    )
except ImportError:
    pass


def _svc_headers(token: Optional[str] = None) -> Dict[str, str]:
    h = {"apikey": SUPABASE_ANON_KEY}
    if SUPABASE_SERVICE_ROLE_KEY:
        h["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    elif token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def _select(table_or_view: str, columns: str = "*", filters: Optional[Dict[str, Any]] = None,
                  limit: int = 100, order: Optional[str] = None, token: Optional[str] = None) -> List[Dict[str, Any]]:
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table_or_view}?select={columns}&limit={limit}"
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


async def _rpc(fn: str, params: Dict[str, Any], token: Optional[str] = None) -> Any:
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/rest/v1/rpc/{fn}"
    headers = _svc_headers(token)
    headers["Content-Type"] = "application/json"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=params)
            if resp.status_code >= 400:
                return None
            return resp.json()
    except Exception:
        return None


async def _count(table: str, filter_str: str = "", token: Optional[str] = None) -> int:
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


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class AlertAcknowledge(BaseModel):
    is_acknowledged: Optional[bool] = None
    is_resolved: Optional[bool] = None


class DashboardLayoutSave(BaseModel):
    layout_name: str = "default"
    widgets: List[Dict[str, Any]]
    is_default: bool = False


# ---------------------------------------------------------------------------
# Helper: require staff
# ---------------------------------------------------------------------------
async def _require_staff(request: Request) -> str:
    """Require staff JWT and return user_id."""
    from .main import verify_jwt, _is_staff
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = auth[7:].strip()
    claims = await verify_jwt(token)
    if not _is_staff(claims):
        raise HTTPException(status_code=403, detail="Staff access required")
    return claims.get("sub", "")


# ---------------------------------------------------------------------------
# Module 1 — Executive Dashboard
# ---------------------------------------------------------------------------
@router.get("/executive")
async def executive_dashboard(request: Request) -> Dict[str, Any]:
    """All executive KPIs in one call."""
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Try the view first
    rows = await _select("executive_dashboard_view", "*", limit=1, token=token)
    if rows:
        v = rows[0]
        # Compute derived metrics
        total_conv = int(v.get("total_conversations") or 0)
        total_users = int(v.get("total_users") or 1)
        verified = int(v.get("verified_queries") or 0)
        total_rag = int(v.get("total_rag_queries") or 0)
        completed_enroll = int(v.get("completed_enrollments") or 0)
        total_enroll = int(v.get("total_enrollments") or 1)

        return {
            "users": {
                "total": v.get("total_users", 0),
                "daily_active": v.get("daily_active_users", 0),
                "weekly_active": v.get("weekly_active_users", 0),
                "monthly_active": v.get("monthly_active_users", 0),
            },
            "ai": {
                "total_conversations": v.get("total_conversations", 0),
                "total_messages": v.get("total_messages", 0),
                "total_rag_queries": v.get("total_rag_queries", 0),
                "failed_responses": v.get("failed_ai_responses", 0),
                "verified_queries": verified,
                "avg_confidence": float(v.get("avg_confidence") or 0),
                "accuracy_pct": round(verified / total_rag * 100, 1) if total_rag > 0 else None,
                "conversations_per_user": round(total_conv / total_users, 1) if total_users > 0 else 0,
            },
            "knowledge": {
                "total_documents": v.get("total_documents", 0),
                "verified_documents": v.get("verified_documents", 0),
                "pending_approvals": v.get("pending_approvals", 0),
                "total_chunks": v.get("total_chunks", 0),
                "coverage_pct": await _rpc("get_knowledge_coverage", {}, token=token),
            },
            "support": {
                "total_tickets": v.get("total_tickets", 0),
                "open_tickets": v.get("open_tickets", 0),
                "resolved_tickets": v.get("resolved_tickets", 0),
                "escalated_tickets": v.get("escalated_tickets", 0),
            },
            "training": {
                "published_courses": v.get("published_courses", 0),
                "completed_enrollments": completed_enroll,
                "total_enrollments": total_enroll,
                "completion_pct": round(completed_enroll / total_enroll * 100, 1) if total_enroll > 0 else 0,
            },
            "products": {
                "total_products": v.get("total_products", 0),
            },
            "satisfaction": {
                "customer_rating": float(v.get("avg_customer_rating") or 0),
                "total_feedback": v.get("total_feedback", 0),
            },
        }

    # Fallback: compute manually
    total_users = await _count("profiles", token=token)
    total_conv = await _count("chat_conversations", token=token)
    total_msgs = await _count("chat_messages", "&role=eq.user", token=token)
    total_docs = await _count("knowledge_documents", "&is_archived=eq.false", token=token) if await _count("knowledge_documents", token=token) > 0 else await _count("knowledge_documents", token=token)
    verified_docs = await _count("knowledge_documents", "&approval_status=eq.approved", token=token)
    pending_docs = await _count("knowledge_documents", "&approval_status=eq.pending", token=token)
    open_tickets = await _count("support_tickets", "&status=neq.closed", token=token)
    resolved_tickets = await _count("support_tickets", "&status=in.(resolved,closed)", token=token)
    escalated = await _count("support_tickets", "&escalated=eq.true", token=token) if await _count("support_tickets", "&escalated=eq.true", token=token) > 0 else 0
    total_products = await _count("products", "&is_archived=eq.false", token=token) if await _count("products", token=token) > 0 else await _count("products", token=token)

    return {
        "users": {"total": total_users, "daily_active": 0, "weekly_active": 0, "monthly_active": 0},
        "ai": {"total_conversations": total_conv, "total_messages": total_msgs, "total_rag_queries": 0, "failed_responses": 0, "verified_queries": 0, "avg_confidence": 0, "accuracy_pct": None, "conversations_per_user": round(total_conv / max(total_users, 1), 1)},
        "knowledge": {"total_documents": total_docs, "verified_documents": verified_docs, "pending_approvals": pending_docs, "total_chunks": 0, "coverage_pct": 0},
        "support": {"total_tickets": open_tickets + resolved_tickets, "open_tickets": open_tickets, "resolved_tickets": resolved_tickets, "escalated_tickets": escalated},
        "training": {"published_courses": 0, "completed_enrollments": 0, "total_enrollments": 0, "completion_pct": 0},
        "products": {"total_products": total_products},
        "satisfaction": {"customer_rating": 0, "total_feedback": 0},
    }


# ---------------------------------------------------------------------------
# Module 2 — AI Analytics
# ---------------------------------------------------------------------------
@router.get("/ai")
async def ai_analytics(request: Request, days: int = 30) -> Dict[str, Any]:
    """AI performance metrics + trends."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    daily = await _select("ai_analytics_view", "*", limit=days, order="day.desc", token=token)
    top_questions = await _select("mv_top_questions", "question,ask_count,last_asked", limit=20, token=token)
    accuracy = await _rpc("get_ai_accuracy", {"p_days": days}, token=token)

    # Aggregate
    total_queries = sum(int(d.get("total_queries") or 0) for d in daily)
    verified = sum(int(d.get("verified") or 0) for d in daily)
    unverified = sum(int(d.get("unverified") or 0) for d in daily)
    avg_conf = sum(float(d.get("avg_confidence") or 0) for d in daily) / len(daily) if daily else 0
    avg_latency = sum(int(d.get("avg_retrieval_time_ms") or 0) for d in daily) / len(daily) if daily else 0

    return {
        "daily": list(reversed(daily)),
        "aggregates": {
            "total_queries": total_queries,
            "verified": verified,
            "unverified": unverified,
            "avg_confidence": round(avg_conf, 4),
            "avg_latency_ms": round(avg_latency),
            "accuracy_pct": accuracy,
        },
        "top_questions": top_questions,
    }


# ---------------------------------------------------------------------------
# Module 3 — Product Analytics
# ---------------------------------------------------------------------------
@router.get("/products")
async def product_analytics(request: Request, limit: int = 20) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    products = await _select("product_analytics_view", "*", limit=limit, token=token)
    # Category popularity
    cat_counts: Dict[str, int] = {}
    for p in products:
        cat = p.get("category") or "Uncategorized"
        cat_counts[cat] = cat_counts.get(cat, 0) + int(p.get("view_count") or 0)

    return {
        "products": products,
        "category_popularity": [{"category": k, "views": v} for k, v in sorted(cat_counts.items(), key=lambda x: -x[1])],
        "total_views": sum(int(p.get("view_count") or 0) for p in products),
        "total_favorites": sum(int(p.get("favorite_count") or 0) for p in products),
    }


# ---------------------------------------------------------------------------
# Module 4 — Distributor Analytics
# ---------------------------------------------------------------------------
@router.get("/distributors")
async def distributor_analytics(request: Request, limit: int = 50) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    distributors = await _select("distributor_analytics_view", "*", limit=limit, token=token)

    return {
        "distributors": distributors,
        "aggregates": {
            "total_distributors": len(distributors),
            "total_customers": sum(int(d.get("customer_count") or 0) for d in distributors),
            "total_follow_ups": sum(int(d.get("follow_up_count") or 0) for d in distributors),
            "total_content": sum(int(d.get("content_generated") or 0) for d in distributors),
            "total_ai_queries": sum(int(d.get("ai_queries") or 0) for d in distributors),
            "total_role_play": sum(int(d.get("role_play_sessions") or 0) for d in distributors),
        },
    }


# ---------------------------------------------------------------------------
# Module 5 — Customer Analytics
# ---------------------------------------------------------------------------
@router.get("/customers")
async def customer_analytics(request: Request, days: int = 30) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    daily = await _select("customer_analytics_view", "*", limit=days, order="registration_day.desc", token=token)
    satisfaction = await _rpc("get_customer_satisfaction", {}, token=token)

    total_reg = sum(int(d.get("new_registrations") or 0) for d in daily)
    total_onboarded = sum(int(d.get("completed_onboarding") or 0) for d in daily)
    active_week = sum(int(d.get("active_this_week") or 0) for d in daily)

    return {
        "daily": list(reversed(daily)),
        "aggregates": {
            "total_registrations": total_reg,
            "completed_onboarding": total_onboarded,
            "active_this_week": active_week,
            "satisfaction": satisfaction,
        },
    }


# ---------------------------------------------------------------------------
# Module 6 — Knowledge Analytics
# ---------------------------------------------------------------------------
@router.get("/knowledge")
async def knowledge_analytics(request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    docs = await _select("knowledge_analytics_view", "*", limit=100, token=token)
    coverage = await _rpc("get_knowledge_coverage", {}, token=token)

    fresh = sum(1 for d in docs if d.get("freshness_status") == "fresh")
    aging = sum(1 for d in docs if d.get("freshness_status") == "aging")
    stale = sum(1 for d in docs if d.get("freshness_status") == "stale")

    return {
        "documents": docs,
        "aggregates": {
            "total": len(docs),
            "fresh": fresh,
            "aging": aging,
            "stale": stale,
            "coverage_pct": coverage,
            "avg_references": round(sum(int(d.get("reference_count") or 0) for d in docs) / max(len(docs), 1), 1),
        },
    }


# ---------------------------------------------------------------------------
# Module 7 — Support Analytics
# ---------------------------------------------------------------------------
@router.get("/support")
async def support_analytics(request: Request, days: int = 30) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    daily = await _select("support_analytics_view", "*", limit=days, order="day.desc", token=token)
    satisfaction = await _rpc("get_support_satisfaction", {}, token=token)

    total = sum(int(d.get("total_tickets") or 0) for d in daily)
    resolved = sum(int(d.get("resolved") or 0) for d in daily)
    escalated = sum(int(d.get("escalated") or 0) for d in daily)
    avg_res = sum(float(d.get("avg_resolution_hours") or 0) for d in daily) / len(daily) if daily else 0

    return {
        "daily": list(reversed(daily)),
        "aggregates": {
            "total_tickets": total,
            "resolved": resolved,
            "escalated": escalated,
            "avg_resolution_hours": round(avg_res, 1),
            "satisfaction": satisfaction,
            "escalation_rate": round(escalated / max(total, 1) * 100, 1),
        },
    }


# ---------------------------------------------------------------------------
# Module 8 — Training Analytics
# ---------------------------------------------------------------------------
@router.get("/training")
async def training_analytics(request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    courses = await _select("training_analytics_view", "*", limit=50, token=token)

    total_enroll = sum(int(c.get("total_enrollments") or 0) for c in courses)
    completed = sum(int(c.get("completed") or 0) for c in courses)
    certs = sum(int(c.get("certificates_issued") or 0) for c in courses)

    return {
        "courses": courses,
        "aggregates": {
            "total_courses": len(courses),
            "total_enrollments": total_enroll,
            "completed": completed,
            "certificates_issued": certs,
            "completion_pct": round(completed / max(total_enroll, 1) * 100, 1),
        },
    }


# ---------------------------------------------------------------------------
# Module 9 — AI Health Monitor
# ---------------------------------------------------------------------------
@router.get("/health")
async def system_health(request: Request) -> Dict[str, Any]:
    """System health — backend, Groq, Supabase, RAG, storage."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Backend health
    backend_ok = True
    backend_latency_ms = 0

    # Groq API health (check if key configured)
    groq_ok = bool(GROQ_API_KEY)

    # Supabase health
    supabase_ok = bool(SUPABASE_URL and SUPABASE_ANON_KEY)
    supabase_latency_ms = 0
    if supabase_ok:
        start = time.time()
        try:
            await _count("profiles", token=token)
            supabase_latency_ms = int((time.time() - start) * 1000)
        except Exception:
            supabase_ok = False

    # RAG subsystem
    rag_ok = bool(RAG_AVAILABLE)

    # Storage usage (approximate)
    storage_docs = await _count("knowledge_documents", token=token)
    storage_chunks = await _count("knowledge_chunks", token=token)
    storage_embeddings = await _count("knowledge_embeddings", "&is_active=eq.true", token=token)

    # Embedding queue (approximate — chunks without embeddings)
    chunks_without_embeddings = max(0, storage_chunks - storage_embeddings)

    # Background jobs (no job queue yet — return 0)
    background_jobs = 0

    return {
        "overall_status": "healthy" if (backend_ok and supabase_ok) else "degraded",
        "components": {
            "backend": {"status": "ok" if backend_ok else "down", "latency_ms": backend_latency_ms},
            "groq_api": {"status": "ok" if groq_ok else "not_configured", "configured": groq_ok},
            "supabase": {"status": "ok" if supabase_ok else "down", "latency_ms": supabase_latency_ms, "url_configured": bool(SUPABASE_URL)},
            "rag": {"status": "ok" if rag_ok else "unavailable", "available": rag_ok},
            "openai": {"status": "ok" if OPENAI_API_KEY else "not_configured", "configured": bool(OPENAI_API_KEY)},
        },
        "storage": {
            "documents": storage_docs,
            "chunks": storage_chunks,
            "embeddings": storage_embeddings,
            "chunks_without_embeddings": chunks_without_embeddings,
        },
        "background_jobs": background_jobs,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


# ---------------------------------------------------------------------------
# Module 14 — Alerts
# ---------------------------------------------------------------------------
@router.get("/alerts")
async def list_alerts(request: Request, resolved: bool = False) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filter_str = "&is_resolved=eq.false" if not resolved else ""
    url = f"{SUPABASE_URL}/rest/v1/analytics_alerts?select=*{filter_str}&order=created_at.desc&limit=50"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


@router.patch("/alerts/{alert_id}")
async def update_alert(alert_id: str, req: AlertAcknowledge, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload: Dict[str, Any] = {}
    if req.is_acknowledged is not None:
        payload["is_acknowledged"] = req.is_acknowledged
        payload["acknowledged_by"] = user_id
        payload["acknowledged_at"] = "now()"
    if req.is_resolved is not None:
        payload["is_resolved"] = req.is_resolved
        if req.is_resolved:
            payload["resolved_at"] = "now()"
    if not payload:
        return {"status": "noop"}
    url = f"{SUPABASE_URL}/rest/v1/analytics_alerts?id=eq.{alert_id}&select=*"
    headers = _svc_headers(token)
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=representation"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
            data = resp.json()
            return {"alert": data[0] if data else None}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Module 12 — Dashboard Layouts
# ---------------------------------------------------------------------------
@router.get("/dashboard-layout")
async def get_dashboard_layout(request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/dashboard_layouts?user_id=eq.{user_id}&is_default=eq.true&select=*&limit=1"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                data = resp.json()
                return data[0] if data else {"widgets": []}
    except Exception:
        pass
    return {"widgets": []}


@router.post("/dashboard-layout")
async def save_dashboard_layout(req: DashboardLayoutSave, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    payload = {
        "user_id": user_id,
        "layout_name": req.layout_name,
        "widgets": req.widgets,
        "is_default": req.is_default,
        "updated_at": "now()",
    }
    # Try update first
    url = f"{SUPABASE_URL}/rest/v1/dashboard_layouts?user_id=eq.{user_id}&layout_name=eq.{req.layout_name}&select=*"
    headers = _svc_headers(token)
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=representation"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.patch(url, headers=headers, json=payload)
            if resp.status_code < 400:
                data = resp.json()
                if data:
                    return {"layout": data[0]}
            # Insert if not found
            insert_url = f"{SUPABASE_URL}/rest/v1/dashboard_layouts?select=*"
            resp = await client.post(insert_url, headers=headers, json=payload)
            if resp.status_code < 400:
                data = resp.json()
                return {"layout": data[0] if data else None}
            raise HTTPException(status_code=502, detail=f"Save failed: {resp.text}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Module 11 — Export
# ---------------------------------------------------------------------------
@router.get("/export/{metric_type}", response_class=PlainTextResponse)
async def export_metrics(metric_type: str, request: Request, days: int = 30) -> str:
    """Export analytics as CSV."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    data: List[Dict[str, Any]] = []
    filename = "analytics"

    if metric_type == "ai":
        data = await _select("ai_analytics_view", "*", limit=days, order="day.desc", token=token)
        filename = "ai_analytics"
    elif metric_type == "products":
        data = await _select("product_analytics_view", "*", limit=100, token=token)
        filename = "product_analytics"
    elif metric_type == "distributors":
        data = await _select("distributor_analytics_view", "*", limit=100, token=token)
        filename = "distributor_analytics"
    elif metric_type == "customers":
        data = await _select("customer_analytics_view", "*", limit=days, order="registration_day.desc", token=token)
        filename = "customer_analytics"
    elif metric_type == "knowledge":
        data = await _select("knowledge_analytics_view", "*", limit=100, token=token)
        filename = "knowledge_analytics"
    elif metric_type == "support":
        data = await _select("support_analytics_view", "*", limit=days, order="day.desc", token=token)
        filename = "support_analytics"
    elif metric_type == "training":
        data = await _select("training_analytics_view", "*", limit=50, token=token)
        filename = "training_analytics"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown metric type: {metric_type}")

    if not data:
        return "No data"

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=data[0].keys())
    writer.writeheader()
    writer.writerows(data)
    return output.getvalue()


# ---------------------------------------------------------------------------
# Module 10 — Refresh cache
# ---------------------------------------------------------------------------
@router.post("/refresh")
async def refresh_cache(request: Request) -> Dict[str, Any]:
    """Trigger refresh of materialized views."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    result = await _rpc("refresh_analytics_cache", {}, token=token)
    return {"status": "refreshed", "result": result}
