"""
Tests for backend/search_providers.py — the web search provider abstraction
(Tavily primary, Brave fallback, extensible chain).
"""

import pytest

from backend import search_providers as sp


class FakeResponse:
    def __init__(self, status_code: int, json_data: dict):
        self.status_code = status_code
        self._json_data = json_data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")

    def json(self):
        return self._json_data


class FakeAsyncClient:
    """Stand-in for httpx.AsyncClient supporting both .post (Tavily) and
    .get (Brave), configured per-test via class-level hooks."""

    post_response: FakeResponse | Exception | None = None
    get_response: FakeResponse | Exception | None = None

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

    async def get(self, url, headers=None, params=None):
        if isinstance(self.get_response, Exception):
            raise self.get_response
        return self.get_response


def _client_with(post=None, get=None):
    FakeAsyncClient.post_response = post
    FakeAsyncClient.get_response = get
    return FakeAsyncClient


# ---------------------------------------------------------------------------
# TavilyProvider
# ---------------------------------------------------------------------------


def test_tavily_not_configured(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "")
    provider = sp.TavilyProvider()
    assert provider.is_configured() is False


@pytest.mark.asyncio
async def test_tavily_not_configured_search_returns_empty(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "")
    provider = sp.TavilyProvider()
    assert await provider.search("dayjoy spirulina") == []


@pytest.mark.asyncio
async def test_tavily_success(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setattr(
        sp.httpx,
        "AsyncClient",
        _client_with(
            post=FakeResponse(
                200,
                {"results": [{"title": "Spirulina Benefits", "url": "https://example.com", "content": "Rich in protein."}]},
            )
        ),
    )
    provider = sp.TavilyProvider()
    results = await provider.search("spirulina benefits")
    assert len(results) == 1
    assert results[0].title == "Spirulina Benefits"
    assert results[0].content == "Rich in protein."


@pytest.mark.asyncio
async def test_tavily_http_error_raises(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setattr(sp.httpx, "AsyncClient", _client_with(post=FakeResponse(500, {})))
    provider = sp.TavilyProvider()
    with pytest.raises(Exception):
        await provider.search("query")


@pytest.mark.asyncio
async def test_tavily_skips_empty_content_results(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setattr(
        sp.httpx,
        "AsyncClient",
        _client_with(post=FakeResponse(200, {"results": [{"title": "Empty", "url": "u", "content": "  "}]})),
    )
    provider = sp.TavilyProvider()
    assert await provider.search("query") == []


# ---------------------------------------------------------------------------
# BraveProvider
# ---------------------------------------------------------------------------


def test_brave_not_configured(monkeypatch):
    monkeypatch.setenv("BRAVE_API_KEY", "")
    provider = sp.BraveProvider()
    assert provider.is_configured() is False


@pytest.mark.asyncio
async def test_brave_success(monkeypatch):
    monkeypatch.setenv("BRAVE_API_KEY", "fake-brave-key")
    monkeypatch.setattr(
        sp.httpx,
        "AsyncClient",
        _client_with(
            get=FakeResponse(
                200,
                {"web": {"results": [{"title": "Spirulina Guide", "url": "https://example.com/b", "description": "A blue-green algae."}]}},
            )
        ),
    )
    provider = sp.BraveProvider()
    results = await provider.search("spirulina")
    assert len(results) == 1
    assert results[0].title == "Spirulina Guide"
    assert results[0].content == "A blue-green algae."


@pytest.mark.asyncio
async def test_brave_malformed_response_returns_empty(monkeypatch):
    monkeypatch.setenv("BRAVE_API_KEY", "fake-brave-key")
    monkeypatch.setattr(sp.httpx, "AsyncClient", _client_with(get=FakeResponse(200, {"unexpected": "shape"})))
    provider = sp.BraveProvider()
    assert await provider.search("query") == []


# ---------------------------------------------------------------------------
# web_search_multi — provider chain
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_web_search_multi_no_providers_configured(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "")
    monkeypatch.setenv("BRAVE_API_KEY", "")
    results, provider_used, any_configured = await sp.web_search_multi("query")
    assert results == []
    assert provider_used is None
    assert any_configured is False


@pytest.mark.asyncio
async def test_web_search_multi_uses_primary_when_available(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setenv("BRAVE_API_KEY", "fake-brave-key")
    monkeypatch.setattr(
        sp.httpx,
        "AsyncClient",
        _client_with(post=FakeResponse(200, {"results": [{"title": "T", "url": "u", "content": "c"}]})),
    )
    results, provider_used, any_configured = await sp.web_search_multi("query")
    assert provider_used == "tavily"
    assert any_configured is True
    assert len(results) == 1


@pytest.mark.asyncio
async def test_web_search_multi_falls_back_to_brave_when_tavily_fails(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setenv("BRAVE_API_KEY", "fake-brave-key")
    monkeypatch.setattr(
        sp.httpx,
        "AsyncClient",
        _client_with(
            post=Exception("tavily down"),
            get=FakeResponse(200, {"web": {"results": [{"title": "B", "url": "u2", "description": "d"}]}}),
        ),
    )
    results, provider_used, any_configured = await sp.web_search_multi("query")
    assert provider_used == "brave"
    assert any_configured is True
    assert len(results) == 1
    assert results[0].title == "B"


@pytest.mark.asyncio
async def test_web_search_multi_falls_back_to_brave_when_tavily_returns_nothing(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setenv("BRAVE_API_KEY", "fake-brave-key")
    monkeypatch.setattr(
        sp.httpx,
        "AsyncClient",
        _client_with(
            post=FakeResponse(200, {"results": []}),
            get=FakeResponse(200, {"web": {"results": [{"title": "B", "url": "u2", "description": "d"}]}}),
        ),
    )
    results, provider_used, any_configured = await sp.web_search_multi("query")
    assert provider_used == "brave"


@pytest.mark.asyncio
async def test_web_search_multi_all_providers_fail(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setenv("BRAVE_API_KEY", "fake-brave-key")
    monkeypatch.setattr(
        sp.httpx,
        "AsyncClient",
        _client_with(post=Exception("tavily down"), get=Exception("brave down")),
    )
    results, provider_used, any_configured = await sp.web_search_multi("query")
    assert results == []
    assert provider_used is None
    assert any_configured is True  # configured, just unreachable
