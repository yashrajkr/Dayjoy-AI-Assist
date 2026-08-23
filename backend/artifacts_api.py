"""
Artifacts API — Advanced Intelligence Layer capabilities 14-16 (Artifact
Generation, Task Continuation, Response Versioning).

All endpoints require authentication (require_user_id). Every write forces
`user_id` from the server-verified caller — never trusted from the request
body — mirroring backend/distributor_api.py's `POST /follow-ups` pattern
(see backend/tests/test_distributor_follow_ups.py, which tests exactly this
property for that endpoint). RLS (database/supabase_schema_v26_artifacts.sql,
not auto-applied by this pass — see that file's own header) is the second,
independent enforcement layer.

Versioning: PATCH/continue never UPDATEs a row in place — each edit INSERTs
a new row with `parent_artifact_id` set and `version` incremented. Nothing
is ever overwritten, so "restore previous version" is just reading an older
row, not a special operation.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/artifacts", tags=["artifacts"])

try:
    from .main import require_user_id, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
except ImportError:  # pragma: no cover — standalone import for testing
    require_user_id = None  # type: ignore
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

ARTIFACT_TYPES = (
    "action_plan", "report", "checklist", "training_plan", "sales_plan",
    "summary", "business_document", "guide",
)


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


class ArtifactCreate(BaseModel):
    artifact_type: str = Field(..., description=f"One of {ARTIFACT_TYPES}")
    title: str
    content: str
    content_structured: Optional[Dict[str, Any]] = None
    conversation_id: Optional[str] = None


class ArtifactContinueRequest(BaseModel):
    instruction: str = Field(..., min_length=1, max_length=1000)


def _validate_artifact_type(artifact_type: str) -> None:
    if artifact_type not in ARTIFACT_TYPES:
        raise HTTPException(status_code=400, detail=f"artifact_type must be one of {ARTIFACT_TYPES}")


@router.post("")
async def create_artifact(req: ArtifactCreate, request: Request) -> Dict[str, Any]:
    """Feature: Artifact Generation. Saves a structured output (an action
    plan, report, etc. — typically the content of a chat answer the user
    wants to keep/reuse) as version 1 of a new artifact lineage."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    _validate_artifact_type(req.artifact_type)

    payload = {
        "user_id": user_id,
        "conversation_id": req.conversation_id,
        "artifact_type": req.artifact_type,
        "title": req.title,
        "content": req.content,
        "content_structured": req.content_structured,
        "version": 1,
        "parent_artifact_id": None,
        "status": "draft",
    }
    row = await _insert("artifacts", payload, token=token)
    if row is None:
        raise HTTPException(status_code=502, detail="Failed to save artifact")
    return row


