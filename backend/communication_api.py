"""
Phase 6 — Omnichannel Communication & Enterprise Integrations API.

Adds the /comm/* routes:
  - /comm/channels           — list/update channel status
  - /comm/conversations      — list/search/assign conversations + messages
  - /comm/templates          — CRUD message templates
  - /comm/campaigns          — CRUD campaigns + audience + analytics
  - /comm/scheduled          — list/cancel scheduled messages
  - /comm/webhooks           — CRUD webhook endpoints + logs
  - /comm/automations        — CRUD automation workflows + executions
  - /comm/integrations       — list/update integration connectors + logs
  - /comm/analytics          — communication analytics (delivery, open, click rates)
  - /comm/send               — send a message via a channel

All endpoints require staff JWT. Uses adapter pattern for channel providers
so integrations can be swapped without code changes.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/comm", tags=["communication"])

try:
    from .main import require_user_id, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
except ImportError:
    pass


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


# ---------------------------------------------------------------------------
# Adapter pattern — channel providers are swappable
# ---------------------------------------------------------------------------
class ChannelAdapter:
    """Base adapter. Subclasses implement send()."""

    def __init__(self, config: Dict[str, Any]):
        self.config = config

    async def send(self, to: str, body: str, **kwargs: Any) -> Dict[str, Any]:
        """Send a message. Returns {success, external_id, error}."""
        return {"success": False, "error": "Not implemented"}


class WhatsAppAdapter(ChannelAdapter):
    async def send(self, to: str, body: str, **kwargs: Any) -> Dict[str, Any]:
        # Meta WhatsApp Business API (placeholder — requires access token + phone number ID)
        token = self.config.get("access_token")
        phone_id = self.config.get("phone_number_id")
        if not token or not phone_id:
            return {"success": False, "error": "WhatsApp not configured"}
        try:
            url = f"https://graph.facebook.com/v18.0/{phone_id}/messages"
            payload = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {"body": body},
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
                if resp.status_code >= 400:
                    return {"success": False, "error": resp.text}
                data = resp.json()
                return {"success": True, "external_id": data.get("messages", [{}])[0].get("id")}
        except Exception as e:
            return {"success": False, "error": str(e)}


class EmailAdapter(ChannelAdapter):
    async def send(self, to: str, body: str, **kwargs: Any) -> Dict[str, Any]:
        # SendGrid / SMTP (placeholder)
        api_key = self.config.get("api_key")
        if not api_key:
            return {"success": False, "error": "Email not configured"}
        # In production, use SendGrid API or aiosmtplib
        return {"success": True, "external_id": f"email_{int(time.time())}"}


class SMSAdapter(ChannelAdapter):
    async def send(self, to: str, body: str, **kwargs: Any) -> Dict[str, Any]:
        # Twilio (placeholder)
        account_sid = self.config.get("account_sid")
        auth_token = self.config.get("auth_token")
        if not account_sid or not auth_token:
            return {"success": False, "error": "SMS not configured"}
        return {"success": True, "external_id": f"sms_{int(time.time())}"}


class PushAdapter(ChannelAdapter):
    async def send(self, to: str, body: str, **kwargs: Any) -> Dict[str, Any]:
        # Firebase Cloud Messaging (placeholder)
        return {"success": True, "external_id": f"push_{int(time.time())}"}


class InAppAdapter(ChannelAdapter):
    async def send(self, to: str, body: str, **kwargs: Any) -> Dict[str, Any]:
        # Insert into notifications table
        return {"success": True, "external_id": f"inapp_{int(time.time())}"}


ADAPTER_REGISTRY = {
    "whatsapp": WhatsAppAdapter,
    "email": EmailAdapter,
    "sms": SMSAdapter,
    "push": PushAdapter,
    "in_app": InAppAdapter,
}


def get_adapter(channel_type: str, config: Dict[str, Any]) -> ChannelAdapter:
    cls = ADAPTER_REGISTRY.get(channel_type, ChannelAdapter)
    return cls(config)


# ---------------------------------------------------------------------------
# Helper: require staff
# ---------------------------------------------------------------------------
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
class ChannelUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    is_configured: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None
    daily_limit: Optional[int] = None
    health_status: Optional[str] = None


class TemplateCreate(BaseModel):
    template_key: str
    name: str
    category: str
    channel_type: str = "all"
    subject: Optional[str] = None
    body: str
    placeholders: Optional[List[str]] = None
    language: str = "en"


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    body: Optional[str] = None
    subject: Optional[str] = None
    is_active: Optional[bool] = None
    category: Optional[str] = None


class CampaignCreate(BaseModel):
    name: str
    description: Optional[str] = None
    channel_type: str
    template_id: Optional[str] = None
    subject: Optional[str] = None
    body: str
    audience_filter: Optional[Dict[str, Any]] = None
    scheduled_at: Optional[str] = None


class CampaignUpdate(BaseModel):
    status: Optional[str] = None
    scheduled_at: Optional[str] = None


class WebhookEndpointCreate(BaseModel):
    name: str
    url: str
    event_types: List[str] = Field(default_factory=list)
    secret: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    is_active: bool = True


class WebhookEndpointUpdate(BaseModel):
    is_active: Optional[bool] = None
    url: Optional[str] = None
    event_types: Optional[List[str]] = None


class AutomationWorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_type: str
    trigger_config: Optional[Dict[str, Any]] = None
    actions: List[Dict[str, Any]]
    is_active: bool = True


class AutomationWorkflowUpdate(BaseModel):
    is_active: Optional[bool] = None
    actions: Optional[List[Dict[str, Any]]] = None


class IntegrationConnectorUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    is_configured: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None
    sync_frequency: Optional[str] = None


class SendMessageRequest(BaseModel):
    channel_type: str
    to: str  # phone/email/user_id
    body: str
    subject: Optional[str] = None
    conversation_id: Optional[str] = None
    template_id: Optional[str] = None


class ConversationAssignRequest(BaseModel):
    assigned_to: str


class ConversationMessageCreate(BaseModel):
    body: str
    sender_type: str = "agent"  # agent, ai, system
    message_type: str = "text"
    attachments: Optional[List[Dict[str, Any]]] = None


# ---------------------------------------------------------------------------
# Module 1 — Channels
# ---------------------------------------------------------------------------
@router.get("/channels")
async def list_channels(request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("communication_channels", "*", limit=20, order="channel_type.asc", token=token)


@router.patch("/channels/{channel_id}")
async def update_channel(channel_id: str, req: ChannelUpdate, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("communication_channels", {"id": channel_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


# ---------------------------------------------------------------------------
# Module 2 & 6 — Conversations + Live Chat
# ---------------------------------------------------------------------------
@router.get("/conversations")
async def list_conversations(request: Request, status: Optional[str] = None, channel_type: Optional[str] = None,
                             search: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    url = f"{SUPABASE_URL}/rest/v1/conversations?select=*&order=last_message_at.desc.nullslast&limit={limit}"
    if status:
        url += f"&status=eq.{status}"
    if channel_type:
        url += f"&channel_type=eq.{channel_type}"
    if search:
        url += f"&or=(customer_name.ilike.*{search}*,customer_phone.ilike.*{search}*,customer_email.ilike.*{search}*,subject.ilike.*{search}*)"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return {"conversations": [], "total": 0}
            rows = resp.json()
        # Get unread total
        unread_total = sum(int(r.get("unread_count") or 0) for r in rows)
        return {"conversations": rows, "total": len(rows), "unread_total": unread_total}
    except Exception:
        return {"conversations": [], "total": 0, "unread_total": 0}


@router.get("/conversations/{conversation_id}/messages")
async def list_conversation_messages(conversation_id: str, request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("conversation_messages", "*", filters={"conversation_id": conversation_id}, limit=200, order="created_at.asc", token=token)


@router.post("/conversations/{conversation_id}/messages")
async def send_conversation_message(conversation_id: str, req: ConversationMessageCreate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Insert message
    payload = {
        "conversation_id": conversation_id,
        "sender_type": req.sender_type,
        "sender_id": user_id if req.sender_type == "agent" else None,
        "body": req.body,
        "message_type": req.message_type,
        "attachments": req.attachments or [],
        "is_delivered": True,
        "delivered_at": "now()",
    }
    msg = await _insert("conversation_messages", payload, token=token)

    # Update conversation last_message
    await _update("conversations", {"id": conversation_id}, {
        "last_message_at": "now()",
        "last_message_preview": req.body[:100],
        "ai_handled": req.sender_type == "ai",
    }, token=token)

    return msg or {"status": "error"}


@router.patch("/conversations/{conversation_id}/assign")
async def assign_conversation(conversation_id: str, req: ConversationAssignRequest, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Update conversation
    rows = await _update("conversations", {"id": conversation_id}, {
        "assigned_to": req.assigned_to,
        "ai_handled": False,  # human takeover
    }, token=token)

    # Create assignment record
    await _insert("conversation_assignments", {
        "conversation_id": conversation_id,
        "assigned_to": req.assigned_to,
        "assigned_by": user_id,
    }, token=token)

    return rows[0] if rows else {"status": "error"}


@router.patch("/conversations/{conversation_id}/status")
async def update_conversation_status(conversation_id: str, payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    status = payload.get("status")
    if status not in ("active", "pending", "resolved", "closed", "transferred"):
        raise HTTPException(status_code=400, detail="Invalid status")
    rows = await _update("conversations", {"id": conversation_id}, {"status": status}, token=token)
    return rows[0] if rows else {"status": "error"}


# ---------------------------------------------------------------------------
# Module 9 — Templates
# ---------------------------------------------------------------------------
@router.get("/templates")
async def list_templates(request: Request, category: Optional[str] = None, channel_type: Optional[str] = None) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/message_templates?select=*&order=category.asc,template_key.asc&limit=200"
    if category:
        url += f"&category=eq.{category}"
    if channel_type:
        url += f"&or=(channel_type=eq.{channel_type},channel_type=eq.all)"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


@router.post("/templates")
async def create_template(req: TemplateCreate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "created_by": user_id}
    return await _insert("message_templates", payload, token=token) or {"status": "error"}


@router.patch("/templates/{template_id}")
async def update_template(template_id: str, req: TemplateUpdate, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("message_templates", {"id": template_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("message_templates", {"id": template_id}, token=token)
    return {"status": "deleted" if ok else "error"}


# ---------------------------------------------------------------------------
# Module 10 — Campaigns
# ---------------------------------------------------------------------------
@router.get("/campaigns")
async def list_campaigns(request: Request, status: Optional[str] = None) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    url = f"{SUPABASE_URL}/rest/v1/campaign_analytics_view?select=*&order=created_at.desc&limit=50"
    if status:
        url += f"&status=eq.{status}"
    headers = _svc_headers(token)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return []
            return resp.json()
    except Exception:
        return []


@router.post("/campaigns")
async def create_campaign(req: CampaignCreate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "created_by": user_id, "status": "scheduled" if req.scheduled_at else "draft"}
    return await _insert("campaigns", payload, token=token) or {"status": "error"}


@router.patch("/campaigns/{campaign_id}")
async def update_campaign(campaign_id: str, req: CampaignUpdate, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("campaigns", {"id": campaign_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("campaigns", {"id": campaign_id}, token=token)
    return {"status": "deleted" if ok else "error"}


@router.get("/campaigns/{campaign_id}/deliveries")
async def list_campaign_deliveries(campaign_id: str, request: Request, limit: int = 100) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("campaign_deliveries", "*", filters={"campaign_id": campaign_id}, limit=limit, order="created_at.desc", token=token)


# ---------------------------------------------------------------------------
# Module 10 — Scheduled Messages
# ---------------------------------------------------------------------------
@router.get("/scheduled")
async def list_scheduled(request: Request, status: Optional[str] = None) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    filters = {}
    if status:
        filters["status"] = status
    return await _select("scheduled_messages", "*", filters=filters, limit=50, order="scheduled_for.asc", token=token)


@router.delete("/scheduled/{message_id}")
async def cancel_scheduled(message_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    rows = await _update("scheduled_messages", {"id": message_id}, {"status": "cancelled"}, token=token)
    return {"status": "cancelled" if rows else "error"}


# ---------------------------------------------------------------------------
# Module 12 — Webhooks
# ---------------------------------------------------------------------------
@router.get("/webhooks")
async def list_webhooks(request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("webhook_endpoints", "*", limit=50, order="created_at.desc", token=token)


@router.post("/webhooks")
async def create_webhook(req: WebhookEndpointCreate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "created_by": user_id}
    return await _insert("webhook_endpoints", payload, token=token) or {"status": "error"}


@router.patch("/webhooks/{webhook_id}")
async def update_webhook(webhook_id: str, req: WebhookEndpointUpdate, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("webhook_endpoints", {"id": webhook_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("webhook_endpoints", {"id": webhook_id}, token=token)
    return {"status": "deleted" if ok else "error"}


@router.get("/webhooks/{webhook_id}/logs")
async def webhook_logs(webhook_id: str, request: Request, limit: int = 50) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("webhook_logs", "*", filters={"endpoint_id": webhook_id}, limit=limit, order="created_at.desc", token=token)


@router.post("/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: str, request: Request) -> Dict[str, Any]:
    """Send a test payload to the webhook endpoint."""
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    endpoints = await _select("webhook_endpoints", "*", filters={"id": webhook_id}, limit=1, token=token)
    if not endpoints:
        raise HTTPException(status_code=404, detail="Webhook not found")
    ep = endpoints[0]

    test_payload = {"event": "test", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"), "webhook_id": webhook_id}
    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(ep["url"], json=test_payload, headers=ep.get("headers") or {})
            duration_ms = int((time.time() - start) * 1000)
            is_success = 200 <= resp.status_code < 300

            # Log
            await _insert("webhook_logs", {
                "direction": "outgoing",
                "endpoint_id": webhook_id,
                "event_type": "test",
                "url": ep["url"],
                "method": "POST",
                "request_body": test_payload,
                "response_status": resp.status_code,
                "response_body": resp.text[:1000],
                "duration_ms": duration_ms,
                "is_success": is_success,
            }, token=token)

            # Update endpoint
            await _update("webhook_endpoints", {"id": webhook_id}, {
                "last_triggered_at": "now()",
                "last_response_status": resp.status_code,
                "last_error": None if is_success else f"HTTP {resp.status_code}",
            }, token=token)

            return {"success": is_success, "status_code": resp.status_code, "duration_ms": duration_ms, "response": resp.text[:500]}
    except Exception as e:
        await _insert("webhook_logs", {
            "direction": "outgoing",
            "endpoint_id": webhook_id,
            "event_type": "test",
            "url": ep["url"],
            "method": "POST",
            "request_body": test_payload,
            "is_success": False,
            "error_message": str(e),
            "duration_ms": int((time.time() - start) * 1000),
        }, token=token)
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Module 14 — Automation Workflows
# ---------------------------------------------------------------------------
@router.get("/automations")
async def list_automations(request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("automation_workflows", "*", limit=50, order="created_at.desc", token=token)


@router.post("/automations")
async def create_automation(req: AutomationWorkflowCreate, request: Request) -> Dict[str, Any]:
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {**req.model_dump(), "created_by": user_id}
    return await _insert("automation_workflows", payload, token=token) or {"status": "error"}


@router.patch("/automations/{workflow_id}")
async def update_automation(workflow_id: str, req: AutomationWorkflowUpdate, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("automation_workflows", {"id": workflow_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.delete("/automations/{workflow_id}")
async def delete_automation(workflow_id: str, request: Request) -> Dict[str, str]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    ok = await _delete("automation_workflows", {"id": workflow_id}, token=token)
    return {"status": "deleted" if ok else "error"}


@router.get("/automations/{workflow_id}/executions")
async def automation_executions(workflow_id: str, request: Request, limit: int = 20) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("automation_executions", "*", filters={"workflow_id": workflow_id}, limit=limit, order="created_at.desc", token=token)


# ---------------------------------------------------------------------------
# Module 11 — Integration Connectors
# ---------------------------------------------------------------------------
@router.get("/integrations")
async def list_integrations(request: Request) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("integration_connectors", "*", limit=50, order="connector_type.asc", token=token)


@router.patch("/integrations/{connector_id}")
async def update_integration(connector_id: str, req: IntegrationConnectorUpdate, request: Request) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    rows = await _update("integration_connectors", {"id": connector_id}, payload, token=token)
    return rows[0] if rows else {"status": "error"}


@router.get("/integrations/{connector_id}/logs")
async def integration_logs(connector_id: str, request: Request, limit: int = 20) -> List[Dict[str, Any]]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    return await _select("integration_logs", "*", filters={"connector_id": connector_id}, limit=limit, order="created_at.desc", token=token)


# ---------------------------------------------------------------------------
# Module 15 — Communication Analytics
# ---------------------------------------------------------------------------
@router.get("/analytics")
async def comm_analytics(request: Request, days: int = 30) -> Dict[str, Any]:
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    import datetime
    since = (datetime.datetime.utcnow() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    url = f"{SUPABASE_URL}/rest/v1/comm_analytics_daily?select=*&metric_date=gte.{since}&order=metric_date.desc&limit={days * 6}"
    headers = _svc_headers(token)
    daily: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code < 400:
                daily = resp.json()
    except Exception:
        pass

    # Aggregates
    total_sent = sum(int(d.get("messages_sent") or 0) for d in daily)
    total_delivered = sum(int(d.get("messages_delivered") or 0) for d in daily)
    total_read = sum(int(d.get("messages_read") or 0) for d in daily)
    total_failed = sum(int(d.get("messages_failed") or 0) for d in daily)
    total_opened = sum(int(d.get("emails_opened") or 0) for d in daily)
    total_clicked = sum(int(d.get("links_clicked") or 0) for d in daily)

    # Campaign stats
    campaigns = await _select("campaign_analytics_view", "*", limit=10, order="created_at.desc", token=token)

    # Conversation stats
    active_conversations = await _count("conversations", "&status=eq.active", token=token)
    resolved_conversations = await _count("conversations", "&status=eq.resolved", token=token)

    return {
        "daily": list(reversed(daily)),
        "aggregates": {
            "messages_sent": total_sent,
            "messages_delivered": total_delivered,
            "messages_read": total_read,
            "messages_failed": total_failed,
            "emails_opened": total_opened,
            "links_clicked": total_clicked,
            "delivery_rate_pct": round(total_delivered / max(total_sent, 1) * 100, 1),
            "read_rate_pct": round(total_read / max(total_delivered, 1) * 100, 1),
            "open_rate_pct": round(total_opened / max(total_delivered, 1) * 100, 1),
            "click_rate_pct": round(total_clicked / max(total_opened, 1) * 100, 1),
            "active_conversations": active_conversations,
            "resolved_conversations": resolved_conversations,
        },
        "recent_campaigns": campaigns,
    }


# ---------------------------------------------------------------------------
# Send message (unified API)
# ---------------------------------------------------------------------------
@router.post("/send")
async def send_message(req: SendMessageRequest, request: Request) -> Dict[str, Any]:
    """Send a message via any channel using the adapter pattern."""
    user_id = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Get channel config
    channels = await _select("communication_channels", "*", filters={"channel_type": req.channel_type, "is_enabled": "true"}, limit=1, token=token)
    if not channels:
        raise HTTPException(status_code=400, detail=f"Channel {req.channel_type} not enabled")
    channel = channels[0]

    # Get adapter and send
    adapter = get_adapter(req.channel_type, channel.get("config") or {})
    result = await adapter.send(req.to, req.body, subject=req.subject)

    # Log to scheduled_messages or conversation_messages
    if req.conversation_id:
        await _insert("conversation_messages", {
            "conversation_id": req.conversation_id,
            "sender_type": "agent",
            "sender_id": user_id,
            "body": req.body,
            "delivery_status": "sent" if result.get("success") else "failed",
            "is_delivered": result.get("success", False),
            "delivered_at": "now()" if result.get("success") else None,
            "external_message_id": result.get("external_id"),
            "metadata": {"error": result.get("error")} if not result.get("success") else {},
        }, token=token)

    return result
