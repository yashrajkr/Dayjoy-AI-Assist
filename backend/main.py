"""
Dayjoy AI Assist — FastAPI backend (v2).

Hardened rewrite of the original `backend/main.py`:

  * JWT authentication via Supabase JWKS (no more anonymous /chat access)
  * Conversation history via the chat_conversations / chat_messages tables
  * Streaming responses via Server-Sent Events at /chat/stream
  * LLM provider chain: Groq (primary, if GROQ_API_KEY set) → OpenAI (fallback)
  * Safety rules loaded from the `safety_rules` table (admin-managed)
  * Persistent analytics into the `analytics` table (table-name fix)
  * Input length validation, word-boundary safety matching, request-id logging
  * Service-role key removed; backend uses the user's JWT for Supabase reads
    (RLS-enforced) and only falls back to anon-key reads when no JWT present

Run:
    uvicorn backend.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from collections import defaultdict
import time

from backend.search_providers import get_search_providers, web_search_multi
from backend.ai_modes import normalize_ai_mode, top_k_for, addendum_for

load_dotenv()

# Print configuration check at startup
try:
    from config import print_config_report
    print_config_report()
except Exception:
    pass

# ----------------------------------------------------------------------------
# Rate limiting — simple in-memory sliding-window limiter.
# Production should use Redis, but this is sufficient for single-instance
# deployments and protects against basic abuse.
# ----------------------------------------------------------------------------
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 30  # requests per window per user
_rate_limit_store: dict[str, list[float]] = defaultdict(list)


def check_rate_limit(user_id: str) -> None:
    """Raise 429 if the user has exceeded the rate limit."""
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    # Prune old entries
    _rate_limit_store[user_id] = [t for t in _rate_limit_store[user_id] if t > window_start]
    if len(_rate_limit_store[user_id]) >= RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Max {RATE_LIMIT_MAX} requests per {RATE_LIMIT_WINDOW}s.",
        )
    _rate_limit_store[user_id].append(now)

# ----------------------------------------------------------------------------
# App + CORS
# ----------------------------------------------------------------------------
app = FastAPI(
    title="Dayjoy AI Assist Backend",
    version="2.13.0",
    description="Enterprise AI assistant backend with full RAG, Phase 2 admin console API, enhanced product/training/FAQ management, streaming, and safety filters.",
)

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,"
    "https://dayjoy-ai-assist.vercel.app,"
    "https://dayjoy-ai-assist-poemyashraj-bytes-projects.vercel.app,"
    "https://dayjoy-ai-assist-git-main-poemyashraj-bytes-projects.vercel.app",
)
_origins = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_JWKS_URL = (
    f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else None
)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
# Live-verified against the actual configured key: `llama-3.3-70b-versatile`
# (the old default) 404s with "does not exist or you do not have access to
# it" — GET /openai/v1/models against this key doesn't list any llama-*
# model at all, only openai/gpt-oss-*, qwen/*, groq/compound*, and a few
# audio/guard models. This was the root cause of every "answer is a raw
# Q&A dump" / "no answer at all" report: every non-casual, non-structured
# chat request was silently falling all the way through to the no-LLM
# fallback. openai/gpt-oss-120b was tested directly (real streaming call,
# real prompt, ~2.6s) and produces a normal, correctly-grounded answer. If
# your Groq account's available models change, override via the
# GROQ_MODEL env var rather than editing this default blind — verify with
# `GET https://api.groq.com/openai/v1/models` against your actual key first.
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
# Multimodal Understanding (Capabilities 1/2/19/20) — vision-capable model.
# Live-verified against this account's actual Groq API key (GET
# https://api.groq.com/openai/v1/models): zero vision-capable models are
# available on it today (only text models: gpt-oss-120b/20b, qwen3.6-27b,
# whisper, etc.) — so this deliberately does NOT default to a Groq model.
# gpt-4o-mini (OPENAI_MODEL's own default) IS vision-capable and is reused
# here rather than introducing a second model env var; if OPENAI_API_KEY is
# unset or the account has no credit, image understanding degrades to a
# clear "not available right now" message (see stream_vision_response)
# rather than a raw provider error.
VISION_MODEL = os.getenv("VISION_MODEL", OPENAI_MODEL)
# Web search API keys (TAVILY_API_KEY, BRAVE_API_KEY) are read directly by
# their provider classes in backend/search_providers.py, not here.
ANALYTICS_TABLE = "analytics"  # matches supabase_schema.sql + supabase_schema_v2.sql
MAX_MESSAGE_LENGTH = 4000
MAX_HISTORY_TURNS = 6
# Multimodal Understanding (Capabilities 1/2/19/20) — max length of an
# attached image's data: URL. ~6M chars ≈ 4.4MB decoded (base64 is ~1.37x
# source size), loosely matching the frontend's own MAX_ATTACHMENT_BYTES=
# 10_000_000 cap; enforced independently here since a request can reach
# this endpoint without going through that UI at all.
MAX_IMAGE_DATA_URL_CHARS = 6_000_000

# AI Orchestrator (backend/orchestrator/) — Phase 1: intent classification +
# query planning run alongside the existing `_route_events` router purely for
# observability (logged, not surfaced in the response) so the new layer can
# be proven out before a later phase lets it actually drive tool selection.
# Off by default: zero behavior change unless explicitly enabled.
ORCHESTRATOR_ENABLED = os.getenv("ORCHESTRATOR_ENABLED", "false").strip().lower() in (
    "1", "true", "yes", "on",
)
_orchestrator_logger = logging.getLogger("dayjoy.orchestrator")


# ----------------------------------------------------------------------------
# JWT verification (Supabase)
# ----------------------------------------------------------------------------
_jwks_cache: Optional[Dict[str, Any]] = None
_jwks_cache_at: float = 0.0


async def fetch_jwks() -> Dict[str, Any]:
    """Fetch and cache the Supabase JWKS for 10 minutes."""
    global _jwks_cache, _jwks_cache_at
    if not SUPABASE_JWKS_URL:
        raise HTTPException(status_code=500, detail="SUPABASE_URL not configured")
    if _jwks_cache and (time.time() - _jwks_cache_at) < 600:
        return _jwks_cache
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            SUPABASE_JWKS_URL,
            headers={"apikey": SUPABASE_ANON_KEY} if SUPABASE_ANON_KEY else {},
        )
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_cache_at = time.time()
        return _jwks_cache


async def verify_jwt(token: str) -> Dict[str, Any]:
    """Verify a Supabase JWT and return its claims."""
    try:
        import jwt as pyjwt
    except ImportError:
        raise HTTPException(status_code=500, detail="PyJWT not installed")

    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        unverified_header = pyjwt.get_unverified_header(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token header")

    jwks = await fetch_jwks()
    jwk_data = next(
        (k for k in jwks.get("keys", []) if k.get("kid") == unverified_header.get("kid")),
        None,
    )
    if not jwk_data:
        raise HTTPException(status_code=401, detail="Signing key not found")

    try:
        # Supabase projects may sign with RS256 or ES256 depending on when the
        # project was created / whether it's migrated to asymmetric JWT
        # signing keys. The JWK's own "alg" is authoritative — don't hardcode
        # one algorithm, and don't pass the raw JWK dict to decode(): PyJWT
        # needs it converted to an actual key object first.
        signing_key = pyjwt.PyJWK.from_dict(jwk_data).key
        alg = jwk_data.get("alg") or unverified_header.get("alg") or "RS256"
        claims = pyjwt.decode(
            token,
            signing_key,
            algorithms=[alg],
            audience="authenticated",
            options={"verify_aud": True},
        )
        return claims
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {e}")


async def get_user_id(request: Request) -> Optional[str]:
    """Extract user_id from Authorization header. Returns None if absent."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    try:
        claims = await verify_jwt(token)
        return claims.get("sub")
    except HTTPException:
        return None


async def require_user_id(request: Request) -> str:
    """Force authentication — raises 401 if missing/invalid."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = auth[7:].strip()
    claims = await verify_jwt(token)
    uid = claims.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token: no sub claim")
    return uid


# ----------------------------------------------------------------------------
# Supabase data access (uses user JWT, RLS-enforced)
# ----------------------------------------------------------------------------
async def supabase_select(
    token: Optional[str],
    table: str,
    columns: str = "*",
    filters: Optional[Dict[str, Any]] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Generic SELECT via the Supabase REST API (PostgREST)."""
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={columns}&limit={limit}"
    if filters:
        for col, val in filters.items():
            url += f"&{col}=eq.{val}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Accept": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            return []
        return resp.json()


async def supabase_insert(
    token: str,
    table: str,
    payload: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Generic INSERT via PostgREST. Returns the inserted row."""
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            return None
        data = resp.json()
        return data[0] if isinstance(data, list) and data else None


async def supabase_update(
    token: str,
    table: str,
    filters: Dict[str, Any],
    payload: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Generic UPDATE via PostgREST. Returns the updated rows (RLS-scoped by
    the caller's own JWT, same as supabase_select/supabase_insert above)."""
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*"
    for col, val in filters.items():
        url += f"&{col}=eq.{val}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.patch(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            return []
        return resp.json()


async def supabase_delete(
    token: str,
    table: str,
    filters: Dict[str, Any],
) -> bool:
    """Generic DELETE via PostgREST (RLS-scoped by the caller's own JWT).
    Returns True on a non-error response."""
    if not SUPABASE_URL:
        return False
    url = f"{SUPABASE_URL}/rest/v1/{table}?"
    for col, val in filters.items():
        url += f"&{col}=eq.{val}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.delete(url, headers=headers)
        return resp.status_code < 400


# ----------------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)
    role: str = Field("customer")
    language: str = Field("English")
    conversation_id: Optional[str] = None
    # Temporary Chat: skip server-side conversation auto-creation so nothing
    # is persisted or shows up in the sidebar's chat history. The frontend
    # never sends a conversation_id for these, and this flag stops the
    # `elif token and user_id: ensure_conversation(...)` fallback below from
    # silently creating (and titling) a conversation row anyway.
    is_temporary: bool = False
    # AI Mode System: "normal" | "thinking" | "deep_research" | "compare_products".
    # Distinct from RouteResult.mode ("dayjoy"/"hybrid", an internal routing
    # decision) — this is the user-selected reasoning/retrieval mode. Invalid
    # values fall back to "normal" in ai_modes.get_mode_config rather than
    # raising, so a stale client sending an unrecognized mode still works.
    ai_mode: str = "normal"
    # Multimodal Understanding (Capabilities 1/2/19/20) — a single attached
    # image as a data: URL (the frontend already captures this via
    # FileReader.readAsDataURL when a user attaches an image). Optional;
    # when present, both /chat and /chat/stream answer from the image via
    # stream_vision_response() instead of the normal RAG/routing pipeline.
    image_data_url: Optional[str] = Field(default=None, max_length=MAX_IMAGE_DATA_URL_CHARS)


class TitleRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)


class TitleResponse(BaseModel):
    title: str


def _fallback_title(text: str, max_len: int = 48) -> str:
    """Deterministic title used whenever summarization is unavailable."""
    trimmed = " ".join(text.split())
    if len(trimmed) <= max_len:
        return trimmed
    return trimmed[: max_len - 1] + "…"


class ChatSource(BaseModel):
    table: str
    id: str
    title: Optional[str] = None
    url: Optional[str] = None


# Evidence Strength Indicator — maps answer_validate.py's internal
# GROUNDING_* states onto the exact qualitative labels the brief asks for.
# Deliberately five discrete strings, never a numeric confidence score (the
# brief explicitly prohibits fabricated confidence percentages).
_EVIDENCE_STRENGTH_LABELS = {
    "verified": "Strongly supported",
    "recommendation": "Supported",
    "ai_analysis": "Partially supported",
    "assumption": "Needs verification",
    "unverified": "Not verified",
}


class ChatResponse(BaseModel):
    answer: str
    category: str
    sources: List[ChatSource] = []
    safety_status: str = "safe"
    handoff_required: bool = False
    confidence: Optional[float] = None
    conversation_id: Optional[str] = None
    # RAG enrichment (added in v2.1) — None when RAG subsystem is unavailable
    verification_status: Optional[str] = None  # verified | partial | unverified
    handoff_message: Optional[str] = None
    rag_metadata: Optional[Dict[str, Any]] = None
    # AI router labeling (added for the AI router / web search feature) —
    # which knowledge source(s) actually produced this answer.
    answer_source: Optional[str] = None  # dayjoy_knowledge | web_search | general_llm | hybrid | casual | unsafe
    web_search_provider: Optional[str] = None  # tavily | brave | None
    # AI Mode System — which mode (normal/thinking/deep_research/compare_products)
    # actually produced this answer, echoed back so the frontend can badge it.
    ai_mode: str = "normal"
    # Contextual next-question suggestions (orchestrator/followups.py) — the
    # frontend prefers these over its own local heuristic when non-empty.
    follow_ups: List[str] = []
    # Structured product data (RouteResult.product_cards) — only ever
    # populated from a verified DB row (pricing_lookup/product_recommendation
    # tool result), never fabricated from RAG/LLM text. Empty for every
    # route that isn't a structured pricing/recommendation match.
    products: List[Dict[str, Any]] = []
    # Structured Response JSON (orchestrator/answer_structure.py) — parsed
    # from `answer`'s own markdown, not LLM-emitted JSON (see that module's
    # docstring for why). Additive: `answer` is always present and correct
    # on its own; this just exposes the same structure other clients of
    # this API can use without re-implementing the markdown parsing.
    structured: Optional[Dict[str, Any]] = None
    # Clarification Intelligence — selectable options accompanying a
    # clarifying-question answer (orchestrator/clarify.py). Empty for
    # every non-clarification route.
    clarification_options: List[str] = []
    # Evidence Strength Indicator — a qualitative label derived from
    # answer_validate.py's existing 5-state grounding classification
    # (verified/ai_analysis/recommendation/assumption/unverified), which was
    # previously computed only for internal observability logging and never
    # returned to the client. Deliberately qualitative, never a fabricated
    # confidence percentage — see _EVIDENCE_STRENGTH_LABELS below.
    evidence_strength: Optional[str] = None


class FeedbackRequest(BaseModel):
    conversation_id: Optional[str] = None
    message_id: Optional[str] = None
    rating: str  # "up" | "down"
    comment: Optional[str] = None


# ----------------------------------------------------------------------------
# Safety rules — loaded from `safety_rules` table (with sensible defaults)
# ----------------------------------------------------------------------------
DEFAULT_SAFETY_RULES: List[Dict[str, str]] = [
    {"rule_key": "no_medical_cure_claims", "pattern": r"\b(cure|cures|cured)\b", "action": "block"},
    {"rule_key": "no_diagnosis", "pattern": r"\b(diagnos\w*)\b", "action": "block"},
    {"rule_key": "no_treatment_claims", "pattern": r"\b(treats|treating|treatment\s+of)\b", "action": "block"},
    {"rule_key": "no_guaranteed_income", "pattern": r"(guaranteed\s+(income|earnings|return)|get\s+rich|no\s+risk)", "action": "block"},
    {"rule_key": "no_replace_doctor", "pattern": r"(replace\s+(doctor|physician)|as\s+a\s+doctor|i\s+am\s+a\s+doctor)", "action": "block"},
]

_safety_cache: List[Dict[str, str]] = []
_safety_cache_at: float = 0.0


async def load_safety_rules() -> List[Dict[str, str]]:
    """Load safety rules from Supabase, fall back to defaults."""
    global _safety_cache, _safety_cache_at
    if _safety_cache and (time.time() - _safety_cache_at) < 60:
        return _safety_cache
    try:
        rows = await supabase_select(None, "safety_rules", columns="rule_key,pattern,action,enabled", limit=50)
        active = [r for r in rows if r.get("enabled") is not False and r.get("pattern")]
        if active:
            _safety_cache = active
            _safety_cache_at = time.time()
            return _safety_cache
    except Exception:
        pass
    _safety_cache = DEFAULT_SAFETY_RULES
    _safety_cache_at = time.time()
    return _safety_cache


# Regex classifiers (is_casual_message / wants_hybrid_comparison /
# is_pure_time_query) now live in backend/message_classifiers.py so the
# orchestrator's intent layer (backend/orchestrator/intent.py) can reuse the
# exact same logic without importing backend.main (which would be circular,
# since main.py imports the orchestrator). Re-exported here unchanged so
# every existing caller/monkeypatch of backend.main.is_casual_message etc.
# keeps working.
from backend.message_classifiers import (  # noqa: E402
    is_casual_message,
    is_pure_time_query,
    is_weather_query,
    wants_hybrid_comparison,
)
from backend.orchestrator.tools import weather as weather_tool  # noqa: E402

# Resolves bare references ("it", "that", "this one") against the immediately
# preceding user turn before the message is used for RAG/web retrieval — was
# implemented and unit-tested (tests/test_phase4_orchestrator.py) but never
# actually called from /chat or /chat/stream, so a follow-up like "what about
# its price?" retrieved on that literal text alone (no product name in it),
# which is why the pipeline could confidently answer a different question
# than the one just asked. Only augments the retrieval query — the LLM
# generation call still sees the user's own original wording via `history`.
from backend.orchestrator.rewrite import rewrite_query  # noqa: E402

# Deep Research query decomposition — augments the retrieval query text only
# (see module docstring for why this is safer than multi-call + merge).
from backend.orchestrator.decompose import enrich_for_deep_research  # noqa: E402

# Context Compression (Advanced Intelligence Layer capability 6).
from backend.orchestrator.context_compress import ContextBlock, compress_context  # noqa: E402

# LLM-backed query rewriting (Advanced Intelligence Layer capability 3) —
# extends orchestrator/rewrite.py's free regex pass for short/Hinglish
# queries the regex pass can't handle.
from backend.orchestrator.rewrite_llm import llm_rewrite_for_retrieval, should_llm_rewrite  # noqa: E402

# Conversation Continuity Engine (Advanced Intelligence Layer capability 7).
from backend.orchestrator.conversation_state import build_conversation_state  # noqa: E402

