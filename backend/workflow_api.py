"""
Phase 7 — AI Workflow Automation & Multi-Agent Intelligence API.

Adds the /workflow/* and /agent/* routes:
  - /agent/list              — list AI agents
  - /agent/{id}              — get agent details
  - /agent/{id}/memory       — get/set agent memory
  - /agent/{id}/chat         — chat with a specific agent
  - /agent/collaborate       — multi-agent collaboration
  - /workflow/list           — list workflows
  - /workflow/create         — create workflow
  - /workflow/{id}           — get/update/delete workflow
  - /workflow/{id}/execute   — manually trigger workflow
  - /workflow/{id}/versions  — version history
  - /workflow/{id}/executions — execution history
  - /workflow/templates      — workflow templates
  - /workflow/tasks          — task queue
  - /workflow/scheduled      — scheduled jobs
  - /workflow/approvals      — approval requests
  - /workflow/approvals/{id} — approve/reject
  - /workflow/rules          — business rules
  - /workflow/dashboard      — automation dashboard stats

All endpoints require staff JWT.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/workflow", tags=["workflow"])

try:
    from .main import (
        require_user_id, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
        GROQ_API_KEY, GROQ_MODEL, stream_groq, load_safety_rules, run_safety_check,
    )
except ImportError:
    pass

# Also add agent routes under /agent prefix
agent_router = APIRouter(prefix="/agent", tags=["agent"])


def _svc_headers(token: Optional[str] = None) -> Dict[str, str]:
    h = {"apikey": SUPABASE_ANON_KEY}
    if SUPABASE_SERVICE_ROLE_KEY:
        h["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    elif token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _prefer_headers(token: Optional[str] = None) -> Dict[str, str]:
    h = _svc_headers(token)
    h["Content-Type"] = "application/json"
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


async def _require_staff(request: Request) -> str:
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
# Models
# ---------------------------------------------------------------------------
class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: str = "custom"
    trigger_type: str
    trigger_config: Optional[Dict[str, Any]] = None
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    is_template: bool = False


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    trigger_config: Optional[Dict[str, Any]] = None
    status: Optional[str] = None


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    memory_enabled: Optional[bool] = None
    is_active: Optional[bool] = None


class AgentChatRequest(BaseModel):
    message: str
    user_id: Optional[str] = None
    language: str = "en"


class CollaborationRequest(BaseModel):
    topic: str
    initial_query: str
    agent_chain: List[str]  # list of agent_ids
    user_id: Optional[str] = None


class ApprovalAction(BaseModel):
    status: str  # approved, rejected
    review_comment: Optional[str] = None


class BusinessRuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    rule_type: str = "custom"
    event_type: str
    conditions: List[Dict[str, Any]]
    actions: List[Dict[str, Any]]
    else_actions: Optional[List[Dict[str, Any]]] = None
    priority: int = 5


class ScheduledJobCreate(BaseModel):
    name: str
    job_type: str = "one_time"
    cron_expression: Optional[str] = None
    scheduled_for: Optional[str] = None
    interval_seconds: Optional[int] = None
    task_type: str
    task_payload: Optional[Dict[str, Any]] = None
    workflow_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Module 2 — Agent Center
# ---------------------------------------------------------------------------
@agent_router.get("/list")
async def list_agents(request: Request, active_only: bool = False) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters = {}
    if active_only:
        filters["is_active"] = "true"
    return await _select("ai_agents", "*", filters=filters, limit=50, order="agent_type.asc", token=token)


@agent_router.get("/{agent_id}")
async def get_agent(agent_id: str, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    agents = await _select("ai_agents", "*", filters={"id": agent_id}, limit=1, token=token)
    if not agents:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent = agents[0]
    # Get tools
    tools = await _select("ai_agent_tools", "*", filters={"agent_id": agent_id, "is_enabled": "true"}, limit=20, token=token)
    agent["tools"] = tools
    return agent


@agent_router.patch("/{agent_id}")
async def update_agent(agent_id: str, req: AgentUpdate, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("ai_agents", {"id": agent_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


# ---------------------------------------------------------------------------
# Module 10 — Memory Engine
# ---------------------------------------------------------------------------
@agent_router.get("/{agent_id}/memory")
async def get_agent_memory(agent_id: str, request: Request, user_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters = {"agent_id": agent_id}
    if user_id:
        filters["user_id"] = user_id
    return await _select("ai_agent_memory", "*", filters=filters, limit=limit, order="is_pinned.desc,created_at.desc", token=token)


@agent_router.post("/{agent_id}/memory")
async def add_agent_memory(agent_id: str, payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload["agent_id"] = agent_id
    return await _insert("ai_agent_memory", payload, token=token) or {"status": "error"}


@agent_router.delete("/{agent_id}/memory/{memory_id}")
async def delete_agent_memory(agent_id: str, memory_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("ai_agent_memory", {"id": memory_id, "agent_id": agent_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 2 — Agent Chat
# ---------------------------------------------------------------------------
@agent_router.post("/{agent_id}/chat")
async def chat_with_agent(agent_id: str, req: AgentChatRequest, request: Request) -> Dict[str, Any]:
    """Chat with a specific AI agent using its system prompt."""
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Get agent
    agents = await _select("ai_agents", "*", filters={"id": agent_id}, limit=1, token=token)
    if not agents:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent = agents[0]

    # Safety check
    rules = await load_safety_rules()
    is_blocked, rule_key = run_safety_check(req.message, rules)
    if is_blocked:
        raise HTTPException(status_code=400, detail=f"Blocked by safety rule: {rule_key}")

    # Build messages with agent's system prompt
    messages = []

    # Load memory if enabled
    if agent.get("memory_enabled"):
        memories = await _select("ai_agent_memory", "*", filters={"agent_id": agent_id}, limit=agent.get("memory_window", 10), order="created_at.desc", token=token)
        if memories:
            memory_text = "\n".join([f"- {m.get('key', 'fact')}: {m.get('value', '')}" for m in reversed(memories)])
            messages.append({"role": "system", "content": f"Previous context:\n{memory_text}"})

    messages.append({"role": "system", "content": agent.get("system_prompt", "You are a helpful assistant.")})
    messages.append({"role": "user", "content": req.message})

    # Generate response via Groq
    response = ""
    try:
        if GROQ_API_KEY:
            import httpx as _httpx
            url = "https://api.groq.com/openai/v1/chat/completions"
            payload = {
                "model": agent.get("model", GROQ_MODEL),
                "messages": messages,
                "temperature": float(agent.get("temperature", 0.3)),
                "max_tokens": int(agent.get("max_tokens", 800)),
                "stream": False,
            }
            async with _httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers={"Authorization": f"Bearer {GROQ_API_KEY}"}, json=payload)
                if resp.status_code < 400:
                    data = resp.json()
                    response = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception:
        pass

    if not response:
        response = f"[{agent.get('name', 'Agent')}] I'm here to help. Could you rephrase your question?"

    # Save to memory
    if agent.get("memory_enabled"):
        await _insert("ai_agent_memory", {
            "agent_id": agent_id,
            "user_id": req.user_id or user_id,
            "memory_type": "conversation",
            "value": f"User: {req.message[:200]}\nAgent: {response[:200]}",
        }, token=token)

    return {"response": response, "agent_name": agent.get("name"), "agent_id": agent_id}


# ---------------------------------------------------------------------------
# Module 3 — Agent Collaboration
# ---------------------------------------------------------------------------
@agent_router.post("/collaborate")
async def agent_collaboration(req: CollaborationRequest, request: Request) -> Dict[str, Any]:
    """Multi-agent collaboration — chain agents to process a query."""
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Create collaboration session
    session = await _insert("agent_collaborations", {
        "user_id": req.user_id or user_id,
        "topic": req.topic,
        "initial_query": req.initial_query,
        "agent_chain": req.agent_chain,
        "status": "active",
    }, token=token)

    session_id = session.get("id") if session else str(uuid.uuid4())

    # Get all agents in the chain
    messages_log: List[Dict[str, Any]] = []
    current_context = req.initial_query

    for agent_id in req.agent_chain:
        agents = await _select("ai_agents", "*", filters={"id": agent_id}, limit=1, token=token)
        if not agents:
            continue
        agent = agents[0]
        agent_name = agent.get("name", "Agent")

        # Each agent processes the current context
        agent_response = ""
        try:
            if GROQ_API_KEY:
                import httpx as _httpx
                payload = {
                    "model": agent.get("model", GROQ_MODEL),
                    "messages": [
                        {"role": "system", "content": agent.get("system_prompt", "")},
                        {"role": "user", "content": f"Context from previous agent: {current_context}\n\nProcess this and provide your expertise."},
                    ],
                    "temperature": float(agent.get("temperature", 0.3)),
                    "max_tokens": int(agent.get("max_tokens", 800)),
                    "stream": False,
                }
                async with _httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post("https://api.groq.com/openai/v1/chat/completions",
                                             headers={"Authorization": f"Bearer {GROQ_API_KEY}"}, json=payload)
                    if resp.status_code < 400:
                        agent_response = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        except Exception:
            pass

        if not agent_response:
            agent_response = f"[{agent_name}] Processing..."

        messages_log.append({
            "agent_id": agent_id,
            "agent_name": agent_name,
            "message": agent_response,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
        current_context = agent_response

    # Update session
    final_response = current_context
    await _update("agent_collaborations", {"id": session_id}, {
        "messages": messages_log,
        "status": "completed",
        "final_response": final_response,
        "completed_at": "now()",
    }, token=token)

    return {
        "session_id": session_id,
        "messages": messages_log,
        "final_response": final_response,
    }


# ---------------------------------------------------------------------------
# Module 1 — Workflow Builder
# ---------------------------------------------------------------------------
@router.get("/list")
async def list_workflows(request: Request, status: Optional[str] = None, category: Optional[str] = None) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/workflow_dashboard_view?select=*&order=updated_at.desc&limit=100"
    if status:
        url += f"&status=eq.{status}"
    if category:
        url += f"&category=eq.{category}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


@router.post("/create")
async def create_workflow(req: WorkflowCreate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "created_by": user_id, "status": "draft", "version": 1}
    row = await _insert("workflows", payload, token=token)
    # Save initial version
    if row:
        await _insert("workflow_versions", {
            "workflow_id": row["id"],
            "version_number": 1,
            "nodes": req.nodes,
            "edges": req.edges,
            "trigger_config": req.trigger_config or {},
            "change_summary": "Initial version",
            "created_by": user_id,
        }, token=token)
    return row or {"status": "error"}


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _select("workflows", "*", filters={"id": workflow_id}, limit=1, token=token)
    if not rows:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return rows[0]


@router.patch("/{workflow_id}")
async def update_workflow(workflow_id: str, req: WorkflowUpdate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Fetch current to check if nodes changed
    current = await _select("workflows", "id,nodes,edges,version", filters={"id": workflow_id}, limit=1, token=token)
    payload = {k: v for k, v in req.model_dump().items() if v is not None}

    # If nodes/edges changed, save a new version
    if current and (req.nodes is not None or req.edges is not None):
        old_version = current[0].get("version", 1)
        new_version = old_version + 1
        payload["version"] = new_version
        await _insert("workflow_versions", {
            "workflow_id": workflow_id,
            "version_number": new_version,
            "nodes": req.nodes or current[0].get("nodes", []),
            "edges": req.edges or current[0].get("edges", []),
            "change_summary": f"Updated to v{new_version}",
            "created_by": user_id,
        }, token=token)

    rows = await _update("workflows", {"id": workflow_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("workflows", {"id": workflow_id}, token=token)
    return {"status": "deleted" if ok else "error"}


@router.post("/{workflow_id}/execute")
async def execute_workflow(workflow_id: str, payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    """Manually trigger a workflow execution."""
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Get workflow
    wfs = await _select("workflows", "*", filters={"id": workflow_id}, limit=1, token=token)
    if not wfs:
        raise HTTPException(status_code=404, detail="Workflow not found")
    wf = wfs[0]

    # Create execution record
    execution = await _insert("workflow_executions", {
        "workflow_id": workflow_id,
        "trigger_type": "manual",
        "trigger_data": payload,
        "status": "queued",
        "triggered_by": user_id,
    }, token=token)

    # Create a task in the queue
    if execution:
        await _insert("task_queue", {
            "task_type": "workflow_execution",
            "payload": {"execution_id": execution.get("id"), "workflow_id": workflow_id},
            "priority": 3,
            "status": "queued",
            "created_by": user_id,
        }, token=token)

    return execution or {"status": "error", "detail": "Failed to create execution"}


@router.get("/{workflow_id}/versions")
async def workflow_versions(workflow_id: str, request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("workflow_versions", "*", filters={"workflow_id": workflow_id}, limit=20, order="version_number.desc", token=token)


@router.get("/{workflow_id}/executions")
async def workflow_executions(workflow_id: str, request: Request, limit: int = 20) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("workflow_executions", "*", filters={"workflow_id": workflow_id}, limit=limit, order="created_at.desc", token=token)


@router.get("/templates")
async def workflow_templates(request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("workflows", "*", filters={"is_template": "true"}, limit=20, order="name.asc", token=token)


# ---------------------------------------------------------------------------
# Module 6 — Scheduler / Task Queue
# ---------------------------------------------------------------------------
@router.get("/tasks")
async def list_tasks(request: Request, status: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/task_queue?select=*&order=created_at.desc&limit={limit}"
    if status:
        url += f"&status=eq.{status}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return {"tasks": [], "total": 0}
            rows = resp.json()
        # Get summary
        summary = await _select("task_queue_summary", "*", limit=20, token=token)
        return {"tasks": rows, "total": len(rows), "summary": summary}
    except Exception:
        return {"tasks": [], "total": 0, "summary": []}


@router.get("/scheduled")
async def list_scheduled_jobs(request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("scheduled_jobs", "*", limit=50, order="next_run_at.asc", token=token)


@router.post("/scheduled")
async def create_scheduled_job(req: ScheduledJobCreate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "created_by": user_id}
    # Set next_run_at
    if req.job_type == "one_time" and req.scheduled_for:
        payload["next_run_at"] = req.scheduled_for
    elif req.job_type == "recurring" and req.interval_seconds:
        payload["next_run_at"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() + req.interval_seconds))
    return await _insert("scheduled_jobs", payload, token=token) or {"status": "error"}


@router.delete("/scheduled/{job_id}")
async def delete_scheduled_job(job_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("scheduled_jobs", {"id": job_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 7 & 12 — Approvals
# ---------------------------------------------------------------------------
@router.get("/approvals")
async def list_approvals(request: Request, status: Optional[str] = None) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/approval_requests?select=*&order=created_at.desc&limit=100"
    if status:
        url += f"&status=eq.{status}"
    else:
        url += "&status=eq.pending"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return {"approvals": [], "total": 0}
            rows = resp.json()
        # Get summary
        summary = await _select("approval_summary", "*", limit=20, token=token)
        return {"approvals": rows, "total": len(rows), "summary": summary}
    except Exception:
        return {"approvals": [], "total": 0, "summary": []}


@router.post("/approvals")
async def create_approval(payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload["requested_by"] = user_id
    return await _insert("approval_requests", payload, token=token) or {"status": "error"}


@router.patch("/approvals/{approval_id}")
async def review_approval(approval_id: str, req: ApprovalAction, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _update("approval_requests", {"id": approval_id}, {
        "status": req.status,
        "review_comment": req.review_comment,
        "reviewed_by": user_id,
        "reviewed_at": "now()",
    }, token=token)
    return rows[0] if rows else {"status": "error"}


# ---------------------------------------------------------------------------
# Module 11 — Business Rules
# ---------------------------------------------------------------------------
@router.get("/rules")
async def list_business_rules(request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("business_rules", "*", limit=50, order="priority.asc,event_type.asc", token=token)


@router.post("/rules")
async def create_business_rule(req: BusinessRuleCreate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "created_by": user_id}
    return await _insert("business_rules", payload, token=token) or {"status": "error"}


@router.patch("/rules/{rule_id}")
async def update_business_rule(rule_id: str, payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _update("business_rules", {"id": rule_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.delete("/rules/{rule_id}")
async def delete_business_rule(rule_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("business_rules", {"id": rule_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 13 — Automation Dashboard
# ---------------------------------------------------------------------------
@router.get("/dashboard")
async def automation_dashboard(request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Task queue stats
    queued = await _count("task_queue", "&status=eq.queued", token=token)
    processing = await _count("task_queue", "&status=eq.processing", token=token)
    completed = await _count("task_queue", "&status=eq.completed", token=token)
    failed = await _count("task_queue", "&status=eq.failed", token=token)
    retrying = await _count("task_queue", "&status=eq.retrying", token=token)

    # Workflow stats
    active_workflows = await _count("workflows", "&status=eq.active", token=token)
    running_executions = await _count("workflow_executions", "&status=eq.running", token=token)
    completed_executions = await _count("workflow_executions", "&status=eq.completed", token=token)
    failed_executions = await _count("workflow_executions", "&status=eq.failed", token=token)

    # Approval stats
    pending_approvals = await _count("approval_requests", "&status=eq.pending", token=token)
    urgent_approvals = await _count("approval_requests", "&status=eq.pending&priority=eq.urgent", token=token)

    # Agent stats
    active_agents = await _count("ai_agents", "&is_active=eq.true", token=token)

    # Scheduled jobs
    active_jobs = await _count("scheduled_jobs", "&is_active=eq.true", token=token)

    # Recent executions
    recent_executions = await _select("workflow_executions", "id,workflow_id,trigger_type,status,started_at,completed_at,duration_ms,error_message", limit=10, order="created_at.desc", token=token)

    return {
        "task_queue": {
            "queued": queued,
            "processing": processing,
            "completed": completed,
            "failed": failed,
            "retrying": retrying,
            "total": queued + processing + completed + failed + retrying,
        },
        "workflows": {
            "active": active_workflows,
            "running_executions": running_executions,
            "completed_executions": completed_executions,
            "failed_executions": failed_executions,
        },
        "approvals": {
            "pending": pending_approvals,
            "urgent": urgent_approvals,
        },
        "agents": {
            "active": active_agents,
        },
        "scheduled_jobs": {
            "active": active_jobs,
        },
        "recent_executions": recent_executions,
    }
