"""
Conversation history compression — Phase 3.

Once history exceeds a token threshold, compress older turns into a short
rolling summary instead of sending everything to the LLM on every turn.
Uses a single one-shot completion (mirrors the existing pattern in
backend/main.py's `/chat/title` endpoint) rather than a new subsystem, and
falls back to a deterministic truncation when no LLM key is configured —
same fallback-first philosophy as `stream_response()`.
"""

from __future__ import annotations

from typing import Dict, List

# ~4 chars/token heuristic (no tokenizer dependency) — consistent with the
# coarse char-based caps already used elsewhere in this codebase (e.g.
# retrieve_context's 4000-char context truncation).
CHARS_PER_TOKEN = 4
DEFAULT_TOKEN_THRESHOLD = 800


def _estimate_tokens(history: List[Dict[str, str]]) -> int:
    total_chars = sum(len(m.get("content", "")) for m in history)
    return total_chars // CHARS_PER_TOKEN


def needs_compression(history: List[Dict[str, str]], token_threshold: int = DEFAULT_TOKEN_THRESHOLD) -> bool:
    return _estimate_tokens(history) > token_threshold


def _fallback_summary(history: List[Dict[str, str]]) -> str:
    """No LLM configured/available — a deterministic, still-useful
    compression: keep the most recent few turns verbatim, drop the rest."""
    keep = history[-4:]
    return " | ".join(f"{m.get('role', 'user')}: {m.get('content', '')[:200]}" for m in keep)


async def summarize_history(history: List[Dict[str, str]]) -> str:
    """One-shot summary of `history`. Best-effort: any failure (no key, API
    error, timeout) falls back to `_fallback_summary` rather than raising —
    compression is an optimization, never a hard dependency of /chat."""
    if not history:
        return ""

    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    api_key = backend_main.GROQ_API_KEY or backend_main.OPENAI_API_KEY
    if not api_key:
        return _fallback_summary(history)

    if backend_main.GROQ_API_KEY:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.GROQ_API_KEY}"}
        model = backend_main.GROQ_MODEL
    else:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.OPENAI_API_KEY}"}
        model = backend_main.OPENAI_MODEL

    transcript = "\n".join(f"{m.get('role', 'user')}: {m.get('content', '')}" for m in history)
    prompt = (
        "Summarize this conversation in 2-4 sentences, preserving any facts, "
        "product names, or preferences the user stated that a later reply "
        "might need. Do not add commentary or preamble.\n\n" + transcript[:6000]
    )

    try:
        import httpx

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 200,
                },
            )
            if resp.status_code >= 400:
                return _fallback_summary(history)
            content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            return content.strip() or _fallback_summary(history)
    except Exception:
        return _fallback_summary(history)