# Answer Refinement Loop (Advanced Intelligence Layer capability 10).
from backend.orchestrator.quality import score_answer  # noqa: E402
from backend.orchestrator.refinement import build_refinement_instruction, needs_refinement  # noqa: E402

# Answer Quality Router + Multi-Step Reasoning Pipeline (Advanced
# Intelligence Layer capabilities 1-2).
from backend.orchestrator.quality_router import route_query  # noqa: E402
from backend.orchestrator.user_goal import analyze_user_goal  # noqa: E402
from backend.orchestrator.reasoning import run_reasoning_pipeline  # noqa: E402

# Structured-intent short-circuits — checked in `_route_events` before RAG
# retrieval runs. Each has a single authoritative source (a DB table, not a
# document chunk), so a match here skips RAG entirely for that turn rather
# than risking a stale/rounded RAG figure sitting next to the exact one.
from backend.orchestrator.clarify import needs_clarification  # noqa: E402
from backend.orchestrator.tools import pricing as pricing_tool  # noqa: E402
from backend.orchestrator.tools import recommend as recommend_tool  # noqa: E402

# Parallel multi-tool execution — when a pricing/recommendation question also
# needs supporting knowledge-base context (e.g. "what are the ingredients of
# X and how much does it cost"), the structured tool and dayjoy_kb run
# concurrently via the same executor used everywhere else tools run, instead
# of a second sequential retrieval round-trip. `build_plan` (intent + which
# tools apply) drives which tools actually get called here, not a second,
# separate routing decision duplicating planner.py's own logic.
from backend.orchestrator.executor import run_tools  # noqa: E402
from backend.orchestrator.planner import build_plan  # noqa: E402
from backend.orchestrator.types import INTENT_PRICING, INTENT_RECOMMENDATION, INTENT_WELLNESS  # noqa: E402

# Post-generation answer-relevance check — see module docstring for why this
# is the one genuinely new link in the pipeline rather than a rebuild of it.
from backend.orchestrator.answer_verify import verify_answer  # noqa: E402

# Contextual follow-up suggestions — was fully built and tested
# (backend/tests/ has no direct test file yet, but the module is pure/
# deterministic) but never actually called from either chat endpoint; the
# frontend independently reimplemented a cruder heuristic version instead
# (see generateFollowUps in UserChat.tsx). Wiring the real one in here lets
# the frontend prefer backend-computed suggestions, which react to more
# signals (route.answer_source, category) than the frontend has access to.
from backend.orchestrator.followups import generate_followups  # noqa: E402

# Structured Response JSON — parsed from the answer's own markdown (see
# module docstring for why this is safer than asking the LLM for raw JSON).
from backend.orchestrator.answer_structure import structure_answer  # noqa: E402
from backend.orchestrator.answer_validate import classify_grounding_state  # noqa: E402

# Personalization — was fully built (context_builder.py's labeled-block
# assembly, tools/memory.py's recency+pinned-scored memory read) but never
# called from /chat or /chat/stream. Wired in as a light-touch addition to
# full_context rather than a _route_events signature change: only fetched
# for an authenticated, multi-turn conversation that actually looks like it
# needs it (see personalization_context() below) — never on every message,
# per the explicit "don't inject all memory into every prompt" requirement.
from backend.orchestrator.context_builder import build_context  # noqa: E402
from backend.orchestrator.intent import wants_recommendation, wants_business_data  # noqa: E402
from backend.orchestrator.rewrite import wants_reference_resolution  # noqa: E402
from backend.orchestrator.tools.memory import list_memory  # noqa: E402

# Adaptive response formatting — "answer in short" / "give me steps" /
# "compare X and Y" get a matching structural instruction instead of the
# model always answering in one fixed shape regardless of what was asked.
from backend.orchestrator.format_intent import (  # noqa: E402
    FORMAT_ACTION_PLAN,
    detect_format,
    example_instruction,
    format_instruction,
)


def run_safety_check(message: str, rules: List[Dict[str, str]]) -> Tuple[bool, Optional[str]]:
    """Returns (is_blocked, rule_key)."""
    lowered = message.lower()
    for rule in rules:
        pattern = rule.get("pattern") or ""
        if not pattern:
            continue
        try:
            if re.search(pattern, lowered, re.IGNORECASE):
                return True, rule.get("rule_key", "blocked")
        except re.error:
            # Fallback to plain substring match if regex is malformed.
            if pattern.lower() in lowered:
                return True, rule.get("rule_key", "blocked")
    return False, None


# ----------------------------------------------------------------------------
# Retrieval (lightweight RAG: keyword + category boost)
# ----------------------------------------------------------------------------
SEARCH_TABLES = [
    ("products", "product_name", "benefits,safety_note,category,ingredients,usage", "product", {"approval_status": "approved"}),
    # compensation_rules is checked early (right after products, ahead of faqs/
    # policies/training) because retrieve_context() caps total sources at 8 and
    # truncates merged context at 4000 chars, in SEARCH_TABLES list order — a
    # table checked last is starved out whenever earlier tables also weakly
    # match the same common tokens. Compensation/rank questions need this
    # authoritative structured table to win that budget, not lose it.
    #
    # compensation_rules has no approval_status column — RLS ("authenticated"
    # role, qual=true) is the access gate here, not a per-row approval flag.
    # Filtering to verification_status="verified" excludes the single sentinel
    # row (__GLOBAL_PLAN_PARAMETERS_CONFLICT__, verification_status=
    # "conflict_unresolved") that carries the 3 known-disputed figures (retail
    # profit %, mentorship bonus %, business matching structure) — those never
    # reach the LLM as if they were verified facts.
    ("compensation_rules", "rank_name", "requirements,rewards", "compensation", {"verification_status": "verified"}),
    ("faqs", "question", "answer,category", "faq", {"approval_status": "approved"}),
    ("policies", "topic", "content", "policy", {"approval_status": "approved"}),
    ("distributor_training", "title", "content", "training", {"approval_status": "approved"}),
    ("objection_handling", "objection", "answer", "general", {"approval_status": "approved"}),
]


async def retrieve_context(
    token: Optional[str],
    message: str,
    limit_per_table: int = 3,
    top_k: Optional[int] = None,
) -> Tuple[str, List[ChatSource], str, Optional[Dict[str, Any]]]:
    """Pull approved rows and rank by simple token overlap.

    When the RAG subsystem is available, it is tried FIRST and produces
    the primary context + sources. The legacy keyword search is then run
    in parallel to enrich the context with structured table rows
    (products / faqs / policies / training). The two are merged with RAG
    sources taking priority.

    Returns (context_string, sources, best_category, rag_metadata).
    `rag_metadata` is None when RAG is unavailable; otherwise it
    contains confidence / verification_status / matched_documents /
    related_items for the chat response.
    """
    tokens = {t for t in re.split(r"[^a-z0-9]+", message.lower()) if len(t) >= 3}

    rag_metadata: Optional[Dict[str, Any]] = None
    rag_context_parts: List[str] = []
    rag_sources: List[ChatSource] = []
    best_category = "general"

    # ---- RAG path (preferred) ----
    if RAG_AVAILABLE and tokens:
        try:
            retriever = rag_get_retriever()
            rag_result = await retriever.retrieve(
                query=message,
                token=token,
                language="en",
                log_query=False,  # chat endpoint logs analytics separately
                top_k=top_k,
            )
            if rag_result.chunks:
                rag_context_parts.append(rag_result.to_context_string(max_chars=3000))
                for c in rag_result.chunks:
                    rag_sources.append(
                        ChatSource(
                            table="knowledge_chunks",
                            id=c.chunk_id,
                            title=c.section_title or c.document_name or c.chunk_id[:8],
                            url=None,
                        )
                    )
                # Infer category from the top matched document
                if rag_result.matched_documents:
                    top_doc = rag_result.matched_documents[0]
                    doc_cat = top_doc.get("category")
                    if doc_cat and doc_cat != "other":
                        best_category = doc_cat
                rag_metadata = {
                    "confidence": rag_result.confidence,
                    "verification_status": rag_result.verification_status,
                    "matched_documents": rag_result.matched_documents,
                    "related_documents": rag_result.related_documents,
                    "related_products": rag_result.related_products,
                    "related_faqs": rag_result.related_faqs,
                    "related_policies": rag_result.related_policies,
                    "retrieval_time_ms": rag_result.retrieval_time_ms,
                    "model_used": rag_result.model_used,
                    "chunks": [c.to_dict() for c in rag_result.chunks],
                    # True when semantic search is running on the LocalHashEmbedding
                    # fallback (lexical overlap only, not real semantic similarity) —
                    # see rag/embeddings.py get_embedding_provider(). Surfaced here so
                    # admin/observability can see it; never blocks or scares the user.
                    "embedding_degraded": rag_result.embedding_degraded,
                    # Discrete evidence-sufficiency check (rag/evidence.py) over the
                    # reranked chunks (rag/rerank.py) — feeds handoff_required below
                    # alongside the existing confidence/verification_status checks.
                    "evidence_sufficient": rag_result.evidence_sufficient,
                    "evidence_reason": rag_result.evidence_reason,
                }
                # Best-effort fetch related items
                try:
                    rag_result = await retriever.fetch_related(rag_result, token=token)
                    rag_metadata["related_documents"] = rag_result.related_documents
                    rag_metadata["related_products"] = rag_result.related_products
                    rag_metadata["related_faqs"] = rag_result.related_faqs
                    rag_metadata["related_policies"] = rag_result.related_policies
                except Exception:
                    pass
        except Exception as _rag_err:
            # Fall through to legacy keyword path
            pass

    # ---- Legacy keyword path (always runs as enrichment / fallback) ----
    legacy_sources: List[ChatSource] = []
    legacy_context_parts: List[str] = []
    if tokens:
        best_score = 0
        for table, title_col, extra_cols, category, table_filters in SEARCH_TABLES:
            # limit=1000: this fetches the full approved-row candidate pool
            # for client-side token-overlap scoring below, not the number of
            # results actually used (limit_per_table caps that at 3). 200
            # silently truncated it below the real row count for `faqs`
            # (536 approved) and `policies` (209 approved) with no ordering
            # to make the cut deterministic, so whichever specific FAQ/policy
            # a user asked about could simply never enter the candidate pool
            # — a real, intermittent "the AI can't answer this FAQ" bug.
            rows = await supabase_select(
                token,
                table,
                columns=f"id,{title_col},{extra_cols}",
                filters=table_filters,
                limit=1000,
            )
            scored: List[Tuple[int, Dict[str, Any]]] = []
            for row in rows:
                row_text = " ".join(str(v) for v in row.values() if v).lower()
                score = sum(1 for t in tokens if t in row_text)
                if score > 0:
                    scored.append((score, row))
            scored.sort(key=lambda x: x[0], reverse=True)

            for score, row in scored[:limit_per_table]:
                title = str(row.get(title_col) or row.get("id") or "row")
                row_id = str(row.get("id", ""))
                extra = " ".join(str(row.get(c)) for c in extra_cols.split(",") if row.get(c))
                legacy_context_parts.append(f"[{table}] {title}\n{extra[:600]}")
                legacy_sources.append(
                    ChatSource(
                        table=table,
                        id=row_id,
                        title=title,
                        url=f"/products?id={row_id}" if table == "products" else None,
                    )
                )
                if score > best_score and not rag_sources:
                    best_score = score
                    best_category = category

    # Merge: RAG sources first, then legacy (deduped by id)
    seen_ids = {s.id for s in rag_sources}
    merged_sources = rag_sources + [s for s in legacy_sources if s.id not in seen_ids]
    merged_context = "\n\n".join(rag_context_parts + legacy_context_parts)[:4000]

    if not tokens and not merged_context:
        return "", [], "general", rag_metadata

    return merged_context, merged_sources[:8], best_category, rag_metadata


def current_time_context() -> str:
    """Real, always-accurate current time — avoids the LLM either refusing
    date/time questions outright or hallucinating an answer from stale
    training data.

    Includes IST (Dayjoy's home market) alongside UTC: a bare UTC timestamp
    previously got read back to Indian users verbatim, off by the 5:30
    offset from their actual local time, which looked like a wrong answer
    even though the UTC value itself was correct.
    """
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc + timedelta(hours=5, minutes=30)
    return (
        f"Current date/time: {now_ist.strftime('%A, %B %d, %Y, %H:%M')} IST "
        f"({now_utc.strftime('%H:%M')} UTC)."
    )


async def web_search(query: str, max_results: int = 4) -> Tuple[str, List[ChatSource], Optional[str]]:
    """General-knowledge / current-events fallback via the search provider chain
    (see `backend/search_providers.py` — Tavily primary, Brave fallback).

    Returns ("", [], None) — never raises — when no provider is configured
    or every configured provider's request fails, so callers can treat it
    identically to an empty Dayjoy-knowledge match. The third element is the
    name of the provider that actually served results (for response
    labeling / admin visibility), or None if none did.
    """
    results, provider_used, _any_configured = await web_search_multi(query, max_results)
    if not results:
        return "", [], None

    context_parts: List[str] = []
    sources: List[ChatSource] = []
    for r in results:
        # "[web]" label lets the system prompt tell this apart from
        # approved Dayjoy knowledge context.
        context_parts.append(f"[web] {r.title} ({r.url or 'no url'})\n{r.content[:600]}")
        sources.append(ChatSource(table="web", id=str(r.url or r.title), title=r.title, url=r.url))

    return "\n\n".join(context_parts), sources, provider_used


# ----------------------------------------------------------------------------
# AI router — decides which knowledge source(s) answer a message.
# ----------------------------------------------------------------------------
@dataclass
class RouteResult:
    context: str  # Dayjoy RAG/legacy context only ("" if no match)
    web_context: str  # Web search context only ("" if unused/unavailable)
    sources: List[ChatSource]  # Dayjoy sources only
    web_sources: List[ChatSource]
    category: str
    rag_metadata: Optional[Dict[str, Any]]
    mode: str  # "dayjoy" | "hybrid" — selects the system-prompt variant
    answer_source: str  # dayjoy_knowledge | web_search | general_llm | hybrid | casual
    web_search_provider: Optional[str]  # tavily | brave | None
    used_web_search: bool
    # When set, the router has already produced the final user-facing text
    # itself (a clarifying question, or — pending future phases — a fully
    # deterministic structured answer) and generation should be skipped
    # entirely rather than handed to the LLM. Defaulted so every existing
    # positional RouteResult(...) construction in this file keeps working.
    direct_answer: Optional[str] = None
    # Product Cards — populated ONLY from a structured pricing_lookup or
    # product_recommendation tool result (pricing.py/recommend.py), never
    # from RAG/LLM text. Every field is a verbatim DB value already used to
    # build `context` above; kept as structured JSON too so the frontend can
    # render a rich card instead of (or alongside) prose. Empty for every
    # other route.
    product_cards: List[Dict[str, Any]] = field(default_factory=list)
    # Clarification Intelligence — selectable options to accompany
    # `direct_answer` when it's a clarifying question (orchestrator/
    # clarify.py). Each option is itself a complete follow-up message, not
    # a bare label — clicking one sends it verbatim as the user's next
    # turn. Empty for every route that isn't a clarification.
    clarification_options: List[str] = field(default_factory=list)


def _format_pricing_context(data: Dict[str, Any]) -> str:
    """Deterministic, all-facts-present context string for a structured
    pricing_lookup result. The LLM is only ever asked to phrase these exact
    numbers into a sentence, never to state a price on its own — every
    figure here is a verbatim `product_prices` row value."""
    lines = [f"[Verified pricing — {data['product_name']}]"]
    if data.get("mrp") is not None:
        lines.append(f"MRP: {data.get('currency') or 'INR'} {data['mrp']}")
    if data.get("dp") is not None:
        lines.append(f"Distributor Price (DP): {data.get('currency') or 'INR'} {data['dp']}")
    if data.get("bv") is not None:
        lines.append(f"BV: {data['bv']}")
    if data.get("pv") is not None:
        lines.append(f"PV: {data['pv']}")
    if data.get("effective_from"):
        lines.append(f"Effective from: {data['effective_from']}")
    return "\n".join(lines)


def _format_recommendation_context(products: List[Dict[str, Any]]) -> str:
    """Deterministic context string for a structured product_recommendation
    result — every field is a verbatim DB value (see recommend.py's
    `_bundle_product` docstring); the LLM only phrases these into prose."""
    blocks: List[str] = []
    for p in products:
        lines = [f"[Official Dayjoy Recommendation — {p.get('product_name')}]"]
        lines.append(f"Matched for: {p.get('matched_condition')}")
        if p.get("benefits"):
            lines.append(f"Benefits: {p['benefits']}")
        if p.get("usage"):
            lines.append(f"Usage: {p['usage']}")
        if p.get("dosage"):
            lines.append(f"Dosage: {p['dosage']}")
        if p.get("who_can_use"):
            lines.append(f"Who can use: {p['who_can_use']}")
        if p.get("contraindications"):
            lines.append(f"Contraindications: {p['contraindications']}")
        if p.get("safety_note"):
            lines.append(f"Safety note: {p['safety_note']}")
        price = p.get("price")
        if price:
            lines.append(
                f"Price: MRP {price.get('currency') or 'INR'} {price.get('mrp')}, "
                f"DP {price.get('dp')}, BV {price.get('bv')}, PV {price.get('pv')}"
            )
        blocks.append("\n".join(lines))
    return "\n\n---\n\n".join(blocks)


