"""
Endpoint-level tests for the AI router — POST /chat.

Verifies that `answer_source` (dayjoy_knowledge | web_search | general_llm |
hybrid | casual | unsafe) is computed correctly for each routing scenario,
without touching real Supabase/Groq/OpenAI/search-provider network calls:

- `SUPABASE_URL` is cleared so every Supabase-backed helper (supabase_select,
  supabase_insert, load_history, ensure_conversation, _log_analytics,
  load_safety_rules) short-circuits via its own existing "no URL configured"
  guard — no mocking of Supabase itself needed.
- `GROQ_API_KEY`/`OPENAI_API_KEY` are cleared so `stream_response` falls back
  to its built-in rule-based answer — routing labels are computed
  independently of the actual generation step, so this doesn't affect what
  we're testing.
- `retrieve_context` and `web_search_multi` are monkeypatched directly per
  test case (the two real boundaries: Dayjoy retrieval and live web search).
"""

from typing import List, Optional, Tuple

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main
from backend.search_providers import WebSearchResult


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    backend_main._safety_cache = []
    backend_main._safety_cache_at = 0.0
    yield
    backend_main._rate_limit_store.clear()
    backend_main._safety_cache = []
    backend_main._safety_cache_at = 0.0


@pytest.fixture
def client():
    return TestClient(backend_main.app)


@pytest.fixture
def authed_client(client, monkeypatch):
    # /chat calls `get_user_id(request)` directly (not via FastAPI's
    # Depends()), so dependency_overrides doesn't apply — monkeypatch the
    # module-level function instead. Python resolves `get_user_id` from the
    # module globals on every call, so this takes effect immediately.
    async def _fake_get_user_id(request):
        return "test-user-id"

    monkeypatch.setattr(backend_main, "get_user_id", _fake_get_user_id)
    yield client


def stub_retrieve_context(context: str, sources=None, category: str = "general", rag_metadata=None):
    async def _stub(token, message, limit_per_table=3, top_k=None):
        return context, sources or [], category, rag_metadata

    return _stub


def stub_web_search_multi(
    results: List[WebSearchResult], provider: Optional[str], any_configured: bool
):
    async def _stub(query: str, max_results: int = 4) -> Tuple[List[WebSearchResult], Optional[str], bool]:
        return results, provider, any_configured

    return _stub


def never_called_web_search(monkeypatch, calls: list):
    async def _stub(query: str, max_results: int = 4):
        calls.append(query)
        return [], None, False

    monkeypatch.setattr(backend_main, "web_search_multi", _stub)


# ---------------------------------------------------------------------------
# Casual greeting — no retrieval, no web search
# ---------------------------------------------------------------------------


def test_casual_greeting_routes_to_casual(authed_client, monkeypatch):
    calls: list = []
    never_called_web_search(monkeypatch, calls)
    res = authed_client.post("/chat", json={"message": "hi", "role": "customer", "language": "English"})
    assert res.status_code == 200
    body = res.json()
    assert body["answer_source"] == "casual"
    assert calls == []


# ---------------------------------------------------------------------------
# Dayjoy knowledge found — no comparison cue, no web search
# ---------------------------------------------------------------------------


def test_no_llm_fallback_picks_relevant_block_not_unrelated_dump(authed_client, monkeypatch):
    """Reproduces a real reported bug: asking about order status returned
    three concatenated, unrelated FAQ blocks (contact details, company
    registration, "what is Dayjoy") because retrieval matched on the shared
    token "Dayjoy" while both LLM providers were unavailable. The no-LLM
    fallback must pick only the block that actually overlaps the question,
    or admit it doesn't know — never concatenate everything retrieval found."""
    monkeypatch.setattr(
        backend_main,
        "retrieve_context",
        stub_retrieve_context(
            "[faqs] What are Dayjoy's official contact details?\n"
            "Website: https://dayjoy.in, Support email: support@dayjoy.in, Phone: +91 74120 34387.\n\n"
            "[faqs] What is Dayjoy's company structure and registration details?\n"
            "Dayjoy Marketing Private Limited is a Private Limited Company (CIN U52600RJ2018PTC062258).\n\n"
            "[faqs] What is Dayjoy?\n"
            "Dayjoy is the wellness and direct-selling brand of Dayjoy Marketing Private Limited.",
            category="faq",
        ),
    )
    never_called_web_search(monkeypatch, [])

    res = authed_client.post(
        "/chat",
        json={"message": "What's the status of my most recent Dayjoy order?", "role": "customer", "language": "English"},
    )
    assert res.status_code == 200
    answer = res.json()["answer"]
    # None of the three unrelated FAQ blocks share enough tokens with "status
    # of my most recent order" to clear the relevance bar — the honest
    # not-confident message must be shown, not a concatenation of all three.
    assert "official contact details" not in answer
    assert "company structure and registration" not in answer
    assert "I don't have enough approved information" in answer


