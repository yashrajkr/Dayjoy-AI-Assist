"""Contradiction Detector (Capability 26).

A small, isolated LLM call in the SAME style answer_verify.py's
verify_answer() already uses (one-shot non-streaming JSON classifier,
never routed through the full customer-persona chat prompt) — checks
whether the GENERATED answer contains an internal contradiction (states
two incompatible things about the same fact) or contradicts the evidence
it was actually given. Distinct from verify_answer(), which checks
relevance-to-the-question, not internal/evidence consistency.

Best-effort by design, matching answer_verify.py's own convention: any
failure (no LLM configured, network error, unparseable response) degrades
to "no contradiction found" rather than blocking every response whenever
this check itself has a problem — a false negative here is much safer
than accidentally flagging (or blocking) a perfectly good answer because
the checker broke.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import httpx

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


@dataclass
class ContradictionVerdict:
    has_contradiction: bool
    explanation: str
    # False whenever the check itself couldn't run — see module docstring.
    checked: bool


_PASS_UNCHECKED = ContradictionVerdict(has_contradiction=False, explanation="", checked=False)


async def detect_contradiction(answer: str, context: str) -> ContradictionVerdict:
    """Best-effort: any failure degrades to _PASS_UNCHECKED."""
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
        "You are a strict contradiction checker for a customer support AI. Given the evidence an "
        "assistant was given and the answer it produced, decide whether the answer contains a "
        "CONTRADICTION — either:\n"
        "(a) an internal contradiction — it states two incompatible things about the same fact "
        "within its own text (e.g. says a price is both 799 and 899, or says a product both is "
        "and is not suitable for pregnancy), or\n"
        "(b) it contradicts the evidence it was given — states something the evidence directly "
        "says the opposite of.\n\n"
        "Do NOT flag: the answer adding reasonable general context beyond the evidence, hedging "
        "language, or comparing/contrasting different products/options (that is not a "
        "contradiction, that's the answer's actual content).\n\n"
        f"Evidence given to the assistant:\n{(context or '(none)')[:2000]}\n\n"
        f"Assistant's answer:\n{answer[:2000]}\n\n"
        'Reply with ONLY a compact JSON object, no other text: '
        '{"has_contradiction": true or false, "explanation": "<one short sentence, empty if false>"}'
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
                    "max_tokens": 150,
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

    return ContradictionVerdict(
        has_contradiction=bool(parsed.get("has_contradiction", False)),
        explanation=str(parsed.get("explanation", ""))[:300],
        checked=True,
    )
