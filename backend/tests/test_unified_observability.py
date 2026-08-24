"""
Endpoint-level test for the Phase 7 consolidated observability trace
(backend/main.py's `_log_unified_trace`, orchestrator/observability.py's
`emit_trace`) — proves it actually fires on every request (not gated behind
ORCHESTRATOR_ENABLED, unlike the pre-generation-only hook), not just that
the helper function exists.
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    monkeypatch.setattr(backend_main, "ORCHESTRATOR_ENABLED", False)  # the OLD hook stays off
    backend_main._rate_limit_store.clear()
    yield
    backend_main._rate_limit_store.clear()


@pytest.fixture
def client():
    return TestClient(backend_main.app)


@pytest.fixture
def authed_client(client, monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    yield client


def test_unified_trace_fires_even_when_orchestrator_observability_is_disabled(authed_client, monkeypatch, caplog):
    async def _stub(token, message, limit_per_table=3, top_k=None, knowledge_scope=None):
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub)

    with caplog.at_level(logging.INFO, logger="dayjoy.observability"):
        res = authed_client.post(
            "/chat", json={"message": "What is Dayjoy's refund policy?", "role": "customer", "language": "English"}
        )
    assert res.status_code == 200
    trace_lines = [r for r in caplog.records if r.name == "dayjoy.observability"]
    assert len(trace_lines) == 1
    msg = trace_lines[0].getMessage()
    assert "request_id=" in msg
    assert "user_id=test-user-id" in msg
    assert "What is Dayjoy's refund policy?" in msg
    assert "latency_ms=" in msg


def test_unified_trace_marks_blocked_requests(authed_client, monkeypatch, caplog):
    async def _fake_safety_rules():
        return [{"pattern": "forbidden_test_phrase", "rule_key": "test_rule"}]

    monkeypatch.setattr(backend_main, "load_safety_rules", _fake_safety_rules)

    with caplog.at_level(logging.INFO, logger="dayjoy.observability"):
        res = authed_client.post(
            "/chat",
            json={"message": "this contains forbidden_test_phrase", "role": "customer", "language": "English"},
        )
    assert res.status_code == 200
    assert res.json()["safety_status"] == "blocked"
    trace_lines = [r for r in caplog.records if r.name == "dayjoy.observability"]
    assert len(trace_lines) == 1
    assert "final_status=blocked" in trace_lines[0].getMessage()
