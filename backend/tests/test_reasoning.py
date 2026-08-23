"""Tests for backend/orchestrator/reasoning.py (Advanced Intelligence Layer
capability 2: Multi-Step Reasoning Pipeline)."""

from __future__ import annotations

import json

import pytest

from backend import main as backend_main
from backend.orchestrator import reasoning


class _FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        return self._response


def _groq_response(content: str):
    return _FakeResponse(200, {"choices": [{"message": {"content": content}}]})


@pytest.mark.asyncio
async def test_decompose_returns_original_message_when_no_llm_configured(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    result = await reasoning.decompose_business_question("Help me grow my sales.")
    assert result == ["Help me grow my sales."]


@pytest.mark.asyncio
async def test_decompose_parses_valid_json_array(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    payload = json.dumps(["How to generate leads?", "How to follow up effectively?"])
    monkeypatch.setattr(reasoning.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(_groq_response(payload)))
    result = await reasoning.decompose_business_question("How can I grow my sales?")
    assert result == ["How to generate leads?", "How to follow up effectively?"]


@pytest.mark.asyncio
async def test_decompose_falls_back_on_malformed_json(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        reasoning.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(_groq_response("not valid json"))
    )
    result = await reasoning.decompose_business_question("Grow my sales.")
    assert result == ["Grow my sales."]


@pytest.mark.asyncio
async def test_decompose_falls_back_on_http_error(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        reasoning.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(_FakeResponse(500, {}))
    )
    result = await reasoning.decompose_business_question("Grow my sales.")
    assert result == ["Grow my sales."]


@pytest.mark.asyncio
async def test_decompose_rejects_out_of_range_count(monkeypatch):
    """Only 2-4 sub-questions are accepted — a single-item or 10-item array
    signals the model didn't follow instructions well, so fall back rather
    than trust a malformed decomposition."""
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    payload = json.dumps(["only one"])
    monkeypatch.setattr(reasoning.httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(_groq_response(payload)))
    result = await reasoning.decompose_business_question("Grow my sales.")
    assert result == ["Grow my sales."]


@pytest.mark.asyncio
async def test_pipeline_merges_context_and_sources_across_subquestions(monkeypatch):
    async def _fake_decompose(message):
        return ["How to generate leads?", "How to follow up effectively?"]

    monkeypatch.setattr(reasoning, "decompose_business_question", _fake_decompose)

    call_log = []

    async def _fake_retrieve_context(token, message, limit_per_table=3, top_k=None):
        call_log.append(message)
        if "leads" in message:
            return (
                "Lead generation content.",
                [backend_main.ChatSource(table="faqs", id="F-1", title="Leads FAQ")],
                "general",
                {"evidence_sufficient": True},
            )
        return (
            "Follow-up content.",
            [backend_main.ChatSource(table="faqs", id="F-2", title="Follow-up FAQ")],
            "general",
            {"evidence_sufficient": False},
        )

    monkeypatch.setattr(backend_main, "retrieve_context", _fake_retrieve_context)

    route = await reasoning.run_reasoning_pipeline("fake-token", "How can I grow my sales?", top_k=8)

    assert len(call_log) == 2
    assert "Lead generation content." in route.context
    assert "Follow-up content." in route.context
    assert len(route.sources) == 2
    assert route.rag_metadata["evidence_sufficient"] is True  # ANY sub-question sufficient
    assert route.rag_metadata["subquestions"] == ["How to generate leads?", "How to follow up effectively?"]
    assert route.answer_source == "dayjoy_knowledge"
    assert route.category == "business_strategy"


@pytest.mark.asyncio
async def test_pipeline_dedupes_sources_shared_across_subquestions(monkeypatch):
    async def _fake_decompose(message):
        return ["Sub A", "Sub B"]

    monkeypatch.setattr(reasoning, "decompose_business_question", _fake_decompose)

    async def _fake_retrieve_context(token, message, limit_per_table=3, top_k=None):
        return (
            "Same content.",
            [backend_main.ChatSource(table="faqs", id="F-1", title="Shared FAQ")],
            "general",
            {"evidence_sufficient": True},
        )

    monkeypatch.setattr(backend_main, "retrieve_context", _fake_retrieve_context)

    route = await reasoning.run_reasoning_pipeline("fake-token", "Grow my sales.", top_k=8)
    assert len(route.sources) == 1


@pytest.mark.asyncio
async def test_pipeline_falls_back_gracefully_when_no_evidence_found(monkeypatch):
    async def _fake_decompose(message):
        return ["Sub A", "Sub B"]

    monkeypatch.setattr(reasoning, "decompose_business_question", _fake_decompose)

    async def _fake_retrieve_context(token, message, limit_per_table=3, top_k=None):
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _fake_retrieve_context)

    route = await reasoning.run_reasoning_pipeline("fake-token", "Grow my sales.", top_k=8)
    assert route.context == ""
    assert route.answer_source == "general_llm"
    assert route.rag_metadata["evidence_sufficient"] is False


@pytest.mark.asyncio
async def test_pipeline_uses_original_message_when_decomposition_yields_one_part(monkeypatch):
    async def _fake_decompose(message):
        return [message]  # decomposition declined (e.g. LLM unavailable)

    monkeypatch.setattr(reasoning, "decompose_business_question", _fake_decompose)

    call_log = []

    async def _fake_retrieve_context(token, message, limit_per_table=3, top_k=None):
        call_log.append(message)
        return "Some content.", [], "general", {"evidence_sufficient": True}

    monkeypatch.setattr(backend_main, "retrieve_context", _fake_retrieve_context)

    await reasoning.run_reasoning_pipeline("fake-token", "Grow my sales.", top_k=8)
    assert call_log == ["Grow my sales."]  # single retrieval call, not split further