def test_no_llm_fallback_picks_single_relevant_block_when_one_matches(authed_client, monkeypatch):
    monkeypatch.setattr(
        backend_main,
        "retrieve_context",
        stub_retrieve_context(
            "[faqs] What is Dayjoy's refund policy?\n"
            "Refunds are processed within 7 business days of an approved return.\n\n"
            "[faqs] What is Dayjoy?\n"
            "Dayjoy is the wellness and direct-selling brand of Dayjoy Marketing Private Limited.",
            category="faq",
        ),
    )
    never_called_web_search(monkeypatch, [])

    res = authed_client.post(
        "/chat", json={"message": "What is Dayjoy's refund policy?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    answer = res.json()["answer"]
    assert "Refunds are processed within 7 business days" in answer
    # The unrelated "what is Dayjoy" block must not be concatenated in too.
    assert "wellness and direct-selling brand" not in answer


def test_dayjoy_match_routes_to_dayjoy_knowledge(authed_client, monkeypatch):
    monkeypatch.setattr(
        backend_main,
        "retrieve_context",
        stub_retrieve_context("[products] Dayjoy Spirulina\nRich in protein.", category="product"),
    )
    calls: list = []
    never_called_web_search(monkeypatch, calls)

    res = authed_client.post(
        "/chat", json={"message": "What are the benefits of Dayjoy Spirulina?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["answer_source"] == "dayjoy_knowledge"
    assert body["web_search_provider"] is None
    assert calls == []  # web search never triggered — Dayjoy context was found, no comparison cue


# ---------------------------------------------------------------------------
# No Dayjoy match, no web provider configured — general LLM knowledge
# ---------------------------------------------------------------------------


def test_no_match_no_web_provider_routes_to_general_llm(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "retrieve_context", stub_retrieve_context(""))
    monkeypatch.setattr(backend_main, "web_search_multi", stub_web_search_multi([], None, False))

    res = authed_client.post(
        "/chat", json={"message": "Explain machine learning in simple terms.", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["answer_source"] == "general_llm"
    assert body["web_search_provider"] is None


# ---------------------------------------------------------------------------
# No Dayjoy match, web search succeeds — web_search route
# ---------------------------------------------------------------------------


def test_no_match_with_web_results_routes_to_web_search(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "retrieve_context", stub_retrieve_context(""))
    monkeypatch.setattr(
        backend_main,
        "web_search_multi",
        stub_web_search_multi(
            [WebSearchResult(title="Current events", url="https://example.com", content="Some news content.")],
            "tavily",
            True,
        ),
    )

    res = authed_client.post(
        "/chat", json={"message": "What's the latest AI news today?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["answer_source"] == "web_search"
    assert body["web_search_provider"] == "tavily"
    assert body["category"] == "general"


# ---------------------------------------------------------------------------
# Dayjoy match + comparison cue + web results — hybrid route
# ---------------------------------------------------------------------------


def test_comparison_with_dayjoy_match_and_web_routes_to_hybrid(authed_client, monkeypatch):
    monkeypatch.setattr(
        backend_main,
        "retrieve_context",
        stub_retrieve_context("[products] Dayjoy Spirulina\nRich in protein.", category="product"),
    )
    monkeypatch.setattr(
        backend_main,
        "web_search_multi",
        stub_web_search_multi(
            [WebSearchResult(title="Competitor Spirulina", url="https://example.com/c", content="Also rich in protein.")],
            "brave",
            True,
        ),
    )

    res = authed_client.post(
        "/chat",
        json={
            "message": "Compare Dayjoy Spirulina with competing Spirulina products.",
            "role": "customer",
            "language": "English",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["answer_source"] == "hybrid"
    assert body["web_search_provider"] == "brave"


def test_comparison_with_dayjoy_match_but_no_web_falls_back_to_dayjoy_knowledge(authed_client, monkeypatch):
    """A comparison cue alone doesn't force hybrid — only when web search
    actually returns something. Otherwise it's indistinguishable from a
    plain Dayjoy question."""
    monkeypatch.setattr(
        backend_main,
        "retrieve_context",
        stub_retrieve_context("[products] Dayjoy Spirulina\nRich in protein.", category="product"),
    )
    monkeypatch.setattr(backend_main, "web_search_multi", stub_web_search_multi([], None, False))

    res = authed_client.post(
        "/chat",
        json={
            "message": "Compare Dayjoy Spirulina with competing Spirulina products.",
            "role": "customer",
            "language": "English",
        },
    )
    assert res.status_code == 200
    assert res.json()["answer_source"] == "dayjoy_knowledge"


# ---------------------------------------------------------------------------
# Safety-blocked message
# ---------------------------------------------------------------------------


def test_unsafe_message_routes_to_unsafe(authed_client, monkeypatch):
    calls: list = []
    never_called_web_search(monkeypatch, calls)
    res = authed_client.post(
        "/chat", json={"message": "Does this product cure cancer?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["answer_source"] == "unsafe"
    assert body["safety_status"] == "blocked"
    assert calls == []


# ---------------------------------------------------------------------------
# Unauthorized request
# ---------------------------------------------------------------------------


def test_unauthenticated_request_rejected(client):
    res = client.post("/chat", json={"message": "hi", "role": "customer", "language": "English"})
    assert res.status_code == 401
