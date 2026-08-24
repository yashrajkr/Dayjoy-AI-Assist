"""Multimodal Understanding (Capabilities 1, 2, 19, 20) —
stream_vision_response() and the /chat, /chat/stream image_data_url path.

This account's Groq API key has zero vision-capable models available
(live-verified — see VISION_MODEL's definition in main.py), and the
configured OPENAI_API_KEY currently has no credit (live-verified: a real
call returns HTTP 429 insufficient_quota), so the vision path cannot be
live-verified end-to-end in this environment. These tests instead verify
the REQUEST CONSTRUCTION (the multimodal content-block shape sent to the
provider) and every graceful-degradation branch, with the outbound HTTP
call mocked — the same pattern test_chat_title.py already uses for the
non-streaming completion endpoint, adapted for a streaming response.

Also covers the runtime capability probe (_check_vision_available,
GET /capabilities) added to auto-detect when OpenAI billing is restored
— vision becomes usable again automatically (within the cache TTL), and
until then the app shows an honest, specific reason instead of a raw
provider error or a misleading "try again" message.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main

VALID_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


class FakeSimpleResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code


class FakeStreamHTTPResponse:
    def __init__(self, status_code: int, sse_lines: list[str] = None, body: bytes = b""):
        self.status_code = status_code
        self._sse_lines = sse_lines or []
        self._body = body

    async def aiter_lines(self):
        for line in self._sse_lines:
            yield line

    async def aread(self):
        return self._body


class FakeStreamContextManager:
    def __init__(self, response: FakeStreamHTTPResponse, capture: dict):
        self._response = response
        self._capture = capture

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *args):
        return False


class FakeStreamAsyncClient:
    """Drop-in for httpx.AsyncClient supporting both the plain .post() form
    (_check_vision_available's minimal max_tokens=1 capability probe) and
    the .stream() context-manager form (stream_vision_response's actual
    vision call) — both hit the same URL, distinguished by which client
    method is called, matching how the real code calls each."""

    # Default: capability probe reports "available" unless a test overrides it.
    _probe_response = FakeSimpleResponse(200)

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        return FakeStreamAsyncClient._probe_response

    def stream(self, method, url, headers=None, json=None):
        FakeStreamAsyncClient.last_request = {"method": method, "url": url, "headers": headers, "json": json}
        return FakeStreamContextManager(FakeStreamAsyncClient._response, FakeStreamAsyncClient.last_request)


def make_fake_stream_client(response: FakeStreamHTTPResponse, probe_status: int = 200):
    FakeStreamAsyncClient._response = response
    FakeStreamAsyncClient._probe_response = FakeSimpleResponse(probe_status)
    return FakeStreamAsyncClient


# ---------------------------------------------------------------------------
# validate_image_data_url
# ---------------------------------------------------------------------------


def test_rejects_non_image_data_url():
    assert backend_main.validate_image_data_url("data:application/pdf;base64,xxx") is not None


def test_rejects_oversized_data_url():
    huge = "data:image/png;base64," + ("A" * backend_main.MAX_IMAGE_DATA_URL_CHARS)
    assert backend_main.validate_image_data_url(huge) is not None


def test_accepts_valid_png_data_url():
    assert backend_main.validate_image_data_url(VALID_IMAGE) is None


# ---------------------------------------------------------------------------
# _check_vision_available / GET /capabilities — auto-detection
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    backend_main._rate_limit_store.clear()
    backend_main._capability_cache["vision"] = None
    backend_main._capability_cache["checked_at"] = 0.0
    yield
    backend_main._rate_limit_store.clear()
    backend_main._capability_cache["vision"] = None
    backend_main._capability_cache["checked_at"] = 0.0


@pytest.mark.asyncio
async def test_capability_check_not_configured_when_no_key(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    result = await backend_main._check_vision_available()
    assert result == {"available": False, "reason": "not_configured"}


@pytest.mark.asyncio
async def test_capability_check_available_on_200(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", make_fake_stream_client(FakeStreamHTTPResponse(200), probe_status=200))
    result = await backend_main._check_vision_available()
    assert result == {"available": True, "reason": None}


@pytest.mark.asyncio
async def test_capability_check_quota_exceeded_on_429(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", make_fake_stream_client(FakeStreamHTTPResponse(200), probe_status=429))
    result = await backend_main._check_vision_available()
    assert result == {"available": False, "reason": "quota_exceeded"}


@pytest.mark.asyncio
async def test_capability_check_is_cached_within_ttl(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", make_fake_stream_client(FakeStreamHTTPResponse(200), probe_status=200))
    first = await backend_main._check_vision_available()
    # Flip the underlying provider status — cached result should still win.
    FakeStreamAsyncClient._probe_response = FakeSimpleResponse(429)
    second = await backend_main._check_vision_available()
    assert first == second == {"available": True, "reason": None}


@pytest.mark.asyncio
async def test_capability_check_reflects_restored_billing_after_ttl_expiry(monkeypatch):
    """The core "auto-start once credit is added" guarantee: once the cache
    entry is stale, the next check reflects current provider reality
    without any code change or redeploy."""
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", make_fake_stream_client(FakeStreamHTTPResponse(200), probe_status=429))
    before = await backend_main._check_vision_available()
    assert before["available"] is False

    FakeStreamAsyncClient._probe_response = FakeSimpleResponse(200)
    backend_main._capability_cache["checked_at"] = 0.0  # simulate TTL expiry
    after = await backend_main._check_vision_available()
    assert after == {"available": True, "reason": None}


def test_capabilities_endpoint_reports_vision_and_chat(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "gsk-test")
    client = TestClient(backend_main.app)
    res = client.get("/capabilities")
    assert res.status_code == 200
    body = res.json()
    assert body["vision"]["available"] is False
    assert body["vision"]["reason"] == "not_configured"
    assert body["vision"]["message"]
    assert body["chat"]["available"] is True


def test_capabilities_endpoint_reports_web_search_before_any_traffic(monkeypatch):
    from backend import search_providers as sp

    sp._last_status.update(provider=None, available=None, reason=None, checked_at=0.0)
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "gsk-test")
    client = TestClient(backend_main.app)
    res = client.get("/capabilities")
    body = res.json()
    # Before any real search has run, availability is inferred from config only.
    assert "available" in body["web_search"]
    sp._last_status.update(provider=None, available=None, reason=None, checked_at=0.0)


def test_capabilities_endpoint_reports_web_search_degraded_after_real_failure(monkeypatch):
    from backend import search_providers as sp

    sp._last_status.update(provider="tavily", available=False, reason="quota_exceeded", checked_at=1.0)
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "gsk-test")
    client = TestClient(backend_main.app)
    res = client.get("/capabilities")
    body = res.json()
    assert body["web_search"]["available"] is False
    assert body["web_search"]["reason"] == "quota_exceeded"
    assert body["web_search"]["message"]
    sp._last_status.update(provider=None, available=None, reason=None, checked_at=0.0)


# ---------------------------------------------------------------------------
# stream_vision_response — graceful degradation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_openai_key_yields_specific_unavailable_message(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    parts = [tok async for tok in backend_main.stream_vision_response("What is this?", VALID_IMAGE, "English")]
    answer = "".join(parts)
    assert "isn't set up on this deployment" in answer


@pytest.mark.asyncio
async def test_quota_exceeded_yields_honest_billing_message_not_generic_retry(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", make_fake_stream_client(FakeStreamHTTPResponse(200), probe_status=429))
    parts = [tok async for tok in backend_main.stream_vision_response("What is this?", VALID_IMAGE, "English")]
    answer = "".join(parts)
    assert "no remaining credit" in answer
    assert "automatically" in answer
    # Never leak the raw provider error body to the user.
    assert "insufficient_quota" not in answer


@pytest.mark.asyncio
async def test_successful_response_streams_content_and_sends_multimodal_payload(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    sse_lines = [
        'data: {"choices":[{"delta":{"content":"This "}}]}',
        'data: {"choices":[{"delta":{"content":"is a red square."}}]}',
        "data: [DONE]",
    ]
    fake_client = make_fake_stream_client(FakeStreamHTTPResponse(200, sse_lines=sse_lines), probe_status=200)
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", fake_client)

    parts = [tok async for tok in backend_main.stream_vision_response("What color is this?", VALID_IMAGE, "English")]
    assert "".join(parts) == "This is a red square."

    sent = fake_client.last_request["json"]
    assert sent["model"] == backend_main.VISION_MODEL
    user_content = sent["messages"][-1]["content"]
    assert any(block["type"] == "image_url" and block["image_url"]["url"] == VALID_IMAGE for block in user_content)
    assert any(block["type"] == "text" for block in user_content)


# ---------------------------------------------------------------------------
# /chat and /chat/stream — image_data_url early-return path
# ---------------------------------------------------------------------------


@pytest.fixture
def authed_client(monkeypatch):
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    return TestClient(backend_main.app)


def test_chat_endpoint_rejects_invalid_image_type(authed_client):
    res = authed_client.post(
        "/chat",
        json={
            "message": "What is this?", "role": "customer", "language": "English",
            "image_data_url": "data:application/pdf;base64,xxx",
        },
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 422


def test_chat_endpoint_answers_from_image_without_no_openai_key(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    res = authed_client.post(
        "/chat",
        json={
            "message": "What is this?", "role": "customer", "language": "English",
            "image_data_url": VALID_IMAGE,
        },
        headers={"Authorization": "Bearer fake-token"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["answer_source"] == "vision"
    assert body["category"] == "vision"
    assert "isn't set up on this deployment" in body["answer"]
