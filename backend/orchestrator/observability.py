"""
Unified observability entry point — Phase 5.

Wraps the two existing best-effort audit paths (`backend.main._log_analytics`
writing to the `analytics` table, and `rag.retriever.Retriever._log_query`
writing to `rag_queries`) behind a single call site that also carries the
fields the orchestrator now computes (intent, entities, selected tools,
per-tool latency) — see backend/main.py's `ORCHESTRATOR_ENABLED`-gated
observability hook.

Deliberately does NOT merge the two tables' schemas: they serve different
consumers (chat-level analytics dashboards vs RAG-quality audit) and
reshaping either without verifying against the live production schema is a
bigger, riskier migration than this phase covers. "One place" here means one
Python call site instead of scattered ad hoc logging calls, not one
database table — a later phase can route this into a dedicated table once
verified against a real environment.

Best-effort like both paths it wraps: any failure here is logged and
swallowed, never raised — this must never break /chat. Internal-only: never
include this event's fields in an HTTP response body (see backend/main.py's
`_run_orchestrator_observability`, which already treats this the same way).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

_logger = logging.getLogger("dayjoy.observability")


@dataclass
class TraceEvent:
    request_id: Optional[str] = None
    user_id: Optional[str] = None
    intent: Optional[str] = None
    entities: Dict[str, Any] = field(default_factory=dict)
    selected_tools: List[str] = field(default_factory=list)
    retrieval_sources: List[str] = field(default_factory=list)
    latency_ms: Dict[str, float] = field(default_factory=dict)
    model: Optional[str] = None
    tool_errors: List[str] = field(default_factory=list)
    confidence: Optional[float] = None
    final_status: Optional[str] = None


def emit_trace(event: TraceEvent) -> None:
    """Synchronous, best-effort structured log line — never raises."""
    try:
        _logger.info(
            "orchestrator_trace request_id=%s user_id=%s intent=%s entities=%s "
            "selected_tools=%s retrieval_sources=%s latency_ms=%s model=%s "
            "tool_errors=%s confidence=%s final_status=%s",
            event.request_id,
            event.user_id,
            event.intent,
            event.entities,
            event.selected_tools,
            event.retrieval_sources,
            event.latency_ms,
            event.model,
            event.tool_errors,
            event.confidence,
            event.final_status,
        )
    except Exception:
        _logger.exception("observability emit_trace failed")