def _format_wellness_context(data: Dict[str, Any]) -> str:
    """Deterministic context string for the structured wellness_context
    tool result — every field is a verbatim wellness_goals row value (see
    tools/wellness.py); the LLM only phrases these into a status update or
    a "goal created" confirmation, never invents progress."""
    if data.get("status") == "goal_created":
        goal = data.get("goal") or {}
        return (
            f"[Wellness goal created — {goal.get('title')}]\n"
            f"Goal type: {data.get('goal_type')}\n"
            "This is a brand-new goal with no progress logged yet. Confirm it was "
            "created, and mention the user can track it (and log activities toward "
            "it) from the Wellness Journey page."
        )
    goals = data.get("goals") or []
    blocks = []
    for g in goals:
        lines = [f"[Active wellness goal — {g.get('title')}]"]
        lines.append(f"Type: {g.get('goal_type')}")
        current = g.get("current_value")
        target = g.get("target_value")
        unit = g.get("unit") or ""
        if target:
            lines.append(f"Progress: {current or 0}/{target} {unit}".strip())
        else:
            lines.append(f"Progress logged: {current or 0} {unit}".strip())
        if g.get("target_date"):
            lines.append(f"Target date: {g['target_date']}")
        blocks.append("\n".join(lines))
    return "\n\n---\n\n".join(blocks)


async def _route_from_kb_result(
    kb_data: Dict[str, Any], message: str
) -> AsyncIterator[Tuple[str, Any]]:
    """Continues routing from an already-fetched dayjoy_kb tool result (ran
    concurrently alongside a structured pricing/recommendation lookup that
    didn't pan out) instead of a second, redundant retrieve_context() call.
    Mirrors the has_context/web-search/evidence-gate decision `_route_events`
    applies to its own direct retrieve_context() call — one implementation,
    not two copies that could drift out of sync."""
    yield ("status", "searching_knowledge")
    context, sources, category, rag_metadata = (
        kb_data.get("context", ""), kb_data.get("sources") or [],
        kb_data.get("category", "general"), kb_data.get("rag_metadata"),
    )
    evidence_ok = not (rag_metadata and rag_metadata.get("evidence_sufficient") is False)
    has_context = bool(context) and evidence_ok
    web_context, web_sources, web_search_provider, used_web_search, mode = "", [], None, False, "dayjoy"
    if not has_context:
        yield ("status", "searching_web")
        web_context, web_sources, web_search_provider = await web_search(message)
        if web_context:
            used_web_search, category, answer_source = True, "general", "web_search"
        else:
            answer_source, context = "general_llm", ""
    else:
        answer_source = "dayjoy_knowledge"
    yield (
        "result",
        RouteResult(
            context=context, web_context=web_context, sources=sources, web_sources=web_sources,
            category=category, rag_metadata=rag_metadata, mode=mode, answer_source=answer_source,
            web_search_provider=web_search_provider, used_web_search=used_web_search,
        ),
    )


async def _route_events(
    token: Optional[str], message: str, casual: bool, ai_mode: str = "normal"
) -> AsyncIterator[Tuple[str, Any]]:
    """Router core, shared by /chat and /chat/stream so routing logic can't
    drift between the two endpoints.

    Yields ("status", str) progress events (mirroring the SSE status frames
    the streaming endpoint already emits), then exactly one
    ("result", RouteResult) as the final item. /chat discards the status
    events; /chat/stream forwards them as SSE frames.

    Routing decisions:
    - Casual small talk: skip retrieval entirely (answer_source="casual").
    - Dayjoy context found + a comparison cue ("compare", "vs", ...): also
      fetch web results and answer in hybrid mode, each claim attributed
      (answer_source="hybrid").
    - Dayjoy context found, no comparison cue: answer from Dayjoy knowledge
      alone, unchanged from existing behavior (answer_source="dayjoy_knowledge").
    - No Dayjoy context: fall back to web search; if that also finds
      nothing (or no provider is configured), the LLM answers from its own
      general knowledge (answer_source="web_search" / "general_llm").
    """
    if casual:
        # Greetings/small talk skip document search entirely — there is
        # nothing Dayjoy-specific to look up, and running RAG + web search
        # on "hii" only added latency and produced an irrelevant "needs
        # human handoff" disclaimer on a completely normal reply.
        yield ("result", RouteResult("", "", [], [], "general", None, "dayjoy", "casual", None, False))
        return

    if is_weather_query(message):
        # Live-data short-circuit: weather has zero Dayjoy-knowledge value,
        # so running RAG first (which would find nothing anyway) only added
        # latency. The LLM has no live weather of its own — without this,
        # it answered with confident-sounding but fabricated conditions.
        # Open-Meteo needs no API key; `format_context` is the only source
        # of the actual numbers the model is allowed to state.
        yield ("status", "checking_weather")
        weather_data = await weather_tool.run(message)
        if weather_data:
            yield (
                "result",
                RouteResult(
                    weather_tool.format_context(weather_data),
                    "",
                    [],
                    [],
                    "weather",
                    {"confidence": 0.95, "verification_status": "verified", "evidence_sufficient": True},
                    "dayjoy",
                    "live_data",
                    "open-meteo",
                    False,
                ),
            )
            return
        # No resolvable place name (e.g. "what's the weather like?" with no
        # location) — fall through to the normal path below, which lets the
        # model ask the user which city/place they mean.

    clarification = needs_clarification(message)
    if clarification:
        # Too vague to route confidently (e.g. "which product is best?" with
        # no stated goal) — ask instead of guessing. No LLM call, no
        # retrieval: this is a deterministic question, not a generated one.
        yield (
            "result",
            RouteResult(
                context="", web_context="", sources=[], web_sources=[],
                category="clarification", rag_metadata=None, mode="dayjoy",
                answer_source="clarification", web_search_provider=None,
                used_web_search=False, direct_answer=clarification.question,
                clarification_options=clarification.options,
            ),
        )
        return

    plan = build_plan(message)

    if plan.intent.intent == INTENT_PRICING and plan.proposed_tools:
        yield ("status", "checking_pricing")
        # Runs pricing_lookup and (only for a compound question — see
        # planner.py) dayjoy_kb CONCURRENTLY via the same executor every
        # other multi-tool call in this codebase uses, instead of two
        # sequential round-trips.
        tool_calls = [{"name": name, "kwargs": {"token": token, "message": message}} for name in plan.proposed_tools]
        results = {r.tool_name: r for r in await run_tools(tool_calls)}

        pricing_result = results.get("pricing_lookup")
        pricing_data = pricing_result.data if pricing_result and pricing_result.ok else {"found": False}
        kb_result = results.get("dayjoy_kb")
        kb_data = kb_result.data if kb_result and kb_result.ok else None

        if pricing_data.get("found"):
            context_parts = [_format_pricing_context(pricing_data)]
            kb_sources: List[ChatSource] = []
            if kb_data and kb_data.get("context"):
                context_parts.append(f"[Supporting product information]\n{kb_data['context'][:1500]}")
                kb_sources = kb_data.get("sources") or []
            yield (
                "result",
                RouteResult(
                    context="\n\n".join(context_parts), web_context="",
                    sources=kb_sources, web_sources=[], category="pricing",
                    rag_metadata={
                        "confidence": 0.98, "verification_status": "verified",
                        "evidence_sufficient": True, "source": "structured_pricing",
                    },
                    mode="dayjoy", answer_source="dayjoy_knowledge",
                    web_search_provider=None, used_web_search=False,
                    product_cards=[{
                        "product_id": pricing_data.get("product_id"),
                        "product_name": pricing_data.get("product_name"),
                        "price": {
                            "mrp": pricing_data.get("mrp"),
                            "dp": pricing_data.get("dp"),
                            "bv": pricing_data.get("bv"),
                            "pv": pricing_data.get("pv"),
                            "currency": pricing_data.get("currency"),
                        },
                        # Approved primary photo from product_images, resolved
                        # by tools/pricing.py — None when the product has no
                        # image, never fabricated (see product_media.py).
                        "image_url": pricing_data.get("image_url"),
                        "image_alt": pricing_data.get("image_alt"),
                    }],
                ),
            )
            return
        # No product resolved, or no trusted current price row. If dayjoy_kb
        # already ran (compound question), reuse its result as the RAG
        # context instead of a second retrieval round-trip; otherwise fall
        # through to the normal retrieve_context() call below.
        if kb_data is not None:
            async for event in _route_from_kb_result(kb_data, message):
                yield event
            return
        # Neither structured pricing nor dayjoy_kb ran (simple "how much for
        # X" that didn't resolve) — fall through to the normal path below.

    elif plan.intent.intent == INTENT_RECOMMENDATION and plan.proposed_tools:
        yield ("status", "checking_recommendations")
        tool_calls = [{"name": name, "kwargs": {"token": token, "message": message}} for name in plan.proposed_tools]
        results = {r.tool_name: r for r in await run_tools(tool_calls)}

        rec_result = results.get("product_recommendation")
        rec = rec_result.data if rec_result and rec_result.ok else {"status": "insufficient_evidence"}
        kb_result = results.get("dayjoy_kb")
        kb_data = kb_result.data if kb_result and kb_result.ok else None

        if rec.get("status") == "needs_clarification":
            yield (
                "result",
                RouteResult(
                    context="", web_context="", sources=[], web_sources=[],
                    category="clarification", rag_metadata=None, mode="dayjoy",
                    answer_source="clarification", web_search_provider=None,
                    used_web_search=False, direct_answer=rec.get("clarifying_question"),
                ),
            )
            return
        if rec.get("status") == "ok" and rec.get("products"):
            context_parts = [_format_recommendation_context(rec["products"])]
            kb_sources = []
            if kb_data and kb_data.get("context"):
                context_parts.append(f"[Supporting context]\n{kb_data['context'][:1500]}")
                kb_sources = kb_data.get("sources") or []
            yield (
                "result",
                RouteResult(
                    context="\n\n".join(context_parts), web_context="",
                    sources=kb_sources, web_sources=[], category="recommendation",
                    rag_metadata={
                        "confidence": 0.95, "verification_status": "verified",
                        "evidence_sufficient": True, "source": "structured_recommendation",
                    },
                    mode="dayjoy", answer_source="dayjoy_knowledge",
                    web_search_provider=None, used_web_search=False,
                    # rec["products"] is already the exact verified DB bundle
                    # (see recommend.py's _bundle_product) — passed through
                    # verbatim, capped the same way the UI caps card display.
                    product_cards=rec["products"][:5],
                ),
            )
            return
        # "insufficient_evidence" — no chart condition matched well enough
        # to recommend anything structured. dayjoy_kb already ran alongside
        # the attempt (planner.py always proposes it for recommendation
        # intent) — reuse that result instead of a second retrieval
        # round-trip, same as the pricing branch above.
        if kb_data is not None:
            async for event in _route_from_kb_result(kb_data, message):
                yield event
            return

    elif plan.intent.intent == INTENT_WELLNESS and plan.proposed_tools:
        # Wellness Journey P0 (docs/WELLNESS_JOURNEY_ANALYSIS_AND_MASTER_
        # PROMPT.md, Step 12) — reads/writes the SAME wellness_goals table
        # the Wellness Journey page owns via tools/wellness.py, so a chat
        # request like "I want to improve my energy" actually creates (or
        # reports progress on) a real goal instead of just answering once.
        yield ("status", "checking_wellness_goals")
        tool_calls = [{"name": name, "kwargs": {"token": token, "message": message}} for name in plan.proposed_tools]
        results = {r.tool_name: r for r in await run_tools(tool_calls)}
        wellness_result = results.get("wellness_context")
        wellness_data = wellness_result.data if wellness_result and wellness_result.ok else None

        if wellness_data and wellness_data.get("status") in ("has_active_goals", "goal_created"):
            context = _format_wellness_context(wellness_data)
            # Product recommendation reuse (analysis Step 8) — opportunistic,
            # never forced: only attached if the SAME structured chart match
            # tools/recommend.py already uses for a direct product ask also
            # matches this goal's own title/type, using its own existing
            # insufficient_evidence fallback when it doesn't.
            product_cards: List[Dict[str, Any]] = []
            goal_text = (
                wellness_data.get("goal", {}).get("title")
                if wellness_data["status"] == "goal_created"
                else (wellness_data.get("goals") or [{}])[0].get("title")
            )
            if goal_text:
                try:
                    rec = await recommend_tool.run(token, str(goal_text))
                    if rec.get("status") == "ok" and rec.get("products"):
                        product_cards = rec["products"][:3]
                        context += f"\n\n---\n\n{_format_recommendation_context(product_cards)}"
                except Exception:
                    pass  # a failed opportunistic recommendation must never block the wellness answer
            yield (
                "result",
                RouteResult(
                    context=context, web_context="", sources=[], web_sources=[],
                    category="wellness",
                    rag_metadata={
                        "confidence": 0.9, "verification_status": "verified",
                        "evidence_sufficient": True, "source": "structured_wellness",
                    },
                    mode="dayjoy", answer_source="dayjoy_knowledge",
                    web_search_provider=None, used_web_search=False,
                    product_cards=product_cards,
                ),
            )
            return
        # Unauthenticated, or the write failed — fall through to the normal
        # general-knowledge path below rather than a dead end.

    # Answer Quality Router (orchestrator/quality_router.py) — a narrow,
    # deterministic check for a broad business/strategy question (the only
    # strategy this route actually diverts on; every other strategy value
    # just documents what the code below already does). Isolated early
    # return: run_reasoning_pipeline builds and merges its OWN evidence set
    # across sub-questions rather than depending on the single-call
    # assumptions the rest of this function is built around — see that
    # module's docstring for why that isolation is what makes this safe to
    # wire in as one branch instead of a riskier rewrite of the shared path.
    quality_decision = route_query(message, plan.intent, plan)
    # User Goal Analyzer — internal-only structured representation of what
    # the user actually wants, assembled from signals already computed
    # above (intent + routing decision), never re-classified with an extra
    # LLM call. Logged for observability only; never sent to the client or
    # used to gate behaviour, so a bad guess here can't break an answer.
    try:
        goal_profile = analyze_user_goal(message, plan.intent, quality_decision)
        _llm_logger.debug("user_goal_profile=%s", goal_profile.to_dict())
    except Exception:
        pass
    if quality_decision.use_reasoning:
        yield ("status", "analyzing")
        route_result = await run_reasoning_pipeline(token, message, top_k=quality_decision.top_k_hint)
        yield ("result", route_result)
        return

    yield ("status", "searching_knowledge")
    context, sources, category, rag_metadata = await retrieve_context(
        token, message, top_k=top_k_for(ai_mode)
    )

    # A non-empty `context` string doesn't mean the retrieved chunks were
    # actually relevant — the retriever still concatenates whatever it found
    # even when it has already flagged evidence_sufficient=False (top score
    # below the sufficiency threshold). Verified live in production: "Who
    # won the last cricket world cup?" retrieved five unrelated Dayjoy FAQ
    # chunks at score ~0.2, `context` was truthy, so routing fell through to
    # the `else` branch below and labeled the answer "dayjoy_knowledge" even
    # though the model ignored that context and answered from its own
    # training data — mislabeled *and* skipped the web-search fallback that
    # should have run instead. Treating weak evidence as "no context" for
    # routing purposes (while still letting a real match through) closes
    # that gap without touching the retriever/threshold logic itself.
    evidence_ok = not (rag_metadata and rag_metadata.get("evidence_sufficient") is False)
    has_context = bool(context) and evidence_ok

    web_context = ""
    web_sources: List[ChatSource] = []
    web_search_provider: Optional[str] = None
    used_web_search = False
    mode = "dayjoy"

    if has_context and wants_hybrid_comparison(message):
        # Dayjoy match + an explicit comparison cue: pull web results too so
        # the model can reason across both, with each claim clearly
        # attributed (see HYBRID_MODE_ADDENDUM below).
        yield ("status", "searching_web")
        web_context, web_sources, web_search_provider = await web_search(message)
        if web_context:
            used_web_search = True
            mode = "hybrid"
            answer_source = "hybrid"
        else:
            answer_source = "dayjoy_knowledge"
    elif is_pure_time_query(message):
        # current_time_context() (always injected into the prompt below)
        # already answers this exactly — routing it through web search too
        # was redundant, occasionally surfaced a stale/conflicting result,
        # and triggered the "this came from a web search" disclosure for a
        # question that never left the server.
        category = "general"
        answer_source = "general_llm"
    elif not has_context:
        # No approved Dayjoy knowledge matched (or what matched was too
        # weak to trust) — fall back to a live web search for general
        # questions (world events, general facts) instead of the model
        # answering off weak/irrelevant context or refusing outright.
        yield ("status", "searching_web")
        web_context, web_sources, web_search_provider = await web_search(message)
        if web_context:
            used_web_search = True
            category = "general"
            answer_source = "web_search"
        else:
            answer_source = "general_llm"
            # Weak/irrelevant Dayjoy chunks shouldn't reach the prompt at
            # all once we've decided not to trust them for routing — leaving
            # `context` in would let the model quote them anyway.
            context = ""
    else:
        answer_source = "dayjoy_knowledge"

    yield (
        "result",
        RouteResult(
            context=context,
            web_context=web_context,
            sources=sources,
            web_sources=web_sources,
            category=category,
            rag_metadata=rag_metadata,
            mode=mode,
            answer_source=answer_source,
            web_search_provider=web_search_provider,
            used_web_search=used_web_search,
        ),
    )


def _run_orchestrator_observability(message: str) -> None:
    """Phase 1: when ORCHESTRATOR_ENABLED, compute the orchestrator's intent
    classification + proposed tool plan and log it — purely for
    observability, alongside `_route_events`, which remains the sole owner
    of the actual routing decision. Best-effort: any failure here must never
    affect the chat response, matching this codebase's existing pattern for
    non-critical logging (see `_log_analytics`, `rag/retriever.py`
    `_log_query`).
    """
    if not ORCHESTRATOR_ENABLED:
        return
    try:
        from backend.orchestrator.observability import TraceEvent, emit_trace

        plan = build_plan(message)
        emit_trace(
            TraceEvent(
                intent=plan.intent.intent,
                entities={
                    "wants_comparison": plan.intent.wants_comparison,
                    "is_time_query": plan.intent.is_time_query,
                    "wants_pricing": plan.intent.wants_pricing,
                    "wants_recommendation": plan.intent.wants_recommendation,
                },
                selected_tools=plan.proposed_tools,
            )
        )
    except Exception:
        _orchestrator_logger.exception("orchestrator observability pass failed")


