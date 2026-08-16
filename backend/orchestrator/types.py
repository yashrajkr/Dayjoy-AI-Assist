"""Shared dataclasses for the orchestrator layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Intent labels. Deliberately mirrors the branches `_route_events` (backend/
# main.py) already computes via regex — Phase 1 formalizes them into a named
# result rather than introducing new categories the legacy router doesn't
# also produce. Later phases add finer-grained Dayjoy sub-intents (pricing,
# compensation, etc.) without changing these four.
INTENT_CASUAL = "casual"
INTENT_TIME_QUERY = "time_query"
INTENT_COMPARISON = "comparison"
INTENT_GENERAL = "general"


@dataclass
class IntentResult:
    """Result of `orchestrator.intent.detect_intent()`.

    `intent` is one of the INTENT_* constants above. The three booleans are
    kept alongside it (rather than only the label) because `_route_events`'s
    actual branching depends on combinations of them (e.g. comparison cue +
    whether Dayjoy context was found) that a single label would lose.
    """

    intent: str
    is_casual: bool = False
    wants_comparison: bool = False
    is_time_query: bool = False
    used_llm_fallback: bool = False
    raw_message: str = ""


@dataclass
class ToolResult:
    tool_name: str
    ok: bool
    data: Any = None
    error: Optional[str] = None
    latency_ms: Optional[float] = None
    timed_out: bool = False


@dataclass
class OrchestratorTrace:
    """Observability record for one orchestrator pass. Phase 1 logs this;
    later phases feed it into the unified `observability.emit_trace()`
    (extends backend/main.py's `_log_analytics` + rag/retriever.py's
    `_log_query`, per the approved plan — not a new logging subsystem)."""

    request_id: Optional[str] = None
    user_id: Optional[str] = None
    intent: Optional[str] = None
    proposed_tools: List[str] = field(default_factory=list)
    tool_results: List[ToolResult] = field(default_factory=list)
    embedding_degraded: bool = False
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "request_id": self.request_id,
            "user_id": self.user_id,
            "intent": self.intent,
            "proposed_tools": self.proposed_tools,
            "tool_results": [
                {
                    "tool_name": r.tool_name,
                    "ok": r.ok,
                    "error": r.error,
                    "latency_ms": r.latency_ms,
                    "timed_out": r.timed_out,
                }
                for r in self.tool_results
            ],
            "embedding_degraded": self.embedding_degraded,
            "notes": self.notes,
        }
