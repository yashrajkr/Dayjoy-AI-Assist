"""Model Router (Next-Generation spec, Phase 9).

A central, provider-agnostic answer to "which model/provider should handle
task X right now" — with the same LIVE capability detection main.py's vision
path already established (backend.main._check_vision_available: a cheap
probe, cached with a TTL, that reflects real provider state rather than just
"is an env var set"), generalized here into a reusable API instead of a
decision hardcoded inline to one modality.

Deliberately does NOT replace `backend.main.stream_response`'s existing
Groq-then-OpenAI text-generation fallback chain — that mechanism retries
per-provider, streams tokens, and is exercised by ~150 existing tests; a
second, competing model-selection path for the exact same decision would be
duplication, not improvement (see backend.main.stream_response's own retry
loop). What this module adds is real and new: ONE place other call sites —
GET /capabilities, admin observability, future modality routing — can ask
"which model handles this" and get a live, capability-checked answer,
instead of each new caller re-deriving "if GROQ_API_KEY: ... elif
OPENAI_API_KEY: ..." inline the way five call sites in this codebase
currently do.

Lazy-imports backend.main inside each function (this package's established
pattern for reaching runtime config/state — see contradiction.py,
claim_verify.py) rather than a module-level import, since backend.main
imports orchestrator modules at startup and a module-level import here
would be circular.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

TASK_CHAT = "chat"
TASK_REASONING = "reasoning"
TASK_VISION = "vision"

_KNOWN_TASKS = (TASK_CHAT, TASK_REASONING, TASK_VISION)


@dataclass
class ModelSelection:
    task: str
    provider: Optional[str]  # "groq" | "openai" | None
    model: Optional[str]
    available: bool
    reason: Optional[str]  # populated only when available is False

    def to_dict(self) -> dict:
        return {
            "task": self.task,
            "provider": self.provider,
            "model": self.model,
            "available": self.available,
            "reason": self.reason,
        }


async def select_model(task: str) -> ModelSelection:
    """Live model/provider selection for `task`. Never raises for a known
    task — any provider unavailability comes back as available=False with a
    reason, the same "no fake completion, no silent failure" contract
    `_check_vision_available` already established."""
    if task not in _KNOWN_TASKS:
        raise ValueError(f"unknown task type: {task!r} — expected one of {_KNOWN_TASKS}")

    from backend import main as backend_main

    if task == TASK_VISION:
        status = await backend_main._check_vision_available()
        return ModelSelection(
            task=task,
            provider="openai" if status["available"] else None,
            model=backend_main.VISION_MODEL if status["available"] else None,
            available=status["available"],
            reason=status["reason"],
        )

    # TASK_CHAT / TASK_REASONING — both currently route through the same
    # text-generation providers; kept as distinct task constants (rather
    # than collapsing to one) so a future reasoning-tier model can be
    # introduced here without changing every caller's task name.
    if backend_main.GROQ_API_KEY:
        return ModelSelection(task=task, provider="groq", model=backend_main.GROQ_MODEL, available=True, reason=None)
    if backend_main.OPENAI_API_KEY:
        return ModelSelection(task=task, provider="openai", model=backend_main.OPENAI_MODEL, available=True, reason=None)
    return ModelSelection(task=task, provider=None, model=None, available=False, reason="not_configured")
