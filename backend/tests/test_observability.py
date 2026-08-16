"""Phase 5: unified observability emit_trace() must never raise (best-effort
like the two existing audit paths it wraps) and must never be required for
/chat to succeed."""

from __future__ import annotations

import logging

from backend.orchestrator.observability import TraceEvent, emit_trace


def test_emit_trace_logs_expected_fields(caplog):
    with caplog.at_level(logging.INFO, logger="dayjoy.observability"):
        emit_trace(
            TraceEvent(
                request_id="req-1",
                user_id="user-1",
                intent="comparison",
                entities={"product": "Dayjoy Spirulina"},
                selected_tools=["dayjoy_kb", "web_search"],
                confidence=0.8,
                final_status="ok",
            )
        )
    assert any("orchestrator_trace" in r.message for r in caplog.records)
    assert any("req-1" in r.message for r in caplog.records)


def test_emit_trace_never_raises_on_bad_input():
    # Passing a non-serializable-looking but still logger-%s-safe object
    # must not raise — this is a best-effort path, never a hard dependency.
    class Weird:
        def __repr__(self):
            raise RuntimeError("boom in repr")

    try:
        emit_trace(TraceEvent(entities={"bad": Weird()}))
    except Exception as exc:  # pragma: no cover - the whole point is this doesn't happen
        raise AssertionError(f"emit_trace must never raise, got {exc!r}")
