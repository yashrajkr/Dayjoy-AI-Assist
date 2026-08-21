"""
Tests for backend/orchestrator/answer_verify.py — the post-generation
answer-relevance check. Uses the same FakeAsyncClient stand-in pattern as
test_search_providers.py rather than a new mocking approach.
"""

from __future__ import annotations

import pytest

from backend import main as backend_main
from backend.orchestrator import answer_verify as av


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
    # Default: no LLM configured — most tests below explicitly set a key.
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")


@pytest.mark.asyncio
async def test_no_llm_configured_skips_check():
    verdict = await av.verify_answer("What is the price?", "Some answer.", "some evidence")
    assert verdict.checked is False
    assert verdict.addresses_question is True  # never blocks a response on its own account


@pytest.mark.asyncio
async def test_empty_answer_skips_check(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    verdict = await av.verify_answer("What is the price?", "", "some evidence")
    assert verdict.checked is False


@pytest.mark.asyncio
async def test_llm_says_answer_addresses_question(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        av.httpx,
        "AsyncClient",
        _client_with(
            FakeResponse(
                200,
                {"choices": [{"message": {"content": '{"addresses_question": true, "reason": "on topic"}'}}]},
            )
        ),
    )
    verdict = await av.verify_answer("What is the MRP of Dayjoy Turmeric?", "The MRP is 499.", "MRP: 499")
    assert verdict.checked is True
    assert verdict.addresses_question is True
    assert verdict.reason == "on topic"


@pytest.mark.asyncio
async def test_llm_flags_mismatched_answer(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        av.httpx,
        "AsyncClient",
        _client_with(
            FakeResponse(
                200,
                {
                    "choices": [
                        {
                            "message": {
                                "content": (
                                    '{"addresses_question": false, '
                                    '"reason": "answer is about a different product"}'
                                )
                            }
                        }
                    ]
                },
            )
        ),
    )
    verdict = await av.verify_answer(
        "Who won the last cricket world cup?",
        "Dayjoy is a wellness and direct-selling brand incorporated in 2018.",
        "[1] Source: ... Q: What is Dayjoy? A: Dayjoy is the wellness brand...",
    )
    assert verdict.checked is True
    assert verdict.addresses_question is False


@pytest.mark.asyncio
async def test_http_error_degrades_to_unchecked_pass(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(av.httpx, "AsyncClient", _client_with(FakeResponse(500, {})))
    verdict = await av.verify_answer("q", "a", "e")
    assert verdict.checked is False
    assert verdict.addresses_question is True


@pytest.mark.asyncio
async def test_network_error_degrades_to_unchecked_pass(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(av.httpx, "AsyncClient", _client_with(ConnectionError("boom")))
    verdict = await av.verify_answer("q", "a", "e")
    assert verdict.checked is False
    assert verdict.addresses_question is True


@pytest.mark.asyncio
async def test_unparseable_response_degrades_to_unchecked_pass(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        av.httpx,
        "AsyncClient",
        _client_with(FakeResponse(200, {"choices": [{"message": {"content": "not json at all"}}]})),
    )
    verdict = await av.verify_answer("q", "a", "e")
    assert verdict.checked is False
    assert verdict.addresses_question is True


@pytest.mark.asyncio
async def test_falls_back_to_openai_when_groq_not_configured(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "fake-openai-key")
    captured_urls = []

    class _Capturing(FakeAsyncClient):
        async def post(self, url, headers=None, json=None):
            captured_urls.append(url)
            return FakeResponse(200, {"choices": [{"message": {"content": '{"addresses_question": true, "reason": "ok"}'}}]})

    monkeypatch.setattr(av.httpx, "AsyncClient", _Capturing)
    verdict = await av.verify_answer("q", "a", "e")
    assert verdict.checked is True
    assert captured_urls == ["https://api.openai.com/v1/chat/completions"]