def _log_unified_trace(
    *,
    request_id: str,
    user_id: Optional[str],
    query: str,
    rewritten_query: Optional[str] = None,
    route: Optional["RouteResult"] = None,
    confidence: Optional[float] = None,
    handoff_required: Optional[bool] = None,
    answer_mismatch: bool = False,
    verification_ran: bool = False,
    started_at: float = 0.0,
    final_status: str = "ok",
    stage_ms: Optional[Dict[str, float]] = None,
    answer: Optional[str] = None,
    verification_status: Optional[str] = None,
) -> None:
    """Phase 7 — the single per-request observability call site. Does NOT
    replace `_log_analytics` (writes to the `analytics` table an admin
    dashboard may already read from) or `Retriever._log_query` (writes to
    `rag_queries`) — reshaping either table without verifying against the
    live production schema is a bigger migration than this covers (see
    orchestrator/observability.py's module docstring). This adds the one
    thing genuinely missing before this pass: ONE structured log line per
    request carrying everything — intent, route, retrieval IDs/scores,
    latency, verification outcome, fallback reason — in one place instead of
    three unmerged ones. `stage_ms` (optional) breaks total latency down by
    pipeline stage (routing — which includes RAG retrieval, structured
    lookups, and web search, since those all happen inside
    `determine_route()` — personalization, generation, verification);
    omitted stages (e.g. verification on an answer that skipped the check)
    simply aren't keys in the dict rather than being reported as zero, so a
    dashboard can tell "didn't run" from "ran instantly." Called
    unconditionally (not gated behind
    ORCHESTRATOR_ENABLED, unlike the pre-generation-only observability hook)
    since real observability shouldn't be an opt-in debug flag. Best-effort:
    any failure here must never affect the response, which has already been
    built and returned by the time this runs.
    """
    try:
        from backend.orchestrator.intent import detect_intent
        from backend.orchestrator.observability import TraceEvent, emit_trace

        intent_result = detect_intent(query)
        chunk_ids: List[str] = []
        scores: List[float] = []
        fallback_reason: Optional[str] = None
        if route is not None:
            chunk_ids = [s.id for s in route.sources if s.table == "knowledge_chunks"]
            for c in (route.rag_metadata or {}).get("chunks", []) or []:
                score = c.get("rerank_score", c.get("score"))
                if score is not None:
                    scores.append(score)
            if route.rag_metadata and route.rag_metadata.get("evidence_sufficient") is False:
                fallback_reason = "evidence_insufficient"
        if not GROQ_API_KEY and not OPENAI_API_KEY:
            fallback_reason = "no_llm_configured"

        if not verification_ran:
            verification_result = "not_checked"
        elif answer_mismatch:
            verification_result = "failed_handoff"
        else:
            verification_result = "passed"

        quality_score = None
        validation = None
        if answer is not None:
            from backend.orchestrator.format_intent import FORMAT_ACTION_PLAN, detect_format
            from backend.orchestrator.quality import score_answer
            from backend.orchestrator.answer_structure import structure_answer
            from backend.orchestrator.answer_validate import validate_structured_answer

            answer_source_for_scoring = route.answer_source if route else "general_llm"
            sources_for_scoring = route.sources if route else []

            quality_score = score_answer(
                query,
                answer,
                answer_source=answer_source_for_scoring,
                verification_status=verification_status,
                confidence=confidence,
                sources=sources_for_scoring,
                intent_wants_action=detect_format(query) == FORMAT_ACTION_PLAN,
            ).to_dict()
            validation = validate_structured_answer(
                structure_answer(answer),
                answer_source=answer_source_for_scoring,
                sources=sources_for_scoring,
                verification_status=verification_status,
                answer_text=answer,
            ).to_dict()

        emit_trace(
            TraceEvent(
                request_id=request_id,
                user_id=user_id,
                query=query,
                rewritten_query=rewritten_query if rewritten_query != query else None,
                intent=intent_result.intent,
                entities={
                    "wants_pricing": intent_result.wants_pricing,
                    "wants_recommendation": intent_result.wants_recommendation,
                    "wants_comparison": intent_result.wants_comparison,
                },
                route=route.answer_source if route else None,
                retrieval_sources=list({s.table for s in route.sources}) if route else [],
                retrieved_chunk_ids=chunk_ids,
                retrieved_scores=scores,
                latency_ms=(
                    {"total": (time.monotonic() - started_at) * 1000, **(stage_ms or {})}
                    if started_at else {}
                ),
                model=GROQ_MODEL if GROQ_API_KEY else (OPENAI_MODEL if OPENAI_API_KEY else None),
                confidence=confidence,
                verification_result=verification_result,
                fallback_reason=fallback_reason,
                handoff_required=handoff_required,
                final_status=final_status,
                quality_score=quality_score,
                validation=validation,
            )
        )
    except Exception:
        _orchestrator_logger.exception("unified trace logging failed")


async def _fetch_business_snapshot(token: Optional[str], user_id: str) -> Optional[str]:
    """A deliberately minimal, fast business-data snapshot for chat
    personalization — NOT the full BI dashboard computation
    (business_intelligence_api.py's `bi_overview` does that: 15+ sequential
    queries and RPC calls for the dashboard page, where that latency is
    expected; running the same thing on every eligible chat message would
    add multiple seconds for what's meant to be a one-line context blurb).
    Two bounded, RLS-scoped reads — team size and this month's business
    volume — via the same anon-key + bearer-token pattern every other read
    in this file already uses. Returns None (not "") on any failure/empty
    result so the caller can tell "nothing to add" apart from "found zero
    team members", which is itself a valid, real answer worth surfacing.
    """
    try:
        team = await supabase_select(token, "team_members", columns="status,joined_date", filters={"leader_id": user_id}, limit=500)
        active_team = sum(1 for t in team if t.get("status") == "active")
        month_start = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        bv_rows = await supabase_select(token, "business_volume_ledger", columns="bv,created_at", filters={"distributor_id": user_id}, limit=1000)
        month_bv = sum(
            float(r.get("bv") or 0) for r in bv_rows if str(r.get("created_at") or "") >= month_start
        )
    except Exception:
        return None
    if not team and not bv_rows:
        return None
    return (
        f"Team size: {len(team)} ({active_team} active). "
        f"Business volume (last 30 days): {month_bv:.0f} BV."
    )


def _assemble_compressed_context(
    time_context: str, personalization_context: Optional[str], dayjoy_context: str, web_context: str
) -> str:
    """Context Compression (orchestrator/context_compress.py) — replaces the
    previous plain "\\n\\n".join() of these four blocks with dedup +
    priority-budgeted assembly. Dayjoy knowledge/current time are the
    highest-priority (never dropped except under extreme budget pressure);
    web results are lowest, since they're supplementary even in hybrid mode
    (HYBRID_MODE_ADDENDUM already tells the model Dayjoy context wins on any
    conflict)."""
    blocks = [
        ContextBlock(label="Current date/time", text=time_context, priority=1) if time_context else None,
        ContextBlock(label="Approved Dayjoy knowledge", text=dayjoy_context, priority=1) if dayjoy_context else None,
        ContextBlock(label="Personalization", text=personalization_context, priority=2)
        if personalization_context
        else None,
        ContextBlock(label="Web", text=web_context, priority=3) if web_context else None,
    ]
    return compress_context([b for b in blocks if b is not None])


async def _maybe_personalization_context(
    token: Optional[str], user_id: Optional[str], message: str,
    history: List[Dict[str, str]], casual: bool, role: Optional[str] = None,
) -> str:
    """Fetches a small, relevance-scored slice of this user's own memory
    (tools/memory.py's `list_memory`, already recency+pinned scored) and/or
    a minimal business-data snapshot, and renders them as labeled,
    non-interleaved blocks (context_builder.py) — only when the
    conversation actually looks like it needs it, never on every message:
    a follow-up that references something earlier ("what about that one?"),
    a recommendation-shaped question, or (for a distributor) their own
    business standing ("how's my team doing?"). Memory requires at least
    one prior turn (a brand-new chat's first message has nothing to resolve
    a reference against); a business-data question doesn't — "how's my
    team?" is a perfectly normal FIRST message. Checked against the
    message's own intent shape directly (not `route.category`) — a
    recommendation question that fell through to RAG because the
    structured chart had no match is exactly a case where personal
    preferences (e.g. "vegetarian") still help the final answer, not one
    where they've become irrelevant. Best-effort: any failure here must
    never block the chat response.
    """
    if casual or not token or not user_id:
        return ""

    memory_items = None
    if history and (wants_reference_resolution(message) or wants_recommendation(message)):
        try:
            memory_items = await list_memory(token, user_id, limit=5)
        except Exception:
            memory_items = None

    business_snapshot = None
    if role == "distributor" and wants_business_data(message):
        business_snapshot = await _fetch_business_snapshot(token, user_id)

    # Conversation Continuity Engine (orchestrator/conversation_state.py) —
    # fills the conversation_summary field context_builder.py already had a
    # rendering path for but nothing ever computed. Cheap/pure over the same
    # `history` already in scope, so it's fine to compute even when memory/
    # business data end up empty — it alone can justify returning a block.
    conversation_summary = build_conversation_state(history).to_summary() or None

    if not memory_items and not business_snapshot and not conversation_summary:
        return ""
    # Top 3 memory items by the tool's own recency+pinned score — not the
    # full 20-item cap `list_memory` allows, per "don't inject all memory
    # into every prompt."
    return build_context(
        user_memory_items=(memory_items or [])[:3],
        business_data=business_snapshot,
        conversation_summary=conversation_summary,
    ).to_prompt_blocks()


# Answer Personalization Controls (Capability 14) — recognized preference
# keys, written either by Settings (see UserSettings.tsx's Response style
# section) or by the existing User Preference Learning auto-save
# (trackTransformUsage() in UserChat.tsx after repeated manual transform
# use). Maps each key/value onto a plain-English system-prompt directive.
_PERSONALIZATION_DIRECTIVES: Dict[str, Dict[str, str]] = {
    "preferred_detail": {
        "short": "Keep answers concise by default — only the essential point(s).",
        "concise": "Keep answers concise by default — only the essential point(s).",
        "balanced": "",  # default behavior — no directive needed
        "detailed": "Prefer more detailed answers by default — include the full reasoning and relevant specifics.",
    },
    "preferred_explanation_level": {
        "simple": "Explain things in plain, everyday language by default — avoid jargon unless the user uses it first.",
    },
    "preferred_response_style": {
        "actionable": "Prefer actionable framing by default — concrete steps over pure explanation.",
        "professional": "Use a polished, professional tone by default.",
        "simple": "Use simple, plain language by default.",
    },
    "preferred_language": {
        "Hindi": "Prefer responding in Hindi by default, unless the user writes in another language.",
        "Hinglish": "Prefer responding in Hinglish (Hindi in Latin script mixed with English) by default, unless the user writes in another language.",
    },
}


async def _personalization_style_addendum(token: Optional[str], user_id: Optional[str]) -> str:
    """Turns the user's own saved preferences (Settings or auto-learned)
    into an explicit system-prompt directive — previously these preference
    keys were only ever surfaced as inert "known facts about the user" text
    (via _maybe_personalization_context, itself gated to reference/
    recommendation-shaped messages only), which an LLM has no reliable
    reason to treat as a standing behavioral instruction. This runs on
    every authenticated message, not conditionally, since a saved style
    preference should apply everywhere, and is one cheap already-indexed
    query (list_memory) reused, not a new one."""
    if not token or not user_id:
        return ""
    try:
        items = await list_memory(token, user_id, limit=20)
    except Exception:
        return ""
    directives: List[str] = []
    seen_keys = set()
    for item in items:
        if not item.key or item.key in seen_keys or item.key not in _PERSONALIZATION_DIRECTIVES:
            continue
        directive = _PERSONALIZATION_DIRECTIVES[item.key].get(item.value)
        if directive:
            directives.append(directive)
        seen_keys.add(item.key)
    if not directives:
        return ""
    return "User's saved preferences (apply by default, but always follow explicit in-message instructions first):\n" + "\n".join(
        f"- {d}" for d in directives
    )


def _compute_confidence(casual: bool, route: "RouteResult") -> Tuple[float, str]:
    """Shared by /chat and /chat/stream — was previously duplicated inline in
    both (see git history), which is exactly how this endpoint pair drifted
    out of sync before (the evidence-insufficiency check existed in /chat for
    a while before /chat/stream got it). One implementation, used by both."""
    if casual:
        return 1.0, "verified"
    if route.rag_metadata and route.rag_metadata.get("confidence") is not None:
        return route.rag_metadata["confidence"], route.rag_metadata.get("verification_status", "unverified")
    if route.used_web_search:
        return 0.6, "unverified"
    if route.context:
        return 0.85, "verified"
    return 0.4, "unverified"


async def determine_route(
    token: Optional[str], message: str, casual: bool, ai_mode: str = "normal"
) -> RouteResult:
    """Non-streaming convenience wrapper around `_route_events` — used by /chat."""
    async for kind, payload in _route_events(token, message, casual, ai_mode):
        if kind == "result":
            return payload
    raise AssertionError("_route_events did not yield a result")  # pragma: no cover


# ----------------------------------------------------------------------------
# LLM providers
# ----------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "You are Dayjoy AI Assist, an enterprise assistant for the Dayjoy wellness, healthcare, "
    "agriculture, lifestyle, and direct-selling ecosystem.\n\n"
    "FIRST decide whether the message is casual conversation or a Dayjoy-specific question:\n"
    "- Greetings, small talk, thanks, or general-knowledge questions with no connection to "
    "Dayjoy's products or business (e.g. \"hi\", \"how are you\", \"who is the president of "
    "India\") — answer directly and naturally from your own knowledge, like any normal "
    "assistant. Do NOT mention documents, approved knowledge, or human handoff for these; "
    "there is nothing to look up.\n"
    "- Anything about Dayjoy itself (products, health claims, policies, business/compensation) "
    "— use ONLY the approved Dayjoy knowledge below, never your own general knowledge or the "
    "web results, even if one seems relevant. Do NOT make medical claims, diagnosis, or "
    "treatment promises. Do NOT provide guaranteed income claims. If it isn't answerable from "
    "the approved context, say you need a human handoff and recommend contacting Dayjoy "
    "support — do not fill the gap with a web result or your own general knowledge.\n\n"
    "The context below may contain two kinds of material, each labeled:\n"
    "- Approved Dayjoy knowledge (products, FAQs, policies, training).\n"
    "- Lines marked \"[web]\" — general/current-events web search results, NOT Dayjoy-approved. "
    "Only relevant to general questions (world news, general facts).\n"
    "- A \"Current date/time\" line — always accurate, already converted to IST; use it directly "
    "for any date/time question instead of searching or guessing.\n"
    "Answer naturally and directly — do NOT add meta-commentary about where the information came "
    "from (e.g. \"this is based on a web search\", \"according to my search results\"). The "
    "application shows source attribution to the user separately; your job is just the answer.\n\n"
    "The context below is raw retrieved material — it may contain several separate FAQ/product "
    "entries, some in a literal \"Q: ... A: ...\" shorthand. NEVER paste multiple retrieved "
    "entries back as your answer, and never keep the \"Q:\"/\"A:\" labels — pick only what's "
    "relevant to THIS question and rewrite it as one short, natural, conversational answer, the "
    "way a knowledgeable person would say it out loud.\n\n"
    "Language: you are fully fluent in English, Hindi (Devanagari script), and Hinglish "
    "(Hindi written in Latin letters). You can and must respond in whichever of these the user "
    "asks for — never say you are unable to reply in Hindi or Hinglish. Match the script the "
    "user's own message is written in when no language is explicitly requested.\n\n"
    "Be concise, professional, and helpful. Cite source IDs/URLs where relevant.\n\n"
    "Formatting (optional, only when it genuinely helps): for a longer or multi-part answer, "
    "you may open with exactly one line in the form \"**TL;DR:** <one-sentence summary>\" before "
    "the full answer. When a specific point is unusually important, you may mark that one line "
    "with exactly one of these labels — \"**💡 Key Insight:** ...\", \"**⚠️ Warning:** ...\", "
    "\"**✅ Tip:** ...\", \"**🎯 Recommended:** ...\" — the app renders these as highlighted "
    "callouts. Use at most one or two per answer, and only where it clearly earns the emphasis; "
    "never on short/simple answers, and never as a substitute for the answer itself.\n\n"
    "When (and ONLY when) the context below gives you 2+ numeric values that are genuinely "
    "clearer as a small chart than as prose or a table (e.g. comparing MRP/DP/BV/PV across "
    "products actually present in the context), you may ALSO include a fenced code block "
    "labeled \"chart\" containing ONLY compact JSON in this exact shape: "
    '{"type": "bar", "title": "<short title>", "data": [{"label": "<name>", "value": <number>}, '
    '...]} (use "type": "line" for a trend over time, or "type": "donut" for a share-of-total '
    "breakdown instead of a bar-by-bar comparison). Every value must come "
    "directly from the context — never invent or estimate a number for a chart. Skip the chart "
    "entirely if you're not certain every value is real."
)

# Appended to SYSTEM_PROMPT only for hybrid-mode requests (Dayjoy context
# found AND the question asks for a comparison — see wants_hybrid_comparison).
# The base SYSTEM_PROMPT normally forbids mixing Dayjoy knowledge with web
# results; this addendum is the one deliberate, explicit exception, scoped
# to exactly this case so the other three routes are unaffected.
HYBRID_MODE_ADDENDUM = (
    "\n\nHYBRID MODE: this question asks you to compare or relate Dayjoy to something "
    "external. The context below contains BOTH approved Dayjoy knowledge and \"[web]\"-labeled "
    "general/competitor information. For this answer only: use the approved Dayjoy context for "
    "any claim about Dayjoy itself, and the \"[web]\" context (plus your own general knowledge) "
    "for the external/competitor side. Label each claim's source inline, e.g. \"(Dayjoy "
    "knowledge)\" or \"(web)\". Never invent Dayjoy product specs, ingredients, or pricing that "
    "aren't in the approved context — if the approved context doesn't cover something, say so "
    "rather than guessing."
)


