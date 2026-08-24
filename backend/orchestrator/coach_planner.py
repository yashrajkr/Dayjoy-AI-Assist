"""Goal -> Plan generation (Next-Generation spec, Phases 5 & 13).

Turns a free-text goal ("I want to improve my customer follow-up") into an
ordered list of concrete tasks grouped by day. Mirrors answer_verify.py's
established pattern exactly: a small, isolated, one-shot LLM call (lazy
import of backend.main, Groq-then-OpenAI provider selection, strict
JSON-only response), degrading to a deterministic generic starter plan on
any failure — never blocking goal creation because the LLM step failed,
and never fabricating a Dayjoy-specific claim (the deterministic fallback
is generic business-habit advice, not invented Dayjoy policy).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import List

import httpx

_JSON_RE = re.compile(r"\[.*\]", re.DOTALL)

MAX_TASKS = 12


@dataclass
class PlanTask:
    day_label: str
    task_text: str


_DETERMINISTIC_FALLBACK: List[PlanTask] = [
    PlanTask("Day 1", "Write down exactly what success looks like for this goal in one sentence."),
    PlanTask("Day 1", "List 3 concrete actions you could take this week toward it."),
    PlanTask("Day 2-3", "Take the first action from your list and note what you learned."),
    PlanTask("Day 4-5", "Take the second action and adjust your approach based on Day 2-3."),
    PlanTask("Day 6-7", "Review progress — what worked, what didn't, and update the plan."),
]


async def generate_plan(goal_text: str) -> List[PlanTask]:
    """Best-effort: degrades to _DETERMINISTIC_FALLBACK on any failure —
    generic, not Dayjoy-specific, so it's never a fabrication risk."""
    import backend.main as backend_main  # lazy: avoid circular import at module load time

    if not goal_text.strip():
        return list(_DETERMINISTIC_FALLBACK)

    if backend_main.GROQ_API_KEY:
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.GROQ_API_KEY}"}
        model = backend_main.GROQ_MODEL
    elif backend_main.OPENAI_API_KEY:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {backend_main.OPENAI_API_KEY}"}
        model = backend_main.OPENAI_MODEL
    else:
        return list(_DETERMINISTIC_FALLBACK)

    prompt = (
        "You are a business coach for Dayjoy direct-selling distributors. Turn the "
        "user's goal into a concrete, realistic 7-day plan of small daily actions. "
        "Never promise a specific income or guaranteed result. Keep each task short "
        "(under 20 words) and actionable — something the person can actually do, not "
        "a vague aspiration.\n\n"
        f"Goal: {goal_text[:500]}\n\n"
        'Reply with ONLY a compact JSON array, no other text, of at most 10 items: '
        '[{"day_label": "Day 1", "task_text": "..."}, ...]'
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.4,
                    "max_tokens": 500,
                },
            )
            if resp.status_code >= 400:
                return list(_DETERMINISTIC_FALLBACK)
            content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception:
        return list(_DETERMINISTIC_FALLBACK)

    match = _JSON_RE.search(content)
    if not match:
        return list(_DETERMINISTIC_FALLBACK)
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return list(_DETERMINISTIC_FALLBACK)

    tasks: List[PlanTask] = []
    for item in parsed[:MAX_TASKS]:
        if not isinstance(item, dict):
            continue
        task_text = str(item.get("task_text", "")).strip()[:300]
        if not task_text:
            continue
        day_label = str(item.get("day_label", "Today")).strip()[:40] or "Today"
        tasks.append(PlanTask(day_label=day_label, task_text=task_text))

    return tasks or list(_DETERMINISTIC_FALLBACK)
