"""Tests for backend/orchestrator/contradiction.py — Contradiction
Detector (Capability 26). Uses the same FakeAsyncClient stand-in pattern
as test_answer_verify.py.
"""

from __future__ import annotations

import pytest

from backend import main as backend_main
from backend.orchestrator import contradiction as cd


class FakeResponse:
    def __init__(self, status_code: int, json_data: dict):
        self.status_code = status_code
        self._json_data = json_data

    def json(self):
        return self._json_data


class FakeAsyncClient:
    post_response: FakeResponse | Exception | None = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        if isinstance(self.post_response, Exception):
            raise self.post_response
        return self.post_response


def _client_with(post):
    FakeAsyncClient.post_response = post
    return FakeAsyncClient


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")


@pytest.mark.asyncio
async def test_no_llm_configured_skips_check():
    verdict = await cd.detect_contradiction("Some answer.", "some evidence")
    assert verdict.checked is False
    assert verdict.has_contradiction is False  # never blocks a response on its own account


@pytest.mark.asyncio
async def test_empty_answer_skips_check(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    verdict = await cd.detect_contradiction("", "some evidence")
    assert verdict.checked is False


@pytest.mark.asyncio
async def test_llm_detects_no_contradiction(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        cd.httpx, "AsyncClient",
        _client_with(FakeResponse(200, {"choices": [{"message": {"content": '{"has_contradiction": false, "explanation": ""}'}}]})),
    )
    verdict = await cd.detect_contradiction("Dayjoy Turmeric costs 799 rupees.", "Dayjoy Turmeric DP is 799.")
    assert verdict.checked is True
    assert verdict.has_contradiction is False


@pytest.mark.asyncio
async def test_llm_detects_a_contradiction(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        cd.httpx, "AsyncClient",
        _client_with(FakeResponse(
            200,
            {"choices": [{"message": {"content": '{"has_contradiction": true, "explanation": "States price is both 799 and 899."}'}}]},
        )),
    )
    verdict = await cd.detect_contradiction(
        "Dayjoy Turmeric costs 799 rupees. Later it says the price is 899.",
        "Dayjoy Turmeric DP is 799.",
    )
    assert verdict.checked is True
    assert verdict.has_contradiction is True
    assert "799" in verdict.explanation or "899" in verdict.explanation


@pytest.mark.asyncio
async def test_provider_error_degrades_to_unchecked(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(cd.httpx, "AsyncClient", _client_with(FakeResponse(500, {})))
    verdict = await cd.detect_contradiction("Some answer.", "some evidence")
    assert verdict.checked is False
    assert verdict.has_contradiction is False


@pytest.mark.asyncio
async def test_network_error_degrades_to_unchecked(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(cd.httpx, "AsyncClient", _client_with(ConnectionError("boom")))
    verdict = await cd.detect_contradiction("Some answer.", "some evidence")
    assert verdict.checked is False


@pytest.mark.asyncio
async def test_unparseable_response_degrades_to_unchecked(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        cd.httpx, "AsyncClient",
        _client_with(FakeResponse(200, {"choices": [{"message": {"content": "not json at all"}}]})),
    )
    verdict = await cd.detect_contradiction("Some answer.", "some evidence")
    assert verdict.checked is False


@pytest.mark.asyncio
async def test_falls_back_to_openai_when_no_groq(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "fake-openai-key")
    captured = {}

    class CapturingClient(FakeAsyncClient):
        async def post(self, url, headers=None, json=None):
            captured["url"] = url
            return FakeResponse(200, {"choices": [{"message": {"content": '{"has_contradiction": false}'}}]})

    monkeypatch.setattr(cd.httpx, "AsyncClient", CapturingClient)
    verdict = await cd.detect_contradiction("Some answer.", "some evidence")
    assert verdict.checked is True
    assert "openai.com" in captured["url"]