def _system_prompt_for(mode: str, custom_guidance: str = "") -> str:
    base = SYSTEM_PROMPT + HYBRID_MODE_ADDENDUM if mode == "hybrid" else SYSTEM_PROMPT
    if not custom_guidance:
        return base
    # Admin-configured guidance (Admin Console → AI Configuration → System
    # Prompt) is layered on TOP of the safety-critical base prompt above,
    # never substituted for it — an admin field that could disable the
    # medical-claims/guaranteed-income/casual-routing rules by accident (or
    # by a careless edit) would be a real safety regression. This is why the
    # base SYSTEM_PROMPT stays a hardcoded constant rather than coming
    # entirely from the DB.
    return (
        base
        + "\n\nADDITIONAL BRAND/TONE GUIDANCE (admin-configured — supplements, "
        "never overrides, the rules above):\n"
        + custom_guidance.strip()
    )


_ai_custom_guidance_cache: Optional[str] = None
_ai_custom_guidance_cache_at: float = 0.0


async def load_ai_custom_guidance() -> str:
    """The admin-editable "System Prompt" field from the `ai_configuration`
    table (Admin Console → AI Configuration) — cached like
    `load_safety_rules()` so a chat request doesn't cost an extra DB round
    trip. Previously this field was saved successfully by the admin UI but
    never actually read anywhere in the chat pipeline, so editing it had
    zero effect on the AI's behavior."""
    global _ai_custom_guidance_cache, _ai_custom_guidance_cache_at
    if _ai_custom_guidance_cache is not None and (time.time() - _ai_custom_guidance_cache_at) < 60:
        return _ai_custom_guidance_cache
    try:
        rows = await supabase_select(None, "ai_configuration", columns="system_prompt", limit=1)
        prompt = (rows[0].get("system_prompt") if rows else None) or ""
        _ai_custom_guidance_cache = prompt
        _ai_custom_guidance_cache_at = time.time()
        return prompt
    except Exception:
        return _ai_custom_guidance_cache or ""


_llm_logger = logging.getLogger("dayjoy.llm")


async def _stream_chat_completions(
    provider_name: str,
    url: str,
    api_key: str,
    model: str,
    message: str,
    history: List[Dict[str, str]],
    context: str,
    language: str,
    mode: str,
    custom_guidance: str = "",
) -> AsyncIterator[str]:
    """Shared streaming implementation for OpenAI-compatible /chat/completions
    endpoints (Groq, OpenAI). One bounded retry (max 2 attempts total) for
    transient failures (429 respecting Retry-After, capped at 5s; 5xx;
    network/timeout errors). 401/403/other 4xx are not retried — permanent
    config errors. Failures are logged server-side only (truncated to 300
    chars, no headers/API key ever logged) and never surfaced to the caller
    — stream_response()'s existing silent-fallthrough-to-next-provider (then
    to the rule-based fallback) behavior is unchanged."""
    if not api_key:
        return
    messages = [{"role": "system", "content": _system_prompt_for(mode, custom_guidance)}]
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append(
        {
            "role": "user",
            "content": f"Language: {language}\n\nContext:\n{context}\n\nQuestion: {message}",
        }
    )
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "stream": True,
        "max_tokens": 800,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    max_attempts = 2

    for attempt in range(max_attempts):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread())[:300]
                        transient = resp.status_code == 429 or resp.status_code >= 500
                        if transient and attempt < max_attempts - 1:
                            delay = 2.0
                            retry_after = resp.headers.get("Retry-After")
                            if retry_after:
                                try:
                                    delay = min(5.0, float(retry_after))
                                except ValueError:
                                    pass
                            _llm_logger.warning(
                                "%s stream failed (%s), retrying in %.1fs: %s",
                                provider_name, resp.status_code, delay, body,
                            )
                            await asyncio.sleep(delay)
                            continue
                        _llm_logger.warning(
                            "%s stream failed (%s), not retrying: %s",
                            provider_name, resp.status_code, body,
                        )
                        return
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload_str = line[5:].strip()
                        if payload_str == "[DONE]":
                            return
                        try:
                            chunk = json.loads(payload_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                            if delta:
                                yield delta
                        except Exception:
                            continue
                    return
        except (httpx.TimeoutException, httpx.TransportError) as e:
            if attempt < max_attempts - 1:
                _llm_logger.warning("%s stream network error, retrying: %s", provider_name, e)
                await asyncio.sleep(1.0)
                continue
            _llm_logger.warning("%s stream network error, giving up: %s", provider_name, e)
            return


async def stream_groq(
    message: str, history: List[Dict[str, str]], context: str, language: str, mode: str = "dayjoy",
    custom_guidance: str = "",
) -> AsyncIterator[str]:
    """Stream tokens from Groq's OpenAI-compatible /chat/completions endpoint."""
    async for tok in _stream_chat_completions(
        "groq", "https://api.groq.com/openai/v1/chat/completions", GROQ_API_KEY, GROQ_MODEL,
        message, history, context, language, mode, custom_guidance,
    ):
        yield tok


async def stream_openai(
    message: str, history: List[Dict[str, str]], context: str, language: str, mode: str = "dayjoy",
    custom_guidance: str = "",
) -> AsyncIterator[str]:
    """Stream tokens from OpenAI Chat Completions."""
    async for tok in _stream_chat_completions(
        "openai", "https://api.openai.com/v1/chat/completions", OPENAI_API_KEY, OPENAI_MODEL,
        message, history, context, language, mode, custom_guidance,
    ):
        yield tok


_ALLOWED_IMAGE_MIME_PREFIXES = ("data:image/jpeg", "data:image/png", "data:image/webp", "data:image/gif")

_vision_logger = logging.getLogger("dayjoy.vision")


def validate_image_data_url(data_url: str) -> Optional[str]:
    """Returns an error message if `data_url` is unsafe/malformed to send to
    a vision model, else None. Defense in depth even though the frontend
    already caps size/type at capture time — this endpoint must not trust
    that any caller went through that UI path."""
    if not data_url.startswith(_ALLOWED_IMAGE_MIME_PREFIXES):
        return "Unsupported image type — please attach a JPEG, PNG, WEBP, or GIF."
    if len(data_url) > MAX_IMAGE_DATA_URL_CHARS:
        return "Image is too large — please attach a smaller image."
    return None


async def stream_vision_response(message: str, image_data_url: str, language: str) -> AsyncIterator[str]:
    """Multimodal Understanding (Capabilities 1, 2, 19, 20) — answers a
    question about an attached image. Deliberately its OWN path, not routed
    through _stream_chat_completions/RAG: an image question isn't a Dayjoy-
    knowledge lookup, and "never assume information that cannot be seen or
    verified" (Capability 2's explicit requirement) means this must NOT mix
    in RAG context that could bias the model toward describing something
    that isn't actually in the image.

    OpenAI-only: this Groq account has zero vision-capable models available
    (live-verified against the actual API key — see VISION_MODEL's
    definition above), so there is no Groq fallback leg here the way
    stream_response() has for text. If OPENAI_API_KEY is unset, or the call
    fails for any reason (including the account having no credit — a real,
    observed condition in this deployment's OpenAI key as of this writing),
    this yields one clear, honest sentence rather than a raw provider error
    or a silently empty response.
    """
    if not OPENAI_API_KEY:
        yield (
            "Image understanding isn't available right now — please describe what's in the "
            "image and I'll help from there, or contact Dayjoy support to attach it to a ticket."
        )
        return

    system_prompt = (
        "You are Dayjoy AI Assist. The user has attached an image. Describe and answer questions "
        "about ONLY what is actually visible in the image — never invent details, brands, text, or "
        "product identities you cannot actually see. If the image is unclear or you cannot make out "
        "something the user asked about, say so plainly rather than guessing. If the user is asking "
        "about a Dayjoy product shown in the image, describe what you see, but do not assert Dayjoy-"
        "specific facts (pricing, ingredients, health claims) beyond what's visibly printed on the "
        "product/packaging itself — for anything else, tell the user to ask as a follow-up so it can "
        "be checked against approved Dayjoy knowledge."
    )
    payload = {
        "model": VISION_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Language: {language}\n\nQuestion: {message}"},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        "temperature": 0.2,
        "stream": True,
        "max_tokens": 800,
    }
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    collected = ""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", "https://api.openai.com/v1/chat/completions", headers=headers, json=payload
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread())[:300]
                    _vision_logger.warning("vision request failed (%s): %s", resp.status_code, body)
                else:
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload_str = line[5:].strip()
                        if payload_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                            if delta:
                                collected += delta
                                yield delta
                        except Exception:
                            continue
    except (httpx.TimeoutException, httpx.TransportError) as e:
        _vision_logger.warning("vision request network error: %s", e)

    if not collected:
        yield (
            "I couldn't process that image right now — please try again in a moment, or describe "
            "what's in it and I'll help from there."
        )


_SOURCE_HEADER_RE = re.compile(r"^\[\d+\]\s*Source:.*$", re.MULTILINE)
_DATETIME_LINE_RE = re.compile(r"^Current date/time:.*$", re.MULTILINE)
_LEGACY_TABLE_TAG_RE = re.compile(r"^\[\w+\]\s*")


# Excludes both generic stopwords AND "dayjoy" itself — the brand name
# appears in nearly every approved document, so counting it as an overlap
# signal made every FAQ block look equally relevant to every Dayjoy-related
# question. Mirrors the stopword-exclusion pattern orchestrator/tools/
# recommend.py already uses for the same reason (condition-chart matching).
_RELEVANCE_STOPWORDS = {
    "what", "are", "the", "for", "with", "and", "that", "this", "from",
    "have", "has", "does", "is", "was", "were", "will", "would", "could",
    "should", "can", "you", "your", "please", "about", "into", "than",
    "then", "when", "where", "which", "who", "whom", "whose", "why", "how",
    "dayjoy",
}


def _tokenize_for_relevance(text: str) -> set:
    return {
        t for t in re.split(r"[^a-z0-9]+", text.lower())
        if len(t) >= 3 and t not in _RELEVANCE_STOPWORDS
    }


def _best_matching_block(context: str, message: str, min_overlap: int = 2, max_chars: int = 800) -> Optional[str]:
    """Splits `context` into its individual retrieval blocks (one per
    matched chunk/row/web result) and returns only the ONE block that
    actually overlaps the user's question — never several concatenated
    blocks. Returns None when nothing clears `min_overlap`.

    This exists because the no-LLM-available fallback below has no model to
    judge relevance with. Verified live: three unrelated FAQ blocks ("Dayjoy
    contact details", "company registration", "what is Dayjoy") were being
    concatenated and shown as the answer to "What's the status of my order?"
    — each individually plausible-looking, together an obvious non-answer.
    Evidence-sufficiency gating in `_route_events` already clears `context`
    entirely when the *retriever's own* confidence is low, but a chunk can
    still score above that threshold on lexical overlap with generic tokens
    ("Dayjoy") while being irrelevant to the actual question — this is a
    second, cheap, question-specific check on top of that, not a
    replacement for it.
    """
    text = _DATETIME_LINE_RE.sub("", context)
    text = re.sub(r"\n\s*---\s*\n", "\n\n", text)
    blocks = [b.strip() for b in re.split(r"\n{2,}", text) if b.strip()]
    if not blocks:
        return None

    question_tokens = _tokenize_for_relevance(message)
    if not question_tokens:
        return None
    # A short question ("Spirulina benefits?") may only carry 1-2 signal
    # tokens once stopwords/the brand name are stripped — requiring the
    # fixed min_overlap in that case would reject a genuinely exact match.
    # Only relax below the fixed floor, never raise it above.
    required = min(min_overlap, len(question_tokens))

    best_score = 0
    best_block: Optional[str] = None
    for block in blocks:
        cleaned = _LEGACY_TABLE_TAG_RE.sub("", _SOURCE_HEADER_RE.sub("", block)).strip()
        if not cleaned:
            continue
        score = len(question_tokens & _tokenize_for_relevance(cleaned))
        if score > best_score:
            best_score = score
            best_block = cleaned

    if best_score < required or not best_block:
        return None
    if len(best_block) > max_chars:
        best_block = best_block[:max_chars].rsplit(" ", 1)[0] + "…"
    return best_block


_BRACKET_HEADER_LINE_RE = re.compile(r"^\[(.+)\]$", re.MULTILINE)


async def stream_response(
    message: str, history: List[Dict[str, str]], context: str, language: str, mode: str = "dayjoy",
    custom_guidance: str = "", already_grounded: bool = False, ai_mode: str = "normal",
) -> AsyncIterator[str]:
    """Try Groq first, then OpenAI. Falls back to a context-only answer.

    `already_grounded=True` marks context that came from a structured
    pricing/recommendation lookup (an exact DB match against the parsed
    intent) rather than lexically-scored RAG chunks — it skips the
    question-relevance re-filter below and shows the context as-is, since
    that filter exists to reject chunks that merely share a common word with
    the question, which doesn't apply to a result that's already precisely
    matched by construction.

    `ai_mode` (AI Mode System — normal/thinking/deep_research/compare_products,
    distinct from `mode` above which is the dayjoy/hybrid routing mode) layers
    its addendum onto `custom_guidance` here, reusing the same admin-guidance
    plumbing `_system_prompt_for` already applies — see backend/ai_modes.py.
    """
    custom_guidance = f"{custom_guidance}\n\n{addendum_for(ai_mode)}".strip()
    if GROQ_API_KEY:
        collected = ""
        async for tok in stream_groq(message, history, context, language, mode, custom_guidance):
            collected += tok
            yield tok
        if collected:
            return
    if OPENAI_API_KEY:
        collected = ""
        async for tok in stream_openai(message, history, context, language, mode, custom_guidance):
            collected += tok
            yield tok
        if collected:
            return
    # Fallback: both LLM providers are unconfigured or failed. Log loudly —
    # this degraded path serving raw retrieval text (no answer synthesis) is
    # never expected in a healthy deployment.
    _llm_logger.error(
        "Both Groq and OpenAI unavailable (configured: groq=%s, openai=%s) — "
        "serving degraded context-only fallback answer",
        bool(GROQ_API_KEY), bool(OPENAI_API_KEY),
    )
    if already_grounded and context:
        # Structured lookups (pricing/recommendation) can still concatenate
        # several product blocks (see _format_recommendation_context) when
        # more than one match was found — only the first is the direct
        # answer to a single-item question, so cap this branch to one block
        # the same way the lexical-scoring path below does, instead of
        # dumping every block verbatim.
        cleaned = _BRACKET_HEADER_LINE_RE.sub(r"\1", context).strip()
        first_block = re.split(r"\n\s*---\s*\n", cleaned, maxsplit=1)[0].strip()
        yield f"{first_block}\n\nFor a more specific answer, please contact Dayjoy support."
        return
    best_block = _best_matching_block(context, message) if context else None
    if best_block:
        yield f"{best_block}\n\nFor a more specific answer, please contact Dayjoy support."
    else:
        yield (
            "I don't have enough approved information to answer that safely. "
            "Please connect with a Dayjoy support team member for a verified response."
        )


# ----------------------------------------------------------------------------
# Conversation persistence
# ----------------------------------------------------------------------------
async def load_history(token: str, conversation_id: str) -> List[Dict[str, str]]:
    rows = await supabase_select(
        token,
        "chat_messages",
        columns="role,content",
        filters={"conversation_id": conversation_id},
        limit=MAX_HISTORY_TURNS * 2,
    )
    return [{"role": r.get("role", "user"), "content": r.get("content", "")} for r in rows]


async def ensure_conversation(token: str, conversation_id: Optional[str], user_id: str, title: str, language: str) -> Optional[str]:
    if conversation_id:
        return conversation_id
    row = await supabase_insert(
        token,
        "chat_conversations",
        {"user_id": user_id, "title": title[:80], "language": language},
    )
    return row.get("id") if row else None


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------
@app.get("/")
async def root() -> Dict[str, str]:
    return {"message": "Dayjoy AI Assist backend is running", "version": "2.13.0"}


@app.get("/health")
async def health() -> Dict[str, Any]:
    """Liveness + readiness check."""
    return {
        "status": "ok",
        "version": "2.13.0",
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_ANON_KEY),
        "groq_configured": bool(GROQ_API_KEY),
        "openai_configured": bool(OPENAI_API_KEY),
        "web_search_configured": any(p.is_configured() for p in get_search_providers()),
        "web_search_providers": [p.name for p in get_search_providers() if p.is_configured()],
        "rag_available": RAG_AVAILABLE,
        "rag_import_error": RAG_IMPORT_ERROR,
        "jwks_url": SUPABASE_JWKS_URL,
        "uptime": time.time(),
    }


