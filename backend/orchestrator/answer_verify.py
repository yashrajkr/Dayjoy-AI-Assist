"""
Post-generation answer verification — the one link in the pipeline that
genuinely didn't exist before this pass (see the pipeline audit this module
was added alongside): `rag/evidence.py`'s `verify_evidence()` only checks
whether the retrieved CHUNKS look relevant before generation. Nothing
previously checked whether the GENERATED ANSWER actually addresses the
question that was asked — which is exactly how a plausible-looking, weak-RAG
answer to a different question could slip through even after the
evidence-sufficiency gate added at `_route_events` (backend/main.py).

Deliberately a small, isolated LLM call rather than routed through
`_stream_chat_completions` (backend/main.py) — that helper builds the full
Dayjoy customer-persona system prompt meant for user-facing replies, which is
the wrong shape for a strict yes/no relevance classifier. Mirrors the same
minimal one-shot non-streaming completion pattern `/chat/title` already uses
in backend/main.py, not a new call style.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import httpx


@dataclass
class AnswerVerdict:
    addresses_question: bool
    reason: str
    # False whenever the check itself couldn't run (no LLM configured,
    # network error, unparseable response) — callers must treat an unchecked
    # verdict as "pass" (never block a response because the verifier itself
    # broke), not as a failure.
    checked: bool


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)

_PASS_UNCHECKED = AnswerVerdict(addresses_question=True, reason="", checked=False)


async def verify_answer(question: str, answer: str, evidence_summary: str) -> AnswerVerdict:
    """Best-effort: any failure degrades to `_PASS_UNCHECKED` rather than
    blocking every response whenever the verifier itself has a problem."""
    import backend.main as backend_main  # lazy: avoid a circular import at module load time

    if not answer.strip():
        return _PASS_UNCHECKED

    if backend_main.GROQ_API_KEY:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.GROQ_API_KEY}"}
        model = backend_main.GROQ_MODEL
    elif backend_main.OPENAI_API_KEY:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.OPENAI_API_KEY}"}
        model = backend_main.OPENAI_MODEL
    else:
        return _PASS_UNCHECKED

    prompt = (
        "You are a strict answer-relevance checker for a customer support AI. "
        "Given a user's question, the evidence the assistant was given, and the "
        "assistant's answer, decide whether the answer actually addresses the "
        "SPECIFIC question asked.\n\n"
        "Answer false if the response is about a different product, a different "
        "fact, or a different question than the one asked — even if it is "
        "factually accurate about that other thing. Answer false if it states a "
        "specific fact (price, ingredient, policy detail) that is not present in "
        "the evidence. Answer true if the answer directly addresses the question, "
        "including a well-formed clarifying question or an honest \"I don't have "
        "verified information on that\" when the evidence genuinely doesn't cover it.\n\n"
        f"Question: {question[:800]}\n\n"
        f"Evidence given to the assistant:\n{(evidence_summary or '(none)')[:1500]}\n\n"
        f"Assistant's answer:\n{answer[:1500]}\n\n"
        'Reply with ONLY a compact JSON object, no other text: '
        '{"addresses_question": true or false, "reason": "<one short sentence>"}'
    )

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 120,
                },
            )
            if resp.status_code >= 400:
                return _PASS_UNCHECKED
            content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception:
        return _PASS_UNCHECKED

    match = _JSON_RE.search(content)
    if not match:
        return _PASS_UNCHECKED
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return _PASS_UNCHECKED

    return AnswerVerdict(
        addresses_question=bool(parsed.get("addresses_question", True)),
        reason=str(parsed.get("reason", ""))[:300],
        checked=True,
    )
