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
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main

VALID_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


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
    """Drop-in for httpx.AsyncClient supporting only the .stream() context
    manager form stream_vision_response() actually uses."""

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def stream(self, method, url, headers=None, json=None):
        FakeStreamAsyncClient.last_request = {"method": method, "url": url, "headers": headers, "json": json}
        return FakeStreamContextManager(FakeStreamAsyncClient._response, FakeStreamAsyncClient.last_request)


def make_fake_stream_client(response: FakeStreamHTTPResponse):
    FakeStreamAsyncClient._response = response
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
# stream_vision_response — graceful degradation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_openai_key_yields_clear_unavailable_message(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    parts = [tok async for tok in backend_main.stream_vision_response("What is this?", VALID_IMAGE, "English")]
    answer = "".join(parts)
    assert "isn't available right now" in answer


@pytest.mark.asyncio
async def test_provider_error_degrades_to_honest_message(monkeypatch):
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(
        backend_main.httpx, "AsyncClient",
        make_fake_stream_client(FakeStreamHTTPResponse(429, body=b'{"error":"insufficient_quota"}')),
    )
    parts = [tok async for tok in backend_main.stream_vision_response("What is this?", VALID_IMAGE, "English")]
    answer = "".join(parts)
    assert "couldn't process" in answer
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
    fake_client = make_fake_stream_client(FakeStreamHTTPResponse(200, sse_lines=sse_lines))
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


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    backend_main._rate_limit_store.clear()
    yield
    backend_main._rate_limit_store.clear()


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
    assert "isn't available right now" in body["answer"]