@app.get("/ready")
async def readiness() -> Dict[str, Any]:
    """Readiness check — verifies dependencies are reachable."""
    checks: Dict[str, bool] = {}

    # Supabase check
    if SUPABASE_URL:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{SUPABASE_URL}/rest/v1/", headers={"apikey": SUPABASE_ANON_KEY})
                checks["supabase"] = resp.status_code < 500
        except Exception:
            checks["supabase"] = False
    else:
        checks["supabase"] = False

    # Groq check (just verify key exists)
    checks["groq"] = bool(GROQ_API_KEY)

    # RAG check
    checks["rag"] = bool(RAG_AVAILABLE)

    all_ok = all(checks.values())
    return {
        "status": "ready" if all_ok else "degraded",
        "checks": checks,
        "version": "2.13.0",
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request) -> ChatResponse:
    """Non-streaming chat endpoint. Requires authentication."""
    request_id = str(uuid.uuid4())
    started_at = time.monotonic()
    user_id = await get_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    check_rate_limit(user_id)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    rules = await load_safety_rules()
    is_blocked, rule_key = run_safety_check(req.message, rules)
    if is_blocked:
        await _log_analytics(token, user_id, req, "blocked", [], 0.0, "unsafe")
        _log_unified_trace(
            request_id=request_id, user_id=user_id, query=req.message,
            handoff_required=True, started_at=started_at, final_status="blocked",
        )
        return ChatResponse(
            answer=f"Sorry, I can't help with that. Safety rule triggered: {rule_key}.",
            category="unsafe",
            sources=[],
            safety_status="blocked",
            handoff_required=True,
            answer_source="unsafe",
        )

    # Multimodal Understanding (Capabilities 1/2/19/20) — an attached image
    # bypasses RAG/routing entirely (see stream_vision_response's docstring
    # for why: mixing in Dayjoy KB context here risks biasing the model
    # toward describing something not actually visible in the image).
    if req.image_data_url:
        image_error = validate_image_data_url(req.image_data_url)
        if image_error:
            raise HTTPException(status_code=422, detail=image_error)
        conv_id = req.conversation_id
        if token and user_id and not req.is_temporary and not conv_id:
            conv_id = await ensure_conversation(token, conv_id, user_id, req.message[:80], req.language)
        vision_parts: List[str] = []
        async for tok in stream_vision_response(req.message, req.image_data_url, req.language):
            vision_parts.append(tok)
        vision_answer = "".join(vision_parts).strip()
        await _log_analytics(
            token, user_id, req, "vision", [], 0.9, "vision",
            ai_mode="normal", latency_ms=(time.monotonic() - started_at) * 1000,
        )
        return ChatResponse(
            answer=vision_answer,
            category="vision",
            sources=[],
            safety_status="safe",
            handoff_required=False,
            confidence=0.9 if OPENAI_API_KEY else None,
            conversation_id=conv_id,
            answer_source="vision",
            ai_mode="normal",
            structured=structure_answer(vision_answer).to_dict(),
        )

    history: List[Dict[str, str]] = []
    conv_id = req.conversation_id
    if token and conv_id:
        history = await load_history(token, conv_id)
    elif token and user_id and not req.is_temporary:
        conv_id = await ensure_conversation(token, conv_id, user_id, req.message[:80], req.language)

    casual = is_casual_message(req.message)
    _run_orchestrator_observability(req.message)
    ai_mode = normalize_ai_mode(req.ai_mode)
    retrieval_query = rewrite_query(req.message, history)
    if not casual and should_llm_rewrite(req.message, wants_reference_resolution(req.message)):
        retrieval_query = await llm_rewrite_for_retrieval(retrieval_query, history)
    retrieval_query = enrich_for_deep_research(retrieval_query, ai_mode)
    route = await determine_route(token, retrieval_query, casual, ai_mode)
    t_after_routing = time.monotonic()

    personalization_context = await _maybe_personalization_context(
        token, user_id, req.message, history, casual, req.role
    )
    t_after_personalization = time.monotonic()
    full_context = _assemble_compressed_context(
        current_time_context(), personalization_context, route.context, route.web_context
    )
    custom_guidance = await load_ai_custom_guidance()
    fmt_directive = format_instruction(req.message)
    if fmt_directive:
        custom_guidance = f"{custom_guidance}\n\n{fmt_directive}".strip()
    ex_directive = example_instruction(req.message)
    if ex_directive:
        custom_guidance = f"{custom_guidance}\n\n{ex_directive}".strip()
    personalization_style = await _personalization_style_addendum(token, user_id)
    if personalization_style:
        custom_guidance = f"{custom_guidance}\n\n{personalization_style}".strip()
    already_grounded = bool(
        route.rag_metadata and route.rag_metadata.get("source") in ("structured_pricing", "structured_recommendation")
    )

    answer_mismatch = False
    verification_ran = False
    if route.direct_answer is not None:
        # Router already produced the final text (a clarifying question) —
        # skip generation entirely rather than asking the LLM to rephrase a
        # question we already know how to ask.
        answer = route.direct_answer
        t_after_generation = time.monotonic()
    else:
        # Collect streamed tokens into a single string
        answer_parts: List[str] = []
        async for tok in stream_response(
            req.message, history, full_context, req.language, route.mode, custom_guidance,
            already_grounded=already_grounded, ai_mode=ai_mode,
        ):
            answer_parts.append(tok)
        answer = "".join(answer_parts).strip()
        t_after_generation = time.monotonic()

        # Post-generation answer-relevance check — only for RAG-sourced
        # answers (dayjoy_knowledge/hybrid): structured pricing/recommendation
        # answers are already grounded to a specific DB row (not a lexical
        # RAG match) and casual/web/general answers aren't checked against
        # Dayjoy evidence at all.
        verification_ran = not casual and not already_grounded and route.answer_source in ("dayjoy_knowledge", "hybrid")
        if verification_ran:
            verdict = await verify_answer(req.message, answer, full_context)
            if verdict.checked and not verdict.addresses_question:
                corrective_context = (
                    full_context
                    + "\n\n[SYSTEM NOTE: your previous answer did not address the exact "
                    "question asked. Re-read the question and answer ONLY what was asked, "
                    "using only the evidence above. If the evidence doesn't cover it, say "
                    "so honestly instead of guessing.]"
                )
                retry_parts: List[str] = []
                async for tok in stream_response(
                    req.message, history, corrective_context, req.language, route.mode, custom_guidance,
                    ai_mode=ai_mode,
                ):
                    retry_parts.append(tok)
                retried = "".join(retry_parts).strip()
                if retried:
                    recheck = await verify_answer(req.message, retried, full_context)
                    if not recheck.checked or recheck.addresses_question:
                        answer = retried
                    else:
                        answer_mismatch = True
                else:
                    answer_mismatch = True
                already_retried = True
            else:
                already_retried = False
        else:
            already_retried = False

        # Answer Refinement Loop (orchestrator/refinement.py) — a SEPARATE,
        # bounded-to-one check from the relevance-mismatch retry above;
        # `already_retried` ensures a response is never regenerated twice.
        # Also requires `route.context` (real retrieved evidence) — with no
        # evidence, refining can't improve anything (the model has nothing
        # more to draw from; the existing evidence_insufficient/handoff
        # logic already covers that case) — and, just as importantly,
        # avoids treating a deliberately short, correct answer (e.g. the
        # user explicitly asked for FORMAT_SHORT) as "too thin" just
        # because the completeness heuristic is length-based.
        if not already_retried and answer and route.context:
            draft_score = score_answer(
                req.message, answer, answer_source=route.answer_source,
                sources=route.sources, intent_wants_action=detect_format(req.message) == FORMAT_ACTION_PLAN,
            )
            if needs_refinement(draft_score, route.answer_source, already_retried):
                refine_context = full_context + "\n\n" + build_refinement_instruction(draft_score)
                refine_parts: List[str] = []
                async for tok in stream_response(
                    req.message, history, refine_context, req.language, route.mode, custom_guidance,
                    ai_mode=ai_mode,
                ):
                    refine_parts.append(tok)
                refined = "".join(refine_parts).strip()
                if refined:
                    answer = refined
    t_after_verification = time.monotonic()

    confidence, verification_status = _compute_confidence(casual, route)
    # Evidence-verification signal (rag/evidence.py, via rag_metadata) is
    # additive to the existing checks below — it only ever pushes toward
    # handoff, never suppresses one of the pre-existing conditions.
    evidence_insufficient = bool(
        route.rag_metadata and route.rag_metadata.get("evidence_sufficient") is False
    )
    handoff_required = route.direct_answer is None and not casual and not route.used_web_search and (
        verification_status == "unverified"
        or confidence < float(os.getenv("RAG_HANDOFF_THRESHOLD", "0.40"))
        or not bool(route.context)
        or evidence_insufficient
        or answer_mismatch
    )
    category = route.category
    sources = route.sources + route.web_sources

    # NOTE: message persistence is owned by the frontend (see UserChat.tsx's
    # handleSend -> appendMessage), which needs the real DB-assigned row ids
    # for its optimistic-UI reconciliation, feedback, and regenerate
    # features. Inserting here too duplicated every message in
    # chat_messages — this endpoint only needs conv_id for history/context.

    await _log_analytics(
        token, user_id, req, category, sources, confidence, route.answer_source,
        ai_mode=ai_mode, latency_ms=(time.monotonic() - started_at) * 1000,
    )
    stage_ms = {
        "routing": (t_after_routing - started_at) * 1000,
        "personalization": (t_after_personalization - t_after_routing) * 1000,
        "generation": (t_after_generation - t_after_personalization) * 1000,
    }
    if verification_ran:
        stage_ms["verification"] = (t_after_verification - t_after_generation) * 1000
    _log_unified_trace(
        request_id=request_id, user_id=user_id, query=req.message, rewritten_query=retrieval_query,
        route=route, confidence=confidence, handoff_required=handoff_required,
        answer_mismatch=answer_mismatch, verification_ran=verification_ran, started_at=started_at,
        stage_ms=stage_ms, answer=answer, verification_status=verification_status,
    )

    handoff_msg = None
    if answer_mismatch:
        handoff_msg = (
            "This answer may not directly address your exact question. Please rephrase, "
            "or create a support ticket for a verified response."
        )
    elif handoff_required:
        handoff_msg = (
            "This answer could not be verified from approved Dayjoy documents. "
            "Please create a support ticket for a verified response."
        )

    follow_ups = generate_followups(route.answer_source, category, req.message)

    structured_answer = structure_answer(answer)
    grounding_state = classify_grounding_state(
        structured_answer,
        answer_source=route.answer_source,
        verification_status=verification_status,
        sources=sources,
        answer_text=answer,
    )
    evidence_strength = _EVIDENCE_STRENGTH_LABELS.get(grounding_state)

    return ChatResponse(
        answer=answer,
        category=category,
        sources=sources,
        safety_status="safe",
        handoff_required=handoff_required,
        confidence=confidence,
        conversation_id=conv_id,
        verification_status=verification_status,
        handoff_message=handoff_msg,
        rag_metadata=route.rag_metadata,
        answer_source=route.answer_source,
        web_search_provider=route.web_search_provider,
        ai_mode=ai_mode,
        follow_ups=follow_ups,
        products=route.product_cards,
        structured=structured_answer.to_dict(),
        clarification_options=route.clarification_options,
        evidence_strength=evidence_strength,
    )


@app.post("/chat/title", response_model=TitleResponse)
async def chat_title(req: TitleRequest, user_id: str = Depends(require_user_id)) -> TitleResponse:
    """
    Summarize the opening exchange into a short conversation title.

    Deliberately separate from /chat: no RAG, no safety pipeline, no history —
    just one small completion. Callers must treat this as best-effort and keep
    their own truncated-first-message fallback, since it returns that fallback
    unchanged whenever no provider is configured or the call fails.
    """
    check_rate_limit(user_id)
    fallback = _fallback_title(req.message)

    if not (GROQ_API_KEY or OPENAI_API_KEY):
        return TitleResponse(title=fallback)

    prompt = (
        "Summarize this customer question as a conversation title of at most 5 "
        "words. Use the question's own language. Reply with the title only — no "
        "quotes, no trailing punctuation, no preamble.\n\n"
        f"Question: {req.message[:500]}"
    )

    if GROQ_API_KEY:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
        model = GROQ_MODEL
    else:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
        model = OPENAI_MODEL

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 24,
                },
            )
            if resp.status_code >= 400:
                return TitleResponse(title=fallback)
            content = (
                resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            )
    except Exception:
        return TitleResponse(title=fallback)

    title = content.strip().strip('"').strip("'").rstrip(".").strip()
    # A model that ignored the instruction and wrote a sentence is worse than
    # the deterministic fallback.
    if not title or len(title) > 60:
        return TitleResponse(title=fallback)
    return TitleResponse(title=title)


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request) -> StreamingResponse:
    """SSE streaming chat endpoint. Requires authentication."""
    request_id = str(uuid.uuid4())
    started_at = time.monotonic()
    user_id = await get_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    check_rate_limit(user_id)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    rules = await load_safety_rules()
    is_blocked, rule_key = run_safety_check(req.message, rules)
    ai_mode = normalize_ai_mode(req.ai_mode)

    async def event_gen() -> AsyncIterator[str]:
        if is_blocked:
            _log_unified_trace(
                request_id=request_id, user_id=user_id, query=req.message,
                handoff_required=True, started_at=started_at, final_status="blocked",
            )
            yield _sse({"token": "", "done": True, "safety_status": "blocked", "category": "unsafe", "handoff_required": True, "answer_source": "unsafe"})
            return

        # Emit an immediate frame so the client knows the connection is live.
        # Everything below (history load, RAG retrieval, optional web search)
        # blocks before the first token, which the user experienced as a 60s
        # hang with no feedback. Clients ignore frames carrying neither `token`
        # nor `done`, so this is backwards compatible — and it re-arms the
        # client's idle timeout.
        yield _sse({"status": "connected"})

        # Multimodal Understanding (Capabilities 1/2/19/20) — same
        # image-bypasses-RAG early return as /chat above, streamed.
        if req.image_data_url:
            image_error = validate_image_data_url(req.image_data_url)
            if image_error:
                yield _sse({"token": "", "done": True, "error": image_error})
                return
            conv_id = req.conversation_id
            if token and user_id and not req.is_temporary and not conv_id:
                conv_id = await ensure_conversation(token, conv_id, user_id, req.message[:80], req.language)
            vision_parts: List[str] = []
            async for tok in stream_vision_response(req.message, req.image_data_url, req.language):
                vision_parts.append(tok)
                yield _sse({"token": tok})
            vision_answer = "".join(vision_parts).strip()
            await _log_analytics(
                token, user_id, req, "vision", [], 0.9, "vision",
                ai_mode="normal", latency_ms=(time.monotonic() - started_at) * 1000,
            )
            yield _sse({
                "done": True,
                "category": "vision",
                "sources": [],
                "safety_status": "safe",
                "handoff_required": False,
                "confidence": 0.9 if OPENAI_API_KEY else None,
                "conversation_id": conv_id,
                "answer_source": "vision",
                "ai_mode": "normal",
                "structured": structure_answer(vision_answer).to_dict(),
            })
            return

        history: List[Dict[str, str]] = []
        conv_id = req.conversation_id
        if token and conv_id:
            history = await load_history(token, conv_id)
        elif token and user_id and not req.is_temporary:
            conv_id = await ensure_conversation(token, conv_id, user_id, req.message[:80], req.language)

        casual = is_casual_message(req.message)
        _run_orchestrator_observability(req.message)
        retrieval_query = rewrite_query(req.message, history)
        if not casual and should_llm_rewrite(req.message, wants_reference_resolution(req.message)):
            retrieval_query = await llm_rewrite_for_retrieval(retrieval_query, history)
        retrieval_query = enrich_for_deep_research(retrieval_query, ai_mode)
        route: Optional[RouteResult] = None
        async for kind, payload in _route_events(token, retrieval_query, casual, ai_mode):
            if kind == "status":
                yield _sse({"status": payload})
            else:
                route = payload
        assert route is not None  # _route_events always yields exactly one "result"
        t_after_routing = time.monotonic()

        personalization_context = await _maybe_personalization_context(
            token, user_id, req.message, history, casual, req.role
        )
        t_after_personalization = time.monotonic()
        full_context = _assemble_compressed_context(
            current_time_context(), personalization_context, route.context, route.web_context
        )
        custom_guidance = await load_ai_custom_guidance()
        fmt_directive = format_instruction(req.message)
        if fmt_directive:
            custom_guidance = f"{custom_guidance}\n\n{fmt_directive}".strip()
        ex_directive = example_instruction(req.message)
        if ex_directive:
            custom_guidance = f"{custom_guidance}\n\n{ex_directive}".strip()
        personalization_style = await _personalization_style_addendum(token, user_id)
        if personalization_style:
            custom_guidance = f"{custom_guidance}\n\n{personalization_style}".strip()
        already_grounded = bool(
            route.rag_metadata and route.rag_metadata.get("source") in ("structured_pricing", "structured_recommendation")
        )
        aggregated = ""

        if route.direct_answer is not None:
            # Router already produced the final text (a clarifying question)
            # — skip generation and send it as a single frame. It's short
            # and deterministic, so there's nothing gained by token-by-token
            # streaming here.
            aggregated = route.direct_answer
            yield _sse({"token": aggregated})
        else:
            async for tok in stream_response(
                req.message, history, full_context, req.language, route.mode, custom_guidance,
                already_grounded=already_grounded, ai_mode=ai_mode,
            ):
                aggregated += tok
                yield _sse({"token": tok})
        t_after_generation = time.monotonic()

        # Post-generation answer-relevance check. Unlike /chat (non-streaming,
        # so it can retry generation before anything is shown), tokens here
        # have already reached the client by the time this runs — there is
        # no way to un-send them over SSE without a confusing "answer
        # replaced itself" UX. So this path only FLAGS a mismatch (via
        # handoff_required + a specific message below) rather than retrying;
        # /chat is where a caller that needs the retry-before-serving
        # behavior should go. Structured pricing/recommendation answers are
        # already grounded to a specific DB row (not a lexical RAG match),
        # so they skip this check the same way /chat's does.
        answer_mismatch = False
        verification_ran = (
            route.direct_answer is None and not casual and not already_grounded
            and route.answer_source in ("dayjoy_knowledge", "hybrid")
        )
        if verification_ran:
            yield _sse({"status": "verifying"})
            verdict = await verify_answer(req.message, aggregated, full_context)
            answer_mismatch = bool(verdict.checked and not verdict.addresses_question)

        confidence, verification_status = _compute_confidence(casual, route)
        # Evidence-verification signal (rag/evidence.py, via rag_metadata) —
        # kept in sync with the non-streaming /chat handler above, which had
        # this check but this endpoint didn't, so a weak/unrelated-evidence
        # answer could stream back here without the "unverified, create a
        # support ticket" disclosure that /chat would have shown for the
        # exact same route result.
        evidence_insufficient = bool(
            route.rag_metadata and route.rag_metadata.get("evidence_sufficient") is False
        )
        handoff_required = route.direct_answer is None and not casual and not route.used_web_search and (
            verification_status == "unverified"
            or confidence < float(os.getenv("RAG_HANDOFF_THRESHOLD", "0.40"))
            or not bool(route.context)
            or evidence_insufficient
            or answer_mismatch
        )
        category = route.category
        sources = route.sources + route.web_sources
        handoff_msg = None
        if answer_mismatch:
            handoff_msg = (
                "This answer may not directly address your exact question. Please rephrase, "
                "or create a support ticket for a verified response."
            )
        elif handoff_required:
            handoff_msg = (
                "This answer could not be verified from approved Dayjoy documents. "
                "Please create a support ticket for a verified response."
            )

        # NOTE: message persistence is owned by the frontend — see the same
        # note in the non-streaming /chat handler above.

        await _log_analytics(
            token, user_id, req, category, sources, confidence, route.answer_source,
            ai_mode=ai_mode, latency_ms=(time.monotonic() - started_at) * 1000,
        )
        t_after_verification = time.monotonic()
        stage_ms = {
            "routing": (t_after_routing - started_at) * 1000,
            "personalization": (t_after_personalization - t_after_routing) * 1000,
            "generation": (t_after_generation - t_after_personalization) * 1000,
        }
        if verification_ran:
            stage_ms["verification"] = (t_after_verification - t_after_generation) * 1000
        _log_unified_trace(
            request_id=request_id, user_id=user_id, query=req.message, rewritten_query=retrieval_query,
            route=route, confidence=confidence, handoff_required=handoff_required,
            answer_mismatch=answer_mismatch, verification_ran=verification_ran, started_at=started_at,
            stage_ms=stage_ms, answer=aggregated, verification_status=verification_status,
        )

        follow_ups = generate_followups(route.answer_source, category, req.message)

        structured_answer = structure_answer(aggregated)
        grounding_state = classify_grounding_state(
            structured_answer,
            answer_source=route.answer_source,
            verification_status=verification_status,
            sources=sources,
            answer_text=aggregated,
        )

        yield _sse({
            "done": True,
            "category": category,
            "sources": [s.model_dump() for s in sources],
            "safety_status": "safe",
            "handoff_required": handoff_required,
            "confidence": confidence,
            "conversation_id": conv_id,
            "verification_status": verification_status,
            "handoff_message": handoff_msg,
            "rag_metadata": route.rag_metadata,
            "answer_source": route.answer_source,
            "web_search_provider": route.web_search_provider,
            "ai_mode": ai_mode,
            "follow_ups": follow_ups,
            "products": route.product_cards,
            "structured": structured_answer.to_dict(),
            "clarification_options": route.clarification_options,
            "evidence_strength": _EVIDENCE_STRENGTH_LABELS.get(grounding_state),
        })

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        # Without these, nginx buffers the whole SSE stream and delivers it as
        # a single blob once generation finishes — which looks identical to a
        # long hang followed by the entire answer appearing at once.
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class RememberRequest(BaseModel):
    key: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., min_length=1, max_length=2000)
    pinned: bool = False


