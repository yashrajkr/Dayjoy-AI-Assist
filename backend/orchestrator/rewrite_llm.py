"""LLM-backed retrieval query optimization — Advanced Intelligence Layer
capability 3. Extends orchestrator/rewrite.py's regex-based pronoun
resolution (which stays as the free, always-on first pass — this only
handles what regex genuinely can't: misspellings, heavy Hinglish/mixed-
script normalization, and short/ambiguous queries with no clear referent
for the regex pass to latch onto).

Deliberately gated (`should_llm_rewrite`) rather than run on every message —
this is a real extra LLM call on the critical path, so it only fires when
the message actually looks like it needs it, to control latency/cost per
the brief's own "do not make every query pass through every component"
requirement.

Same safety convention as rewrite.py and decompose.py: augments/replaces
only the RETRIEVAL query, never what's sent to the model for generation
(that always stays req.message), and degrades to the input unchanged on
any failure — never blocks the response over a best-effort optimization.
"""

from __future__ import annotations

import re
from typing import Dict, List

import httpx

# Common Hindi function words written in Latin script — a message mixing
# these with English is a strong Hinglish signal that plain keyword/
# semantic retrieval (tuned on English/Devanagari Dayjoy content) may not
# match well against without normalization.
_HINGLISH_MARKERS_RE = re.compile(
    r"\b(kya|hai|kaise|kyun|kyu|kaunsa|kitna|kitni|acha|theek|nahi|nahin|"
    r"chahiye|karo|kare|ka|ki|ke|mein|mera|meri|mujhe|aap|aapka)\b",
    re.IGNORECASE,
)


def should_llm_rewrite(message: str, already_rewritten: bool) -> bool:
    """Gate — never fires when the free regex pass already resolved a
    reference (nothing more to gain), and only for messages actually short
    or Hinglish-flavored enough to plausibly benefit."""
    if already_rewritten:
        return False
    word_count = len(message.split())
    if word_count <= 3:
        return True
    if _HINGLISH_MARKERS_RE.search(message):
        return True
    return False


async def llm_rewrite_for_retrieval(message: str, history: List[Dict[str, str]]) -> str:
    """Best-effort — any failure (no LLM configured, network error, empty
    response) returns `message` unchanged."""
    import backend.main as backend_main  # lazy: avoid a circular import at module load time

    if backend_main.GROQ_API_KEY:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.GROQ_API_KEY}"}
        model = backend_main.GROQ_MODEL
    elif backend_main.OPENAI_API_KEY:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.OPENAI_API_KEY}"}
        model = backend_main.OPENAI_MODEL
    else:
        return message

    recent_turns = "\n".join(
        f"{m.get('role')}: {m.get('content', '')[:150]}" for m in history[-4:]
    )
    prompt = (
        "Rewrite the user's message below into a clear, well-formed English or Hindi search "
        "query optimized for retrieving relevant documents — fix obvious misspellings, expand "
        "Hinglish into clear phrasing, and resolve any short/ambiguous wording using the recent "
        "conversation for context. Preserve the user's original intent and language exactly — "
        "never add a new question or change what they're asking. "
        "Reply with ONLY the rewritten query text, no quotes, no explanation.\n\n"
        f"Recent conversation:\n{recent_turns or '(none)'}\n\n"
        f"User message: {message[:300]}"
    )

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 150,
                },
            )
            if resp.status_code >= 400:
                return message
            content = (
                resp.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            )
    except Exception:
        return message

    if not content:
        return message
    return content
