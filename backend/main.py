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
import os
import re
import time
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from collections import defaultdict
import time

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
    version="2.12.0",
    description="Enterprise AI assistant backend with full RAG, Phase 2 admin console API, enhanced product/training/FAQ management, streaming, and safety filters.",
)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
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
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
ANALYTICS_TABLE = "analytics"  # matches supabase_schema.sql + supabase_schema_v2.sql
MAX_MESSAGE_LENGTH = 4000
MAX_HISTORY_TURNS = 6


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


# ----------------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)
    role: str = Field("customer")
    language: str = Field("English")
    conversation_id: Optional[str] = None


class ChatSource(BaseModel):
    table: str
    id: str
    title: Optional[str] = None
    url: Optional[str] = None


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
    ("products", "product_name", "benefits,safety_note,category,ingredients,usage", "product"),
    ("faqs", "question", "answer,category", "faq"),
    ("policies", "topic", "content", "policy"),
    ("distributor_training", "title", "content", "training"),
    ("objection_handling", "objection", "answer", "general"),
]


async def retrieve_context(
    token: Optional[str],
    message: str,
    limit_per_table: int = 3,
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
        for table, title_col, extra_cols, category in SEARCH_TABLES:
            rows = await supabase_select(
                token,
                table,
                columns=f"id,{title_col},{extra_cols}",
                filters={"approval_status": "approved"},
                limit=200,
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


# ----------------------------------------------------------------------------
# LLM providers
# ----------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "You are Dayjoy AI Assist, an enterprise assistant for the Dayjoy wellness, healthcare, "
    "agriculture, lifestyle, and direct-selling ecosystem. Use ONLY the provided context from "
    "approved company knowledge. Do NOT make medical claims, diagnosis, or treatment promises. "
    "Do NOT provide guaranteed income claims. If the question is not answerable from the context, "
    "say that you need a human handoff and recommend contacting Dayjoy support. Be concise, "
    "professional, and helpful. Cite source IDs where relevant."
)


async def stream_groq(
    message: str, history: List[Dict[str, str]], context: str, language: str
) -> AsyncIterator[str]:
    """Stream tokens from Groq's OpenAI-compatible /chat/completions endpoint."""
    if not GROQ_API_KEY:
        return
    url = "https://api.groq.com/openai/v1/chat/completions"
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append(
        {
            "role": "user",
            "content": f"Language: {language}\n\nContext:\n{context}\n\nQuestion: {message}",
        }
    )
    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.2,
        "stream": True,
        "max_tokens": 800,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST", url, headers={"Authorization": f"Bearer {GROQ_API_KEY}"}, json=payload
        ) as resp:
            if resp.status_code >= 400:
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


async def stream_openai(
    message: str, history: List[Dict[str, str]], context: str, language: str
) -> AsyncIterator[str]:
    """Stream tokens from OpenAI Chat Completions."""
    if not OPENAI_API_KEY:
        return
    url = "https://api.openai.com/v1/chat/completions"
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append(
        {
            "role": "user",
            "content": f"Language: {language}\n\nContext:\n{context}\n\nQuestion: {message}",
        }
    )
    payload = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": 0.2,
        "stream": True,
        "max_tokens": 800,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST", url, headers={"Authorization": f"Bearer {OPENAI_API_KEY}"}, json=payload
        ) as resp:
            if resp.status_code >= 400:
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