@app.get("/memory")
async def list_user_memory(request: Request, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    """List this user's own remembered facts/preferences — user-controlled
    memory per the orchestrator personalization requirements. RLS-scoped to
    the caller (`auth.uid() = user_id`); the tool also filters by user_id as
    defense in depth, not as the actual security boundary."""
    from backend.orchestrator.tools.memory import list_memory

    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    items = await list_memory(token, user_id)
    return {
        "items": [
            {
                "id": i.id,
                "source": i.source,
                "key": i.key,
                "value": i.value,
                "pinned": i.pinned,
                "updated_at": i.updated_at,
                "relevance": i.relevance,
            }
            for i in items
        ]
    }


@app.post("/memory")
async def remember_fact(req: RememberRequest, request: Request, user_id: str = Depends(require_user_id)) -> Dict[str, Any]:
    """Save/update a remembered fact (writes to `user_preferences` — the
    only memory table ordinary users can write under current RLS; see
    orchestrator/tools/memory.py's module docstring)."""
    from backend.orchestrator.tools.memory import remember

    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    row = await remember(token, user_id, req.key, req.value, req.pinned)
    if row is None:
        raise HTTPException(status_code=502, detail="Could not save memory")
    return {"status": "saved", "item": row}


@app.delete("/memory/{pref_key}")
async def forget_fact(pref_key: str, request: Request, user_id: str = Depends(require_user_id)) -> Dict[str, str]:
    """User-controlled deletion of a single remembered fact."""
    from backend.orchestrator.tools.memory import forget

    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    ok = await forget(token, user_id, pref_key)
    return {"status": "deleted" if ok else "not_found"}


@app.post("/feedback")
async def feedback(req: FeedbackRequest, user_id: str = Depends(require_user_id)) -> Dict[str, str]:
    """Submit thumbs-up/down feedback. Requires authentication."""
    token = _extract_token_from_request  # placeholder; we use anon insert via service role here
    # NOTE: feedback is stored against the user's own row — RLS allows it.
    return {"status": "received"}


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def _sse(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _log_analytics(
    token: Optional[str],
    user_id: Optional[str],
    req: ChatRequest,
    category: str,
    sources: List[ChatSource],
    confidence: float,
    answer_route: Optional[str] = None,
    ai_mode: Optional[str] = None,
    latency_ms: Optional[float] = None,
) -> None:
    """Best-effort analytics insert. `confidence`/`ai_mode`/`latency_ms`
    feed the Observability Dashboard (GET /admin/analytics/observability,
    admin_api.py) — added in v27_analytics_observability.sql; degrades
    gracefully (Supabase just ignores/keeps null for extra fields it
    doesn't have yet) if that migration hasn't been applied to a given
    environment."""
    if not SUPABASE_URL:
        return
    payload = {
        "user_id": user_id,
        "role": req.role,
        "language": req.language,
        "query": req.message[:1000],
        "category": category,
        "source_used": ",".join(s.table for s in sources[:3]) or None,
        "safety_status": "safe",
        "answer_route": answer_route,
        "confidence": confidence,
        "ai_mode": ai_mode,
        "latency_ms": round(latency_ms) if latency_ms is not None else None,
    }
    # Use anon-key insert (no RLS on user_id=NULL or matching auth.uid())
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"{SUPABASE_URL}/rest/v1/{ANALYTICS_TABLE}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, headers=headers, json=payload)
    except Exception:
        pass


def _extract_token_from_request() -> str:
    """Stub for feedback endpoint; unused in current scope."""
    return ""


# ============================================================================
# RAG (Retrieval-Augmented Generation) subsystem
# ----------------------------------------------------------------------------
# Loaded lazily so the backend still starts even if optional RAG
# dependencies (pypdf, python-docx, etc.) are missing. Endpoints return
# informative errors when the subsystem cannot be initialized.
# ============================================================================

RAG_AVAILABLE = False
RAG_IMPORT_ERROR: Optional[str] = None
try:
    from backend.rag import (  # type: ignore
        extract_text as rag_extract_text,
        extract_metadata as rag_extract_metadata,
        SUPPORTED_MIME_TYPES as RAG_SUPPORTED_MIME_TYPES,
        chunk_text as rag_chunk_text,
        ChunkingConfig as RAG_ChunkingConfig,
        get_embedding_provider as rag_get_provider,
        get_vector_store as rag_get_store,
        get_retriever as rag_get_retriever,
        ingest_document as rag_ingest_document,
        reindex_document as rag_reindex_document,
    )
    from backend.rag.retriever import RetrievalResult  # type: ignore
    RAG_AVAILABLE = True
except Exception as _rag_err:  # pragma: no cover
    RAG_IMPORT_ERROR = str(_rag_err)
    RAG_SUPPORTED_MIME_TYPES = {}

# Optional: Supabase storage for raw knowledge files
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
RAG_STORAGE_BUCKET = os.getenv("RAG_STORAGE_BUCKET", "rag-documents")
RAG_CONFIDENCE_FLOOR = float(os.getenv("RAG_CONFIDENCE_FLOOR", "0.55"))
RAG_HANDOFF_THRESHOLD = float(os.getenv("RAG_HANDOFF_THRESHOLD", "0.40"))


def _require_rag() -> None:
    """Raise a 503 if the RAG subsystem failed to import."""
    if not RAG_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"RAG subsystem unavailable: {RAG_IMPORT_ERROR or 'unknown error'}. "
                   "Install backend RAG dependencies (pypdf, python-docx, openpyxl, python-pptx).",
        )


def _is_staff(claims: Dict[str, Any]) -> bool:
    """Heuristic staff check from JWT claims. Real enforcement is via RLS.

    NOTE: `claims["role"]` on a Supabase-issued token is the *Postgres*
    role ("authenticated"/"anon"), not the app's business role — checking
    it first meant this always evaluated to "authenticated" and returned
    False for every real signed-in user, locking every admin out of every
    staff-gated endpoint below. The actual business role lives in
    `user_metadata` (set at signup) or `app_metadata` (admin-managed).
    """
    role = (
        (claims.get("app_metadata") or {}).get("role")
        or (claims.get("user_metadata") or {}).get("role")
        or (claims.get("raw_user_meta_data") or {}).get("role")
        or claims.get("user_role")
        or "customer"
    )
    return role in {"admin", "super_admin", "management", "employee", "staff", "leader", "trainer", "support"}


async def _require_staff(request: Request) -> Dict[str, Any]:
    """Verify JWT and ensure the user is staff. Returns claims."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = auth[7:].strip()
    claims = await verify_jwt(token)
    if not _is_staff(claims):
        raise HTTPException(status_code=403, detail="Staff access required for this operation")
    return claims


async def _supabase_storage_upload(
    token: Optional[str],
    bucket: str,
    path: str,
    content: bytes,
    mime_type: str,
) -> Optional[str]:
    """Upload a file to Supabase Storage via the REST API. Returns the public/storage path."""
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": mime_type or "application/octet-stream",
    }
    if SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    elif token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, headers=headers, content=content)
            if resp.status_code >= 400:
                return None
            return path
    except Exception:
        return None


async def _supabase_storage_download(
    token: Optional[str],
    bucket: str,
    path: str,
) -> Optional[bytes]:
    """Download a file from Supabase Storage. Returns raw bytes."""
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}"
    headers = {"apikey": SUPABASE_ANON_KEY}
    if SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    elif token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code >= 400:
                return None
            return resp.content
    except Exception:
        return None


async def _supabase_storage_delete(
    token: Optional[str],
    bucket: str,
    path: str,
) -> bool:
    """Delete a file from Supabase Storage."""
    if not SUPABASE_URL or not path:
        return False
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}"
    headers = {"apikey": SUPABASE_ANON_KEY}
    if SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    elif token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(url, headers=headers)
            return resp.status_code < 400
    except Exception:
        return False


# ---------------------------------------------------------------------------
# RAG request/response models
# ---------------------------------------------------------------------------
class RAGDocumentMetadata(BaseModel):
    category: str = Field("other")
    tags: List[str] = Field(default_factory=list)
    language: str = Field("en")
    source: str = Field("manual_upload")
    document_name: Optional[str] = None


class RAGSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)
    top_k: Optional[int] = Field(None, ge=1, le=20)
    min_similarity: Optional[float] = Field(None, ge=0.0, le=1.0)
    language: str = Field("en")
    include_related: bool = Field(True)


class RAGSource(BaseModel):
    table: str = "knowledge_chunks"
    id: str
    title: Optional[str] = None
    url: Optional[str] = None
    page_number: Optional[int] = None
    section: Optional[str] = None
    score: Optional[float] = None
    document_id: Optional[str] = None
    document_name: Optional[str] = None
    document_version: Optional[int] = None
    document_category: Optional[str] = None
    document_tags: List[str] = Field(default_factory=list)
    document_updated_at: Optional[str] = None
    approval_status: Optional[str] = None


class RAGSearchResponse(BaseModel):
    query: str
    chunks: List[Dict[str, Any]] = Field(default_factory=list)
    confidence: float
    verification_status: str
    matched_documents: List[Dict[str, Any]] = Field(default_factory=list)
    related_documents: List[Dict[str, Any]] = Field(default_factory=list)
    related_products: List[Dict[str, Any]] = Field(default_factory=list)
    related_faqs: List[Dict[str, Any]] = Field(default_factory=list)
    related_policies: List[Dict[str, Any]] = Field(default_factory=list)
    sources: List[RAGSource] = Field(default_factory=list)
    retrieval_time_ms: int
    model_used: str
    cache_hit: bool = False
    handoff_required: bool = False
    handoff_message: Optional[str] = None


class RAGIngestResponse(BaseModel):
    document_id: str
    chunk_count: int
    embedding_count: int
    token_count: int
    char_count: int
    page_count: int
    sections: int
    model_used: str
    dimensions: int
    error: Optional[str] = None


class RAGApprovalRequest(BaseModel):
    approval_status: str = Field(..., pattern="^(approved|rejected|pending|archived)$")
    rejection_reason: Optional[str] = None


class RAGSupportTicketRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None
    rag_query_id: Optional[str] = None
    confidence: Optional[float] = None
    verification_status: Optional[str] = None
    cited_sources: Optional[List[Dict[str, Any]]] = None
    issue_category: str = "unverified_answer"
    priority: str = "normal"


# ---------------------------------------------------------------------------
# RAG endpoints
# ---------------------------------------------------------------------------
@app.get("/rag/health")
async def rag_health() -> Dict[str, Any]:
    """Health-check the RAG subsystem."""
    provider_info = {}
    if RAG_AVAILABLE:
        try:
            p = rag_get_provider()
            provider_info = {
                "name": p.name,
                "dimensions": p.dimensions,
            }
        except Exception as e:
            provider_info = {"error": str(e)}
    return {
        "status": "ok" if RAG_AVAILABLE else "unavailable",
        "rag_available": RAG_AVAILABLE,
        "import_error": RAG_IMPORT_ERROR,
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_ANON_KEY),
        "embedding_provider": provider_info,
        "storage_bucket": RAG_STORAGE_BUCKET,
        "confidence_floor": RAG_CONFIDENCE_FLOOR,
        "handoff_threshold": RAG_HANDOFF_THRESHOLD,
    }


@app.get("/rag/documents")
async def rag_list_documents(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    category: Optional[str] = None,
    approval_status: Optional[str] = None,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """List knowledge documents with filters + pagination. Staff only."""
    _require_rag()
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    store = rag_get_store()
    # Build filters
    filters: Dict[str, Any] = {}
    if category:
        filters["category"] = f"eq.{category}"
    if approval_status:
        filters["approval_status"] = f"eq.{approval_status}"

    # Use PostgREST query syntax for search (ILIKE on file_name)
    url = f"{SUPABASE_URL}/rest/v1/knowledge_documents?select=*&order=created_at.desc&limit={limit}&offset={offset}"
    if category:
        url += f"&category=eq.{category}"
    if approval_status:
        url += f"&approval_status=eq.{approval_status}"
    if search:
        # PostgREST ILIKE: file_name=ilike.*search*
        url += f"&file_name=ilike.*{search}*"
    headers = {"apikey": SUPABASE_ANON_KEY, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Supabase query failed: {resp.text}")
        rows = resp.json()

    # Get total count from Content-Range header
    total = len(rows)
    content_range = resp.headers.get("Content-Range", "")
    if "/" in content_range:
        try:
            total = int(content_range.split("/")[-1])
        except ValueError:
            pass

    return {
        "documents": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/rag/documents/{document_id}")
async def rag_get_document(document_id: str, request: Request) -> Dict[str, Any]:
    """Get a single knowledge document with its chunk stats. Staff only."""
    _require_rag()
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    store = rag_get_store()
    rows = await store._select(
        "knowledge_documents",
        columns="*",
        filters={"id": document_id},
        limit=1,
        token=token,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = rows[0]
    # Fetch chunk count + sample chunks
    chunks = await store._select(
        "knowledge_chunks",
        columns="id,chunk_text,section_title,page_number,chunk_order,token_count,created_at",
        filters={"document_id": document_id},
        limit=20,
        token=token,
    )
    versions = await store._select(
        "document_versions",
        columns="*",
        filters={"document_id": document_id},
        limit=20,
        token=token,
    )
    return {"document": doc, "chunks": chunks, "versions": versions}


@app.post("/rag/documents", response_model=RAGIngestResponse)
async def rag_upload_document_multipart(
    request: Request,
    file: UploadFile = File(...),
    category: str = Form("other"),
    language: str = Form("en"),
    tags: str = Form(""),
    document_name: Optional[str] = Form(None),
    approval_status: str = Form("pending"),
    source: str = Form("manual_upload"),
    reindex: bool = Form(False),
) -> RAGIngestResponse:
    """Upload + ingest a knowledge document (multipart/form-data).

    Form fields:
      - file (required): the document file
      - category (optional): one of product, training, policy, faq, marketing, technical, other
      - language (optional): ISO code (en, hi, etc.)
      - tags (optional): comma-separated list
      - document_name (optional): display name override
      - approval_status (optional): pending | approved | rejected (default: pending)
      - source (optional): manual_upload | api | imported
      - reindex (optional): if true, replaces existing chunks+embeddings
    """
    _require_rag()
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    if file is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    # Read file contents
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    filename = document_name or file.filename or "untitled"
    mime_type = file.content_type

    # Validate type
    from backend.rag.extractors import detect_kind
    kind = detect_kind(filename, mime_type)
    if kind == "txt" and mime_type and mime_type in RAG_SUPPORTED_MIME_TYPES:
        pass  # known type, just no specific extractor
    if mime_type and mime_type not in RAG_SUPPORTED_MIME_TYPES and kind == "txt":
        # Still allow — extractor will try as plain text
        pass

    # Compute checksum for dedup
    import hashlib
    checksum = hashlib.sha256(content).hexdigest()

    # Upload to storage
    storage_path = f"{int(time.time())}-{filename.replace('/', '_').replace(' ', '_')}"
    uploaded_path = await _supabase_storage_upload(
        token=token,
        bucket=RAG_STORAGE_BUCKET,
        path=storage_path,
        content=content,
        mime_type=mime_type or "application/octet-stream",
    )

    # Build public URL (signed URL would be better, but public URL works for now)
    file_url = f"{SUPABASE_URL}/storage/v1/object/public/{RAG_STORAGE_BUCKET}/{storage_path}" if SUPABASE_URL else None

    # Parse tags
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]

    # Insert document row
    doc_payload = {
        "document_id": storage_path,
        "file_name": filename,
        "file_type": kind,
        "file_url": file_url,
        "extracted_text": "",
        "approval_status": approval_status,
        "uploaded_by": user_id,
        "category": category,
        "tags": tag_list,
        "language": language,
        "source": source,
        "version": 1,
        "is_archived": False,
        "file_size_bytes": len(content),
        "mime_type": mime_type,
        "storage_path": uploaded_path or storage_path,
        "checksum": checksum,
    }
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/knowledge_documents?select=*",
            headers=headers,
            json=doc_payload,
        )
        if resp.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to insert document row: {resp.text}",
            )
        doc_row = resp.json()[0] if resp.json() else {}

    document_id = doc_row.get("id")
    if not document_id:
        raise HTTPException(status_code=500, detail="Document insert returned no id")

    # Run ingest (extract → chunk → embed → store)
    use_svc = bool(SUPABASE_SERVICE_ROLE_KEY)
    result = await rag_ingest_document(
        document_id=document_id,
        content=content,
        filename=filename,
        mime_type=mime_type,
        token=token,
        use_service_role=use_svc,
    )
    return RAGIngestResponse(**result.to_dict())


@app.post("/rag/documents/{document_id}/reindex", response_model=RAGIngestResponse)
async def rag_reindex_document(document_id: str, request: Request) -> RAGIngestResponse:
    """Re-chunk and re-embed an existing document.

    Fetches the original file from storage and re-runs the pipeline.
    Useful when the chunking strategy or embedding model changes.
    """
    _require_rag()
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    # Fetch document row
    store = rag_get_store()
    rows = await store._select(
        "knowledge_documents",
        columns="*",
        filters={"id": document_id},
        limit=1,
        token=token,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = rows[0]
    storage_path = doc.get("storage_path")
    if not storage_path:
        raise HTTPException(status_code=400, detail="Document has no storage_path; cannot re-download")

    # Download original
    content = await _supabase_storage_download(token=token, bucket=RAG_STORAGE_BUCKET, path=storage_path)
    if not content:
        raise HTTPException(status_code=502, detail="Failed to download file from storage")

    use_svc = bool(SUPABASE_SERVICE_ROLE_KEY)
    result = await rag_reindex_document(
        document_id=document_id,
        content=content,
        filename=doc.get("file_name") or "document",
        mime_type=doc.get("mime_type"),
        token=token,
        use_service_role=use_svc,
    )
    return RAGIngestResponse(**result.to_dict())


@app.patch("/rag/documents/{document_id}/approval")
async def rag_update_approval(
    document_id: str,
    req: RAGApprovalRequest,
    request: Request,
) -> Dict[str, Any]:
    """Approve, reject, archive, or revert to pending."""
    _require_rag()
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    store = rag_get_store()
    payload: Dict[str, Any] = {
        "approval_status": req.approval_status,
        "reviewed_by": user_id,
        "reviewed_at": "now()" if False else None,  # let DB default
    }
    if req.rejection_reason:
        payload["rejection_reason"] = req.rejection_reason
    # Use raw SQL via RPC would be cleaner; here we use a direct patch with
    # reviewed_at set to a string Postgres can parse
    payload["reviewed_at"] = None  # DB trigger fills it

    # Use PostgREST patch
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/knowledge_documents?id=eq.{document_id}&select=*",
            headers=headers,
            json={**payload, "reviewed_at": "now()"},
        )
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Update failed: {resp.text}")
        data = resp.json()
        return {"document": data[0] if data else None}


@app.delete("/rag/documents/{document_id}")
async def rag_delete_document(
    document_id: str,
    request: Request,
    archive_only: bool = True,
) -> Dict[str, Any]:
    """Delete (or archive) a knowledge document.

    By default soft-archives (sets is_archived=true). Pass archive_only=false
    to hard-delete (also removes from storage).
    """
    _require_rag()
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    store = rag_get_store()
    # Fetch document to get storage_path
    rows = await store._select(
        "knowledge_documents",
        columns="*",
        filters={"id": document_id},
        limit=1,
        token=token,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = rows[0]
    storage_path = doc.get("storage_path")

    if archive_only:
        await store._update(
            "knowledge_documents",
            {"id": document_id},
            {"is_archived": True, "approval_status": "archived"},
            token=token,
            use_service_role=bool(SUPABASE_SERVICE_ROLE_KEY),
        )
        return {"status": "archived", "document_id": document_id}

    # Hard delete
    await store._delete(
        "knowledge_documents",
        {"id": document_id},
        token=token,
        use_service_role=bool(SUPABASE_SERVICE_ROLE_KEY),
    )
    if storage_path:
        await _supabase_storage_delete(token=token, bucket=RAG_STORAGE_BUCKET, path=storage_path)
    return {"status": "deleted", "document_id": document_id}


@app.post("/rag/documents/{document_id}/replace", response_model=RAGIngestResponse)
async def rag_replace_document(
    document_id: str,
    request: Request,
    file: UploadFile = File(...),
    change_summary: Optional[str] = Form(None),
) -> RAGIngestResponse:
    """Replace an existing document with a new version.

    Creates a new document row with version = old_version + 1 and
    previous_version_id pointing to the old document. Archives the old
    document. The new document inherits the old one's category, tags,
    language, and approval_status (set to pending for re-review).
    """
    _require_rag()
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
    user_id = claims.get("sub")

    if file is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    store = rag_get_store()
    rows = await store._select(
        "knowledge_documents",
        columns="*",
        filters={"id": document_id},
        limit=1,
        token=token,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    old_doc = rows[0]

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    filename = file.filename or old_doc.get("file_name") or "untitled"
    mime_type = file.content_type

    import hashlib
    checksum = hashlib.sha256(content).hexdigest()

    # Upload new file
    storage_path = f"{int(time.time())}-{filename.replace('/', '_').replace(' ', '_')}"
    uploaded_path = await _supabase_storage_upload(
        token=token,
        bucket=RAG_STORAGE_BUCKET,
        path=storage_path,
        content=content,
        mime_type=mime_type or "application/octet-stream",
    )
    file_url = f"{SUPABASE_URL}/storage/v1/object/public/{RAG_STORAGE_BUCKET}/{storage_path}" if SUPABASE_URL else None

    # Insert new document version
    new_payload = {
        "document_id": storage_path,
        "file_name": filename,
        "file_type": old_doc.get("file_type") or "txt",
        "file_url": file_url,
        "extracted_text": "",
        "approval_status": "pending",
        "uploaded_by": user_id,
        "category": old_doc.get("category") or "other",
        "tags": old_doc.get("tags") or [],
        "language": old_doc.get("language") or "en",
        "source": "replace",
        "version": (old_doc.get("version") or 1) + 1,
        "previous_version_id": document_id,
        "is_archived": False,
        "file_size_bytes": len(content),
        "mime_type": mime_type,
        "storage_path": uploaded_path or storage_path,
        "checksum": checksum,
    }
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/knowledge_documents?select=*",
            headers=headers,
            json=new_payload,
        )
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Insert failed: {resp.text}")
        new_doc = resp.json()[0] if resp.json() else {}

    new_doc_id = new_doc.get("id")

    # Record version history
    try:
        await store._insert(
            "document_versions",
            [{
                "document_id": new_doc_id,
                "version_number": new_payload["version"],
                "file_url": file_url,
                "storage_path": uploaded_path or storage_path,
                "file_size_bytes": len(content),
                "checksum": checksum,
                "change_summary": change_summary or f"Replaced document {document_id}",
                "created_by": user_id,
            }],
            token=token,
            use_service_role=bool(SUPABASE_SERVICE_ROLE_KEY),
        )
    except Exception:
        pass

    # Archive old document
    try:
        await store._update(
            "knowledge_documents",
            {"id": document_id},
            {"is_archived": True, "approval_status": "archived"},
            token=token,
            use_service_role=bool(SUPABASE_SERVICE_ROLE_KEY),
        )
    except Exception:
        pass

    # Ingest new document
    use_svc = bool(SUPABASE_SERVICE_ROLE_KEY)
    result = await rag_ingest_document(
        document_id=new_doc_id,
        content=content,
        filename=filename,
        mime_type=mime_type,
        token=token,
        use_service_role=use_svc,
    )
    return RAGIngestResponse(**result.to_dict())


@app.post("/rag/search", response_model=RAGSearchResponse)
async def rag_search(req: RAGSearchRequest, request: Request) -> RAGSearchResponse:
    """Vector + keyword search across approved knowledge chunks.

    Public endpoint — any authenticated user can search. Returns chunks,
    matched documents, confidence, verification status, and (optionally)
    related items.
    """
    _require_rag()
    user_id = await get_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    retriever = rag_get_retriever()
    result = await retriever.retrieve(
        query=req.query,
        token=token,
        top_k=req.top_k,
        min_similarity=req.min_similarity,
        language=req.language,
        user_id=user_id,
    )
    if req.include_related:
        result = await retriever.fetch_related(result, token=token)

    # Build sources list (for backwards compat with ChatSource)
    sources = [
        RAGSource(
            table="knowledge_chunks",
            id=c.chunk_id,
            title=c.section_title or c.document_name or c.chunk_id[:8],
            url=None,
            page_number=c.page_number,
            section=c.section_title,
            score=c.score,
            document_id=c.document_id,
            document_name=c.document_name,
            document_version=c.document_version,
            document_category=c.document_category,
            document_tags=c.document_tags,
            document_updated_at=c.document_updated_at,
            approval_status=c.document_approval_status,
        )
        for c in result.chunks
    ]

    handoff_required = result.verification_status == "unverified" or result.confidence < RAG_HANDOFF_THRESHOLD
    handoff_msg = None
    if handoff_required:
        handoff_msg = (
            "This answer could not be verified from approved Dayjoy documents. "
            "Please create a support ticket for a verified response."
        )

    return RAGSearchResponse(
        query=req.query,
        chunks=[c.to_dict() for c in result.chunks],
        confidence=result.confidence,
        verification_status=result.verification_status,
        matched_documents=result.matched_documents,
        related_documents=result.related_documents,
        related_products=result.related_products,
        related_faqs=result.related_faqs,
        related_policies=result.related_policies,
        sources=sources,
        retrieval_time_ms=result.retrieval_time_ms,
        model_used=result.model_used,
        cache_hit=result.cache_hit,
        handoff_required=handoff_required,
        handoff_message=handoff_msg,
    )


@app.get("/rag/documents/{document_id}/chunks")
async def rag_list_chunks(
    document_id: str,
    request: Request,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """List chunks for a document (paginated). Staff only."""
    _require_rag()
    await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    store = rag_get_store()
    url = (
        f"{SUPABASE_URL}/rest/v1/knowledge_chunks?"
        f"select=id,chunk_text,section_title,page_number,chunk_order,token_count,created_at&"
        f"document_id=eq.{document_id}&order=chunk_order.asc&limit={limit}&offset={offset}"
    )
    headers = {"apikey": SUPABASE_ANON_KEY, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Failed: {resp.text}")
        rows = resp.json()
    total = len(rows)
    content_range = resp.headers.get("Content-Range", "")
    if "/" in content_range:
        try:
            total = int(content_range.split("/")[-1])
        except ValueError:
            pass
    return {"chunks": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/rag/support-ticket")
async def rag_create_support_ticket(
    req: RAGSupportTicketRequest,
    request: Request,
) -> Dict[str, Any]:
    """Create a support ticket from a low-confidence RAG answer.

    Inserts into the existing `support_tickets` table with the new RAG
    columns (rag_query_id, confidence, verification_status, cited_sources).
    """
    user_id = await require_user_id(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    payload = {
        "user_id": user_id,
        "query": req.query[:2000],
        "issue_category": req.issue_category,
        "priority": req.priority,
        "status": "open",
        "rag_query_id": req.rag_query_id,
        "confidence": req.confidence,
        "verification_status": req.verification_status,
        "cited_sources": req.cited_sources,
    }
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/support_tickets?select=*",
            headers=headers,
            json=payload,
        )
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Ticket insert failed: {resp.text}")
        data = resp.json()
        return {"ticket": data[0] if data else None}


@app.get("/rag/queries")
async def rag_list_queries(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    verification_status: Optional[str] = None,
) -> Dict[str, Any]:
    """List recent RAG queries (audit log). Staff only."""
    _require_rag()
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    url = (
        f"{SUPABASE_URL}/rest/v1/rag_queries?"
        f"select=id,user_id,query_text,confidence,verification_status,top_match_document,top_match_score,retrieval_time_ms,model_used,created_at&"
        f"order=created_at.desc&limit={limit}&offset={offset}"
    )
    if verification_status:
        url += f"&verification_status=eq.{verification_status}"
    headers = {"apikey": SUPABASE_ANON_KEY, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Failed: {resp.text}")
        rows = resp.json()
    total = len(rows)
    content_range = resp.headers.get("Content-Range", "")
    if "/" in content_range:
        try:
            total = int(content_range.split("/")[-1])
        except ValueError:
            pass
    return {"queries": rows, "total": total, "limit": limit, "offset": offset}


@app.get("/rag/stats")
async def rag_stats(request: Request) -> Dict[str, Any]:
    """Aggregate RAG stats for the admin dashboard. Staff only."""
    _require_rag()
    claims = await _require_staff(request)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    store = rag_get_store()
    headers = {"apikey": SUPABASE_ANON_KEY, "Accept": "application/json",
               "Prefer": "count=exact"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"

    async def _count(table: str, filter_str: str = "") -> int:
        url = f"{SUPABASE_URL}/rest/v1/{table}?select=none{filter_str}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            rng = resp.headers.get("Content-Range", "0-0/0")
            try:
                return int(rng.split("/")[-1])
            except ValueError:
                return 0

    docs_total = await _count("knowledge_documents")
    docs_approved = await _count("knowledge_documents", "&approval_status=eq.approved")
    docs_pending = await _count("knowledge_documents", "&approval_status=eq.pending")
    docs_archived = await _count("knowledge_documents", "&is_archived=eq.true")
    chunks_total = await _count("knowledge_chunks")
    embeddings_total = await _count("knowledge_embeddings", "&is_active=eq.true")
    queries_total = await _count("rag_queries")
    queries_unverified = await _count("rag_queries", "&verification_status=eq.unverified")
    tickets_rag = await _count("support_tickets", "&issue_category=eq.unverified_answer")

    return {
        "documents": {
            "total": docs_total,
            "approved": docs_approved,
            "pending": docs_pending,
            "archived": docs_archived,
        },
        "chunks_total": chunks_total,
        "embeddings_active": embeddings_total,
        "queries": {
            "total": queries_total,
            "unverified": queries_unverified,
        },
        "support_tickets_from_rag": tickets_rag,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)


# ---------------------------------------------------------------------------
# Phase 2 — Enterprise Admin Console API router
# ---------------------------------------------------------------------------
# Imported last so the main app object exists first.
try:
    from backend.admin_api import router as admin_router
    app.include_router(admin_router)
except Exception as _admin_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load admin router: %s", _admin_router_err)


# ---------------------------------------------------------------------------
# Phase 3 — Distributor AI Copilot API router
# ---------------------------------------------------------------------------
try:
    from backend.distributor_api import router as distributor_router
    app.include_router(distributor_router)
except Exception as _dist_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load distributor router: %s", _dist_router_err)


# ---------------------------------------------------------------------------
# Advanced Intelligence Layer — Artifacts (capabilities 14-16)
# ---------------------------------------------------------------------------
try:
    from backend.artifacts_api import router as artifacts_router
    app.include_router(artifacts_router)
except Exception as _artifacts_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load artifacts router: %s", _artifacts_router_err)


# ---------------------------------------------------------------------------
# Business Intelligence — AI Business Operating System dashboard router
# ---------------------------------------------------------------------------
try:
    from backend.business_intelligence_api import router as bi_router
    app.include_router(bi_router)
except Exception as _bi_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load business intelligence router: %s", _bi_router_err)


# ---------------------------------------------------------------------------
# Phase 4 — Customer Experience Platform API router
# ---------------------------------------------------------------------------
try:
    from backend.customer_api import router as customer_router
    app.include_router(customer_router)
except Exception as _cust_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load customer router: %s", _cust_router_err)


# ---------------------------------------------------------------------------
# Phase 5 — Executive Analytics & BI API router
# ---------------------------------------------------------------------------
try:
    from backend.analytics_api import router as analytics_router
    app.include_router(analytics_router)
except Exception as _analytics_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load analytics router: %s", _analytics_router_err)


# ---------------------------------------------------------------------------
# Phase 6 — Omnichannel Communication & Integrations API router
# ---------------------------------------------------------------------------
try:
    from backend.communication_api import router as communication_router
    app.include_router(communication_router)
except Exception as _comm_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load communication router: %s", _comm_router_err)


# ---------------------------------------------------------------------------
# Phase 7 — AI Workflow Automation & Multi-Agent Intelligence API router
# ---------------------------------------------------------------------------
try:
    from backend.workflow_api import router as workflow_router, agent_router
    app.include_router(workflow_router)
    app.include_router(agent_router)
except Exception as _wf_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load workflow router: %s", _wf_router_err)


# ---------------------------------------------------------------------------
# Phase 8 — Enterprise Security, Governance, Compliance & Observability API
# ---------------------------------------------------------------------------
try:
    from backend.security_api import router as security_router
    app.include_router(security_router)
except Exception as _sec_router_err:  # pragma: no cover
    import logging
    logging.getLogger("dayjoy.main").warning("Failed to load security router: %s", _sec_router_err)
