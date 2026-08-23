"""Multi-Step Reasoning Pipeline — Advanced Intelligence Layer capability 2.

Triggered only when quality_router.route_query() classifies a message as
STRATEGY_COMPLEX_REASONING (a broad business/strategy question — see that
module's `_COMPLEX_BUSINESS_RE`). Builds its own merged evidence set by
retrieving per sub-question and combining the results ITSELF, rather than
depending on the single-retrieval-call merge assumptions every other branch
of `_route_events` (backend/main.py) is built around — that's what makes
this safe to wire in as one isolated, early-returning branch rather than a
risky rewrite of the shared retrieval path (see orchestrator/decompose.py's
docstring for why that risk was avoided there too).

Pipeline: Understand -> decompose into subproblems -> retrieve per
subproblem (parallel) -> merge into one evidenced context. Synthesis and
validation happen downstream in the EXISTING pipeline (stream_response,
answer_verify, quality/answer_validate) — this module's job ends at
producing a well-evidenced RouteResult. Never exposes chain-of-thought: the
sub-questions are logged for observability (rag_metadata["subquestions"]),
never sent to the user as prose.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import List

import httpx

_JSON_ARRAY_RE = re.compile(r"\[.*\]", re.DOTALL)


async def decompose_business_question(message: str) -> List[str]:
    """LLM-backed decomposition of a broad business/strategy question into
    2-4 concrete, individually-retrievable sub-questions. Best-effort: any
    failure (no LLM configured, network error, unparseable response)
    degrades to `[message]` — the pipeline still runs, just without the
    decomposition benefit, never blocks the response. Mirrors
    answer_verify.py's exact call pattern (lazy import of backend.main,
    Groq-then-OpenAI, small/cheap/non-streaming)."""
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
        return [message]

    prompt = (
        "Break the following business question into 2-4 concrete, specific sub-questions "
        "that together would need to be researched to give a complete, well-evidenced answer. "
        "Each sub-question should be answerable independently. "
        'Reply with ONLY a compact JSON array of strings, no other text: ["...", "..."]\n\n'
        f"Question: {message[:500]}"
    )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 300,
                },
            )
            if resp.status_code >= 400:
                return [message]
            content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception:
        return [message]

    match = _JSON_ARRAY_RE.search(content)
    if not match:
        return [message]
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return [message]

    subquestions = [str(s).strip() for s in parsed if isinstance(s, str) and str(s).strip()]
    if not (2 <= len(subquestions) <= 4):
        return [message]
    return subquestions


async def run_reasoning_pipeline(token, message: str, top_k: int = 8):
    """Returns a RouteResult (backend.main's dataclass — imported lazily to
    avoid the circular dependency) built from evidence gathered across every
    sub-question, retrieved in parallel."""
    import backend.main as backend_main  # lazy: avoid a circular import at module load time

    subquestions = await decompose_business_question(message)
    if len(subquestions) < 2:
        subquestions = [message]

    per_question_top_k = max(2, top_k // len(subquestions))
    results = await asyncio.gather(
        *[
            backend_main.retrieve_context(token, sub, top_k=per_question_top_k)
            for sub in subquestions
        ]
    )

    context_parts: List[str] = []
    all_sources = []
    any_sufficient = False
    for sub, (context, sources, _category, rag_metadata) in zip(subquestions, results):
        if context:
            context_parts.append(f"[Research: {sub}]\n{context}")
        all_sources.extend(sources)
        if rag_metadata and rag_metadata.get("evidence_sufficient"):
            any_sufficient = True

    # Dedup sources by (table, id) — the same source can legitimately answer
    # more than one sub-question.
    seen = set()
    deduped_sources = []
    for s in all_sources:
        key = (s.table, s.id)
        if key not in seen:
            seen.add(key)
            deduped_sources.append(s)

    merged_context = "\n\n".join(context_parts)
    answer_source = "dayjoy_knowledge" if merged_context else "general_llm"

    return backend_main.RouteResult(
        context=merged_context,
        web_context="",
        sources=deduped_sources,
        web_sources=[],
        category="business_strategy",
        rag_metadata={
            "confidence": 0.75 if any_sufficient else 0.4,
            "verification_status": "verified" if any_sufficient else "partial",
            "evidence_sufficient": any_sufficient,
            "source": "multi_step_reasoning",
            "subquestions": subquestions,
        },
        mode="dayjoy",
        answer_source=answer_source,
        web_search_provider=None,
        used_web_search=False,
    )