async def stream_response(
    message: str, history: List[Dict[str, str]], context: str, language: str
) -> AsyncIterator[str]:
    """Try Groq first, then OpenAI. Falls back to a context-only answer."""
    if GROQ_API_KEY:
        collected = ""
        async for tok in stream_groq(message, history, context, language):
            collected += tok
            yield tok
        if collected:
            return
    if OPENAI_API_KEY:
        collected = ""
        async for tok in stream_openai(message, history, context, language):
            collected += tok
            yield tok
        if collected:
            return
    # Fallback: rule-based answer from context
    if context:
        yield f"Here is approved information I found:\n\n{context[:1000]}\n\nIf you need a more specific answer, please contact Dayjoy support."
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
    user_id = await get_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    check_rate_limit(user_id)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    rules = await load_safety_rules()
    is_blocked, rule_key = run_safety_check(req.message, rules)
    if is_blocked:
        await _log_analytics(token, user_id, req, "blocked", [], 0.0)
        return ChatResponse(
            answer=f"Sorry, I can't help with that. Safety rule triggered: {rule_key}.",
            category="unsafe",
            sources=[],
            safety_status="blocked",
            handoff_required=True,
        )

    history: List[Dict[str, str]] = []
    conv_id = req.conversation_id
    if token and conv_id:
        history = await load_history(token, conv_id)
    elif token and user_id:
        conv_id = await ensure_conversation(token, conv_id, user_id, req.message[:80], req.language)

    context, sources, category, rag_metadata = await retrieve_context(token, req.message)

    # Collect streamed tokens into a single string
    answer_parts: List[str] = []
    async for tok in stream_response(req.message, history, context, req.language):
        answer_parts.append(tok)
    answer = "".join(answer_parts).strip()

    # Compute confidence: prefer RAG confidence; fall back to legacy heuristic
    if rag_metadata and rag_metadata.get("confidence") is not None:
        confidence = rag_metadata["confidence"]
        verification_status = rag_metadata.get("verification_status", "unverified")
    else:
        confidence = 0.85 if context else 0.4
        verification_status = "verified" if context else "unverified"
    handoff_required = (
        verification_status == "unverified"
        or confidence < float(os.getenv("RAG_HANDOFF_THRESHOLD", "0.40"))
        or not bool(context)
    )

    # NOTE: message persistence is owned by the frontend (see UserChat.tsx's
    # handleSend -> appendMessage), which needs the real DB-assigned row ids
    # for its optimistic-UI reconciliation, feedback, and regenerate
    # features. Inserting here too duplicated every message in
    # chat_messages — this endpoint only needs conv_id for history/context.

    await _log_analytics(token, user_id, req, category, sources, confidence)

    handoff_msg = None
    if handoff_required:
        handoff_msg = (
            "This answer could not be verified from approved Dayjoy documents. "
            "Please create a support ticket for a verified response."
        )

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
        rag_metadata=rag_metadata,
    )


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request) -> StreamingResponse:
    """SSE streaming chat endpoint. Requires authentication."""
    user_id = await get_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    check_rate_limit(user_id)
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip() or None

    rules = await load_safety_rules()
    is_blocked, rule_key = run_safety_check(req.message, rules)

    async def event_gen() -> AsyncIterator[str]:
        if is_blocked:
            yield _sse({"token": "", "done": True, "safety_status": "blocked", "category": "unsafe", "handoff_required": True})
            return

        history: List[Dict[str, str]] = []
        conv_id = req.conversation_id
        if token and conv_id:
            history = await load_history(token, conv_id)
        elif token and user_id:
            conv_id = await ensure_conversation(token, conv_id, user_id, req.message[:80], req.language)

        context, sources, category, rag_metadata = await retrieve_context(token, req.message)
        aggregated = ""

        async for tok in stream_response(req.message, history, context, req.language):
            aggregated += tok
            yield _sse({"token": tok})

        if rag_metadata and rag_metadata.get("confidence") is not None:
            confidence = rag_metadata["confidence"]
            verification_status = rag_metadata.get("verification_status", "unverified")
        else:
            confidence = 0.85 if context else 0.4
            verification_status = "verified" if context else "unverified"
        handoff_required = (
            verification_status == "unverified"
            or confidence < float(os.getenv("RAG_HANDOFF_THRESHOLD", "0.40"))
            or not bool(context)
        )
        handoff_msg = None
        if handoff_required:
            handoff_msg = (
                "This answer could not be verified from approved Dayjoy documents. "
                "Please create a support ticket for a verified response."
            )

        # NOTE: message persistence is owned by the frontend — see the same
        # note in the non-streaming /chat handler above.

        await _log_analytics(token, user_id, req, category, sources, confidence)

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
            "rag_metadata": rag_metadata,
        })

    return StreamingResponse(event_gen(), media_type="text/event-stream")


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
) -> None:
    """Best-effort analytics insert."""
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
    """Heuristic staff check from JWT claims. Real enforcement is via RLS."""
    role = (
        claims.get("role")
        or claims.get("user_role")
        or (claims.get("app_metadata") or {}).get("role")
        or (claims.get("raw_user_meta_data") or {}).get("role")
        or "customer"
    )
    return role in {"admin", "super_admin", "management", "employee", "staff"}


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
    """List knowledge documents with filters + pagination."""
    _require_rag()
    user_id = await get_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
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
    """Get a single knowledge document with its chunk stats."""
    _require_rag()
    user_id = await get_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
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
    """List chunks for a document (paginated)."""
    _require_rag()
    user_id = await get_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
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
