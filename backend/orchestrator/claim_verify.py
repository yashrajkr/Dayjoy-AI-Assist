"""Citation Verification / Claim-Level Grounding (Capabilities 7, 8).

Splits an answer into its individual factual claims and classifies EACH
ONE against the evidence it was given — the per-claim counterpart to
answer_validate.py's classify_grounding_state(), which classifies the
WHOLE answer at once. One bounded LLM call (not one call per claim, which
would scale request count with answer length and get expensive fast) in
the same one-shot JSON-classifier style answer_verify.py/contradiction.py
already use.

Deliberately conservative about what counts as a "claim": short answers,
casual replies, and answers with no real factual content don't need this
— see should_verify_claims(). Best-effort, matching every other verifier
in this codebase: any failure degrades to an empty claim list (nothing
flagged) rather than blocking a response when the checker itself breaks.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import List

import httpx

_JSON_ARRAY_RE = re.compile(r"\[.*\]", re.DOTALL)

# Mirrors answer_validate.py's five-state vocabulary exactly, at the
# per-claim level instead of per-answer — "Do not mix them" applies here too.
CLAIM_VERIFIED = "verified"
CLAIM_AI_ANALYSIS = "ai_analysis"
CLAIM_ASSUMPTION = "assumption"
CLAIM_UNVERIFIED = "unverified"

_VALID_STATES = {CLAIM_VERIFIED, CLAIM_AI_ANALYSIS, CLAIM_ASSUMPTION, CLAIM_UNVERIFIED}


@dataclass
class ClaimVerdict:
    claim: str
    state: str


@dataclass
class ClaimVerificationResult:
    claims: List[ClaimVerdict] = field(default_factory=list)
    checked: bool = False

    def to_dict(self) -> dict:
        return {
            "checked": self.checked,
            "claims": [{"claim": c.claim, "state": c.state} for c in self.claims],
        }

    @property
    def has_unverified_claim(self) -> bool:
        return any(c.state == CLAIM_UNVERIFIED for c in self.claims)


_EMPTY_UNCHECKED = ClaimVerificationResult(claims=[], checked=False)

MIN_ANSWER_LENGTH_FOR_CLAIM_CHECK = 120


def should_verify_claims(answer: str, answer_source: str) -> bool:
    """Only worth running for substantive, evidence-based answers — a
    one-line reply or a casual/general-knowledge answer has nothing
    claim-verification adds (there's either nothing to check, or nothing
    it was supposed to be grounded in)."""
    if answer_source not in ("dayjoy_knowledge", "hybrid"):
        return False
    return len(answer.strip()) >= MIN_ANSWER_LENGTH_FOR_CLAIM_CHECK


async def verify_claims(answer: str, context: str) -> ClaimVerificationResult:
    """Best-effort: any failure degrades to _EMPTY_UNCHECKED."""
    import backend.main as backend_main  # lazy: avoid a circular import at module load time

    if not answer.strip():
        return _EMPTY_UNCHECKED

    if backend_main.GROQ_API_KEY:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.GROQ_API_KEY}"}
        model = backend_main.GROQ_MODEL
    elif backend_main.OPENAI_API_KEY:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.OPENAI_API_KEY}"}
        model = backend_main.OPENAI_MODEL
    else:
        return _EMPTY_UNCHECKED

    prompt = (
        "You are a strict citation/grounding checker. Break the assistant's answer below into its "
        "individual FACTUAL claims (specific, checkable statements — prices, ingredients, policy "
        "details, product benefits, business facts). Skip greetings, filler, and pure opinion/style "
        "text. For each claim, classify it against the evidence into exactly one state:\n"
        f'- "{CLAIM_VERIFIED}": the evidence directly states this.\n'
        f'- "{CLAIM_ASSUMPTION}": the claim is phrased as an assumption/hedge (e.g. "if you\'re...", '
        '"this is likely...") rather than a flat assertion.\n'
        f'- "{CLAIM_AI_ANALYSIS}": reasonable inference/synthesis from the evidence, not a direct quote of it.\n'
        f'- "{CLAIM_UNVERIFIED}": a specific factual claim NOT supported by the evidence at all.\n\n'
        f"Evidence given to the assistant:\n{(context or '(none)')[:2500]}\n\n"
        f"Assistant's answer:\n{answer[:2500]}\n\n"
        'Reply with ONLY a compact JSON array, no other text: '
        f'[{{"claim": "<short paraphrase>", "state": "{CLAIM_VERIFIED}"}}, ...]. '
        "Include at most 8 claims — the most important ones if there are more."
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 500,
                },
            )
            if resp.status_code >= 400:
                return _EMPTY_UNCHECKED
            content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception:
        return _EMPTY_UNCHECKED

    match = _JSON_ARRAY_RE.search(content)
    if not match:
        return _EMPTY_UNCHECKED
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return _EMPTY_UNCHECKED
    if not isinstance(parsed, list):
        return _EMPTY_UNCHECKED

    claims: List[ClaimVerdict] = []
    for item in parsed[:8]:
        if not isinstance(item, dict):
            continue
        claim_text = str(item.get("claim", "")).strip()[:300]
        state = str(item.get("state", "")).strip()
        if claim_text and state in _VALID_STATES:
            claims.append(ClaimVerdict(claim=claim_text, state=state))

    return ClaimVerificationResult(claims=claims, checked=True)
