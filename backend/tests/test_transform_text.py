"""Tests for POST /transform-text — Answer Editing, selection-scoped
(Capability 12). Follows the same isolation pattern as test_chat_title.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main


class FakeResponse:
    def __init__(self, status_code: int, json_data: dict):
        self.status_code = status_code
        self._json_data = json_data

    def json(self):
        return self._json_data


class FakeAsyncClient:
    """Drop-in stand-in for httpx.AsyncClient used as an async context manager."""

    last_request: dict | None = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        FakeAsyncClient.last_request = {"url": url, "headers": headers, "json": json}
        return FakeAsyncClient._response


def make_fake_client(response: FakeResponse):
    FakeAsyncClient._response = response
    return FakeAsyncClient


class RaisingAsyncClient(FakeAsyncClient):
    async def post(self, url, headers=None, json=None):
        raise TimeoutError("upstream timed out")


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    backend_main._rate_limit_store.clear()
    yield
    backend_main._rate_limit_store.clear()


@pytest.fixture
def client():
    return TestClient(backend_main.app)


@pytest.fixture
def authed_client(client):
    backend_main.app.dependency_overrides[backend_main.require_user_id] = lambda: "test-user-id"
    yield client
    backend_main.app.dependency_overrides.pop(backend_main.require_user_id, None)


def test_no_bearer_token_returns_401(client):
    res = client.post("/transform-text", json={"text": "some text", "instruction": "Make it shorter."})
    assert res.status_code == 401


def test_no_provider_configured_returns_original_text_unchanged(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    res = authed_client.post("/transform-text", json={"text": "The DP is 799 rupees.", "instruction": "Make it shorter."})
    assert res.status_code == 200
    assert res.json()["result"] == "The DP is 799 rupees."


def test_successful_transform_returns_rewritten_text(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        backend_main.httpx, "AsyncClient",
        make_fake_client(FakeResponse(200, {"choices": [{"message": {"content": "DP: 799."}}]})),
    )
    res = authed_client.post(
        "/transform-text",
        json={"text": "The distributor price for this product is 799 rupees.", "instruction": "Make it shorter."},
    )
    assert res.status_code == 200
    assert res.json()["result"] == "DP: 799."

    sent = FakeAsyncClient.last_request
    assert "Make it shorter." in sent["json"]["messages"][0]["content"]
    assert "799 rupees" in sent["json"]["messages"][0]["content"]


def test_provider_error_falls_back_to_original_text(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", make_fake_client(FakeResponse(500, {})))
    res = authed_client.post("/transform-text", json={"text": "Original text.", "instruction": "Simplify it."})
    assert res.status_code == 200
    assert res.json()["result"] == "Original text."


def test_network_error_falls_back_to_original_text(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", RaisingAsyncClient)
    res = authed_client.post("/transform-text", json={"text": "Original text.", "instruction": "Simplify it."})
    assert res.status_code == 200
    assert res.json()["result"] == "Original text."


def test_falls_back_to_openai_when_no_groq(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "fake-openai-key")
    monkeypatch.setattr(
        backend_main.httpx, "AsyncClient",
        make_fake_client(FakeResponse(200, {"choices": [{"message": {"content": "Rewritten."}}]})),
    )
    res = authed_client.post("/transform-text", json={"text": "Original.", "instruction": "Rewrite it."})
    assert res.status_code == 200
    assert res.json()["result"] == "Rewritten."
    assert "openai.com" in FakeAsyncClient.last_request["url"]


def test_rejects_empty_text():
    client = TestClient(backend_main.app)
    backend_main.app.dependency_overrides[backend_main.require_user_id] = lambda: "test-user-id"
    try:
        res = client.post("/transform-text", json={"text": "", "instruction": "Rewrite it."})
        assert res.status_code == 422
    finally:
        backend_main.app.dependency_overrides.pop(backend_main.require_user_id, None)


def test_rate_limit_enforced_per_user(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    for _ in range(backend_main.RATE_LIMIT_MAX):
        res = authed_client.post("/transform-text", json={"text": "x", "instruction": "y"})
        assert res.status_code == 200
    res = authed_client.post("/transform-text", json={"text": "x", "instruction": "y"})
    assert res.status_code == 429