@router.get("")
async def list_artifacts(request: Request, artifact_type: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    """Lists only the CURRENT (latest) version of each artifact lineage the
    caller owns — via the artifacts_current view, RLS-scoped exactly like
    the base table."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters: Dict[str, Any] = {"user_id": user_id}
    if artifact_type:
        _validate_artifact_type(artifact_type)
        filters["artifact_type"] = artifact_type
    rows = await _select("artifacts_current", filters=filters, limit=limit, order="created_at.desc", token=token)
    return {"artifacts": rows, "total": len(rows)}


@router.get("/{artifact_id}/versions")
async def list_artifact_versions(artifact_id: str, request: Request) -> Dict[str, Any]:
    """Feature: Response Versioning. Walks the parent_artifact_id chain
    starting from `artifact_id`, both up (ancestors) and down (the current
    tip), returning every version in the lineage oldest-first."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    rows = await _select("artifacts", filters={"user_id": user_id}, limit=500, token=token)
    by_id = {r["id"]: r for r in rows}
    if artifact_id not in by_id:
        raise HTTPException(status_code=404, detail="Artifact not found")

    # Walk to the root of this lineage.
    current = by_id[artifact_id]
    while current.get("parent_artifact_id") and current["parent_artifact_id"] in by_id:
        current = by_id[current["parent_artifact_id"]]
    root_id = current["id"]

    # Collect every row whose lineage traces back to root_id.
    children_by_parent: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        parent = r.get("parent_artifact_id")
        if parent:
            children_by_parent.setdefault(parent, []).append(r)

    lineage: List[Dict[str, Any]] = []
    stack = [root_id]
    seen = set()
    while stack:
        node_id = stack.pop()
        if node_id in seen or node_id not in by_id:
            continue
        seen.add(node_id)
        lineage.append(by_id[node_id])
        stack.extend(c["id"] for c in children_by_parent.get(node_id, []))

    lineage.sort(key=lambda r: r.get("version", 0))
    return {"versions": lineage, "total": len(lineage)}


@router.patch("/{artifact_id}")
async def edit_artifact(artifact_id: str, req: ArtifactCreate, request: Request) -> Dict[str, Any]:
    """Feature: Task Continuation (manual edit path) + Response Versioning.
    Never updates the existing row — inserts a new version pointing at
    `artifact_id` as its parent, owned by the same caller."""
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    _validate_artifact_type(req.artifact_type)

    existing_rows = await _select("artifacts", filters={"id": artifact_id, "user_id": user_id}, limit=1, token=token)
    if not existing_rows:
        raise HTTPException(status_code=404, detail="Artifact not found")
    existing = existing_rows[0]

    payload = {
        "user_id": user_id,
        "conversation_id": existing.get("conversation_id"),
        "artifact_type": req.artifact_type,
        "title": req.title,
        "content": req.content,
        "content_structured": req.content_structured,
        "version": int(existing.get("version") or 1) + 1,
        "parent_artifact_id": artifact_id,
        "status": "draft",
    }
    row = await _insert("artifacts", payload, token=token)
    if row is None:
        raise HTTPException(status_code=502, detail="Failed to save new version")
    return row


@router.post("/{artifact_id}/continue")
async def continue_artifact(artifact_id: str, req: ArtifactContinueRequest, request: Request) -> Dict[str, Any]:
    """Feature: Task Continuation (AI-assisted path) — "make week 2 more
    aggressive" modifies the EXISTING artifact (a new version derived from
    it) rather than generating an unrelated fresh response. Real Groq/
    OpenAI call, same provider-fallback convention as the rest of this
    codebase (see orchestrator/reasoning.py, answer_verify.py)."""
    import backend.main as backend_main  # lazy: avoid a circular import at module load time

    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    existing_rows = await _select("artifacts", filters={"id": artifact_id, "user_id": user_id}, limit=1, token=token)
    if not existing_rows:
        raise HTTPException(status_code=404, detail="Artifact not found")
    existing = existing_rows[0]

    if backend_main.GROQ_API_KEY:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.GROQ_API_KEY}"}
        model = backend_main.GROQ_MODEL
    elif backend_main.OPENAI_API_KEY:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.OPENAI_API_KEY}"}
        model = backend_main.OPENAI_MODEL
    else:
        raise HTTPException(status_code=503, detail="No AI provider configured")

    prompt = (
        "You are revising an existing document based on a specific instruction. "
        "Apply ONLY the requested change — preserve everything else in the document exactly as-is "
        "unless the instruction requires changing it. Never invent new facts not already present.\n\n"
        f"Current document:\n{existing['content'][:4000]}\n\n"
        f"Instruction: {req.instruction}\n\n"
        "Reply with ONLY the complete revised document text, no preamble or explanation."
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url, headers=headers,
                json={"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3, "max_tokens": 2000},
            )
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail="AI provider request failed")
            revised_content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="AI provider request failed")

    if not revised_content:
        raise HTTPException(status_code=502, detail="AI provider returned an empty revision")

    payload = {
        "user_id": user_id,
        "conversation_id": existing.get("conversation_id"),
        "artifact_type": existing["artifact_type"],
        "title": existing["title"],
        "content": revised_content,
        "content_structured": None,
        "version": int(existing.get("version") or 1) + 1,
        "parent_artifact_id": artifact_id,
        "status": "draft",
    }
    row = await _insert("artifacts", payload, token=token)
    if row is None:
        raise HTTPException(status_code=502, detail="Failed to save new version")
    return row
