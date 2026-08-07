"""
Tests for POST /chat/title — AI-generated conversation title endpoint.

The endpoint is deliberately a bare, non-RAG, non-history completion (see
backend/main.py::chat_title), so these tests stub the outbound Groq/OpenAI
HTTP call rather than hitting a real provider, and drive the FastAPI app
directly via TestClient. Authentication is bypassed via dependency_overrides
(require_user_id) rather than minting real Supabase JWTs — JWT verification
itself is covered by exercising the endpoint with no Authorization header,
which never reaches verify_jwt at all.
"""

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


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


def test_no_bearer_token_returns_401(client):
    res = client.post("/chat/title", json={"message": "How do I reset my password?"})
    assert res.status_code == 401


def test_authenticated_request_succeeds(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    res = authed_client.post("/chat/title", json={"message": "How do I reset my password?"})
    assert res.status_code == 200


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def test_rate_limit_enforced_per_user(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    for _ in range(backend_main.RATE_LIMIT_MAX):
        res = authed_client.post("/chat/title", json={"message": "hi"})
        assert res.status_code == 200
    res = authed_client.post("/chat/title", json={"message": "hi"})
    assert res.status_code == 429


# ---------------------------------------------------------------------------
# Fallback title (no provider configured)
# ---------------------------------------------------------------------------


def test_fallback_used_when_no_provider_configured(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    message = "How can I integrate Vapi with my Dayjoy backend?"
    res = authed_client.post("/chat/title", json={"message": message})
    assert res.status_code == 200
    assert res.json()["title"] == backend_main._fallback_title(message)


def test_fallback_truncates_long_message(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    message = "word " * 200
    res = authed_client.post("/chat/title", json={"message": message})
    assert res.status_code == 200
    assert len(res.json()["title"]) <= 48


def test_short_greeting_still_returns_a_title(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    res = authed_client.post("/chat/title", json={"message": "Hi"})
    assert res.status_code == 200
    assert res.json()["title"] == "Hi"


# ---------------------------------------------------------------------------
# AI-generated title (happy path + malformed/failure handling)
# ---------------------------------------------------------------------------


def test_ai_generated_title_used_when_valid(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(
        backend_main.httpx,
        "AsyncClient",
        make_fake_client(
            FakeResponse(200, {"choices": [{"message": {"content": "Vapi Backend Integration"}}]})
        ),
    )
    res = authed_client.post(
        "/chat/title", json={"message": "How can I integrate Vapi with my Dayjoy backend?"}
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Vapi Backend Integration"


def test_ai_output_quotes_and_trailing_period_stripped(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(
        backend_main.httpx,
        "AsyncClient",
        make_fake_client(
            FakeResponse(200, {"choices": [{"message": {"content": '"Distributor Commission System."'}}]})
        ),
    )
    res = authed_client.post("/chat/title", json={"message": "Design a distributor commission system."})
    assert res.status_code == 200
    assert res.json()["title"] == "Distributor Commission System"


def test_ai_empty_output_falls_back(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(
        backend_main.httpx,
        "AsyncClient",
        make_fake_client(FakeResponse(200, {"choices": [{"message": {"content": "   "}}]})),
    )
    message = "What is RAG and how do I use it for Dayjoy?"
    res = authed_client.post("/chat/title", json={"message": message})
    assert res.status_code == 200
    assert res.json()["title"] == backend_main._fallback_title(message)


def test_ai_output_too_long_falls_back(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    rambling = "This is a very long sentence pretending to be a title " * 3
    monkeypatch.setattr(
        backend_main.httpx,
        "AsyncClient",
        make_fake_client(FakeResponse(200, {"choices": [{"message": {"content": rambling}}]})),
    )
    message = "Ambiguous question that could mean many things"
    res = authed_client.post("/chat/title", json={"message": message})
    assert res.status_code == 200
    assert res.json()["title"] == backend_main._fallback_title(message)


def test_ai_malformed_json_shape_falls_back(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(
        backend_main.httpx,
        "AsyncClient",
        make_fake_client(FakeResponse(200, {"unexpected": "shape"})),
    )
    message = "Multiple topics: billing, then shipping, then returns"
    res = authed_client.post("/chat/title", json={"message": message})
    assert res.status_code == 200
    assert res.json()["title"] == backend_main._fallback_title(message)


def test_ai_http_error_falls_back(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(
        backend_main.httpx,
        "AsyncClient",
        make_fake_client(FakeResponse(500, {})),
    )
    message = "Customer support question about a delayed order"
    res = authed_client.post("/chat/title", json={"message": message})
    assert res.status_code == 200
    assert res.json()["title"] == backend_main._fallback_title(message)


def test_ai_timeout_or_network_failure_falls_back(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(backend_main.httpx, "AsyncClient", RaisingAsyncClient)
    message = "Non-English question: Comment intégrer Vapi ?"
    res = authed_client.post("/chat/title", json={"message": message})
    assert res.status_code == 200
    assert res.json()["title"] == backend_main._fallback_title(message)


def test_openai_used_when_groq_not_configured(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "fake-openai-key")
    monkeypatch.setattr(
        backend_main.httpx,
        "AsyncClient",
        make_fake_client(
            FakeResponse(200, {"choices": [{"message": {"content": "Product Question About Returns"}}]})
        ),
    )
    res = authed_client.post("/chat/title", json={"message": "Can I return a product after 30 days?"})
    assert res.status_code == 200
    assert res.json()["title"] == "Product Question About Returns"
    assert "api.openai.com" in FakeAsyncClient.last_request["url"]


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def test_empty_message_rejected(authed_client):
    res = authed_client.post("/chat/title", json={"message": ""})
    assert res.status_code == 422


def test_message_over_max_length_rejected(authed_client):
    res = authed_client.post(
        "/chat/title", json={"message": "x" * (backend_main.MAX_MESSAGE_LENGTH + 1)}
    )
    assert res.status_code == 422
