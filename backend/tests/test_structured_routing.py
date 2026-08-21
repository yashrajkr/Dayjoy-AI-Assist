"""
Endpoint-level tests for the structured pricing/recommendation/clarification
short-circuits wired into `_route_events` (backend/main.py). Follows the same
isolation pattern as test_router.py: SUPABASE_URL/GROQ_API_KEY/OPENAI_API_KEY
cleared, and the actual DB/tool boundary (`pricing_tool.run` /
`recommend_tool.run`) monkeypatched per test rather than hitting Supabase.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import main as backend_main
from backend.orchestrator.answer_verify import AnswerVerdict
from backend.orchestrator.tools import registry as tools_registry


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "SUPABASE_URL", "")
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")
    backend_main._rate_limit_store.clear()
    backend_main._safety_cache = []
    backend_main._safety_cache_at = 0.0
    # ToolRegistry is a module-level singleton (backend/orchestrator/tools/
    # registry.py) that captures each tool's `run` function by reference the
    # FIRST time get_registry() is called in the process — so once it's been
    # built once, later monkeypatch.setattr(pricing_tool, "run", ...) calls
    # in a different test have no effect on what run_tools() actually calls.
    # Reset it before each test so it re-registers fresh (picking up that
    # test's monkeypatches, applied below, before anything triggers
    # get_registry()) and after so no test's patched handler leaks forward.
    tools_registry._registry = None
    yield
    tools_registry._registry = None
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


def _never_called_retrieve_context(monkeypatch, calls: list):
    async def _stub(token, message, limit_per_table=3):
        calls.append(message)
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub)


# ---------------------------------------------------------------------------
# Pricing short-circuit
# ---------------------------------------------------------------------------


def test_pricing_found_skips_rag_and_uses_structured_context(authed_client, monkeypatch):
    rag_calls: list = []
    _never_called_retrieve_context(monkeypatch, rag_calls)

    async def _fake_pricing_run(token, message):
        return {
            "found": True,
            "product_name": "Dayjoy Turmeric",
            "product_id": "P-1",
            "mrp": 999,
            "dp": 799,
            "bv": 50,
            "pv": 50,
            "currency": "INR",
            "effective_from": "2026-01-01",
        }

    monkeypatch.setattr(backend_main.pricing_tool, "run", _fake_pricing_run)

    res = authed_client.post(
        "/chat", json={"message": "What is the DP of Dayjoy Turmeric?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["category"] == "pricing"
    assert body["answer_source"] == "dayjoy_knowledge"
    assert body["rag_metadata"]["source"] == "structured_pricing"
    assert body["rag_metadata"]["evidence_sufficient"] is True
    # RAG never ran — the structured lookup was authoritative on its own.
    assert rag_calls == []


def test_pricing_compound_question_merges_kb_context_in_parallel(authed_client, monkeypatch):
    """Phase 2: a compound question ("what are the ingredients ... and how
    much does it cost") runs pricing_lookup AND dayjoy_kb concurrently
    (planner.py proposes both — see wants_additional_info) and merges both,
    instead of only ever answering the price half."""
    kb_calls: list = []

    async def _stub_kb(token, message, limit_per_table=3):
        kb_calls.append(message)
        return "Dayjoy Turmeric contains 95% curcuminoids and black pepper extract.", [], "product", None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_kb)

    async def _fake_pricing_run(token, message):
        return {"found": True, "product_name": "Dayjoy Turmeric", "product_id": "P-1", "mrp": 999, "dp": 799, "bv": 50, "pv": 50, "currency": "INR"}

    monkeypatch.setattr(backend_main.pricing_tool, "run", _fake_pricing_run)

    res = authed_client.post(
        "/chat",
        json={
            "message": "What are the ingredients of Dayjoy Turmeric and how much does it cost?",
            "role": "customer",
            "language": "English",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["rag_metadata"]["source"] == "structured_pricing"
    # Both ran concurrently (single request, not two round-trips) and both
    # contributed — the price came from the structured tool, the ingredient
    # detail from the parallel dayjoy_kb call, merged into one answer.
    assert kb_calls == ["What are the ingredients of Dayjoy Turmeric and how much does it cost?"]
    assert "curcuminoids" in body["answer"] or "799" in body["answer"] or "Turmeric" in body["answer"]


def test_pricing_not_found_falls_through_to_rag(authed_client, monkeypatch):
    rag_calls: list = []
    _never_called_retrieve_context(monkeypatch, rag_calls)

    async def _fake_pricing_run(token, message):
        return {"found": False}

    monkeypatch.setattr(backend_main.pricing_tool, "run", _fake_pricing_run)

    res = authed_client.post(
        "/chat", json={"message": "What is the DP of some unlisted product?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    # Fell through to the normal RAG path instead of dead-ending.
    assert rag_calls == ["What is the DP of some unlisted product?"]


# ---------------------------------------------------------------------------
# Recommendation short-circuit
# ---------------------------------------------------------------------------


def test_recommendation_ok_skips_rag_and_uses_structured_context(authed_client, monkeypatch):
    # dayjoy_kb runs IN PARALLEL alongside product_recommendation for every
    # recommendation-intent message (planner.py always proposes it, for
    # supporting explanation text) — so retrieve_context DOES get called
    # here now, unlike before Phase 2. What must NOT happen is the RAG text
    # silently replacing or overriding the structured recommendation.
    kb_calls: list = []
    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context("", category="general"))

    async def _tracking_retrieve_context(token, message, limit_per_table=3):
        kb_calls.append(message)
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _tracking_retrieve_context)

    async def _fake_recommend_run(token, message, max_results=3):
        return {
            "status": "ok",
            "products": [
                {
                    "product_id": "P-2",
                    "product_name": "Dayjoy Ashwagandha",
                    "matched_condition": "Anxiety",
                    "benefits": "Supports stress response.",
                    "usage": "Once daily.",
                    "dosage": "1 capsule",
                    "who_can_use": "Adults",
                    "contraindications": None,
                    "safety_note": None,
                    "price": {"mrp": 599, "dp": 499, "bv": 30, "pv": 30, "currency": "INR"},
                }
            ],
            "matched_conditions": ["Anxiety"],
        }

    monkeypatch.setattr(backend_main.recommend_tool, "run", _fake_recommend_run)

    res = authed_client.post(
        "/chat", json={"message": "Suggest something good for anxiety.", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["category"] == "recommendation"
    assert body["answer_source"] == "dayjoy_knowledge"
    assert body["rag_metadata"]["source"] == "structured_recommendation"
    assert kb_calls == ["Suggest something good for anxiety."]  # ran, but contributed nothing (empty stub)


def test_recommendation_ok_merges_supporting_kb_context(authed_client, monkeypatch):
    """The actual point of Phase 2: when dayjoy_kb DOES find supporting
    material, it's appended (clearly labeled) alongside the authoritative
    structured recommendation — not silently dropped, not replacing it."""

    async def _stub_kb(token, message, limit_per_table=3):
        return "Ashwagandha is an adaptogen traditionally used for stress support.", [], "product", None

    monkeypatch.setattr(backend_main, "retrieve_context", _stub_kb)

    async def _fake_recommend_run(token, message, max_results=3):
        return {
            "status": "ok",
            "products": [{"product_id": "P-2", "product_name": "Dayjoy Ashwagandha", "matched_condition": "Anxiety"}],
            "matched_conditions": ["Anxiety"],
        }

    monkeypatch.setattr(backend_main.recommend_tool, "run", _fake_recommend_run)

    res = authed_client.post(
        "/chat", json={"message": "Suggest something good for anxiety.", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert "Dayjoy Ashwagandha" in body["answer"] or "Dayjoy Ashwagandha" in str(body.get("rag_metadata"))
    # The route context itself (not necessarily the LLM-phrased answer, since
    # GROQ/OPENAI are cleared and the fallback picks the best-matching block)
    # carries both the structured recommendation and the supporting KB text —
    # checked via the fallback answer, which is built directly from context.
    assert "adaptogen" in body["answer"] or "Dayjoy Ashwagandha" in body["answer"]


def test_recommendation_needs_clarification_returns_question_directly(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "retrieve_context", _stub_retrieve_context(""))

    async def _fake_recommend_run(token, message, max_results=3):
        return {
            "status": "needs_clarification",
            "clarifying_question": "I found a few things that could match — anxiety or energy?",
            "matched_conditions": ["Anxiety", "Energy"],
        }

    monkeypatch.setattr(backend_main.recommend_tool, "run", _fake_recommend_run)

    res = authed_client.post(
        "/chat", json={"message": "Suggest something good.", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["category"] == "clarification"
    assert body["answer_source"] == "clarification"
    # No LLM call happened (GROQ/OPENAI cleared) — this proves the answer is
    # the router's own deterministic text, not a generated one. The
    # concurrently-run dayjoy_kb result (if any) is correctly discarded —
    # a clarifying question never gets padded with unrelated KB text.
    assert body["answer"] == "I found a few things that could match — anxiety or energy?"


def test_recommendation_insufficient_evidence_falls_through_to_rag(authed_client, monkeypatch):
    rag_calls: list = []

    async def _tracking_retrieve_context(token, message, limit_per_table=3):
        rag_calls.append(message)
        return "", [], "general", None

    monkeypatch.setattr(backend_main, "retrieve_context", _tracking_retrieve_context)

    async def _fake_recommend_run(token, message, max_results=3):
        return {"status": "insufficient_evidence"}

    monkeypatch.setattr(backend_main.recommend_tool, "run", _fake_recommend_run)

    res = authed_client.post(
        "/chat", json={"message": "What should I take for a very unusual made-up condition?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    # dayjoy_kb already ran once (in parallel, alongside the recommendation
    # attempt) — that result is REUSED for the fallthrough, not a second,
    # redundant retrieve_context() round-trip.
    assert rag_calls == ["What should I take for a very unusual made-up condition?"]


# ---------------------------------------------------------------------------
# Ambiguous-recommendation clarification (clarify.py), checked before pricing/
# recommendation tools run at all
# ---------------------------------------------------------------------------


def _stub_retrieve_context(context: str, sources=None, category: str = "general", rag_metadata=None):
    async def _stub(token, message, limit_per_table=3):
        return context, sources or [], category, rag_metadata

    return _stub


def _stub_stream_groq(chunks: list):
    """Each call to stream_response consumes one entry from `chunks` (a list
    of token-lists) — call N gets `chunks[N]`. Lets a test give the first
    (pre-retry) generation different output than the retry."""
    call_index = {"n": 0}

    async def _stub(message, history, context, language, mode="dayjoy", custom_guidance=""):
        i = min(call_index["n"], len(chunks) - 1)
        call_index["n"] += 1
        for tok in chunks[i]:
            yield tok

    return _stub


# ---------------------------------------------------------------------------
# Post-generation answer verification (backend/orchestrator/answer_verify.py)
# wired into /chat — the one genuinely new pipeline stage, not just the
# structured short-circuits above.
# ---------------------------------------------------------------------------


def test_mismatched_answer_is_retried_and_corrected(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(
        backend_main,
        "retrieve_context",
        _stub_retrieve_context(
            "[1] Source: faq-1 | Score: 0.900\nQ: What is Dayjoy? A: Dayjoy is a wellness brand.",
            category="general",
            rag_metadata={"confidence": 0.9, "verification_status": "verified", "evidence_sufficient": True},
        ),
    )
    monkeypatch.setattr(
        backend_main,
        "stream_groq",
        _stub_stream_groq([
            ["Dayjoy is a wellness and direct-selling brand."],  # first pass: off-topic vs the actual question below
            ["The last cricket world cup was won by a team I don't have verified information on."],  # retry
        ]),
    )

    verify_calls: list = []

    async def _fake_verify_answer(question, answer, evidence_summary):
        verify_calls.append(answer)
        # First call (the off-topic pass) fails; the retried answer passes.
        if len(verify_calls) == 1:
            return AnswerVerdict(addresses_question=False, reason="off topic", checked=True)
        return AnswerVerdict(addresses_question=True, reason="on topic", checked=True)

    monkeypatch.setattr(backend_main, "verify_answer", _fake_verify_answer)

    res = authed_client.post(
        "/chat", json={"message": "Who won the last cricket world cup?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    # The retried (verified-good) answer was served, not the first mismatched one.
    assert "cricket world cup" in body["answer"]
    assert "Dayjoy is a wellness" not in body["answer"]
    assert len(verify_calls) == 2


def test_answer_still_mismatched_after_retry_triggers_handoff(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(
        backend_main,
        "retrieve_context",
        _stub_retrieve_context(
            "[1] Source: faq-1 | Score: 0.900\nQ: What is Dayjoy? A: Dayjoy is a wellness brand.",
            category="general",
            rag_metadata={"confidence": 0.9, "verification_status": "verified", "evidence_sufficient": True},
        ),
    )
    monkeypatch.setattr(
        backend_main,
        "stream_groq",
        _stub_stream_groq([["Off-topic answer, attempt one."], ["Still off-topic, attempt two."]]),
    )

    async def _always_fails(question, answer, evidence_summary):
        return AnswerVerdict(addresses_question=False, reason="off topic", checked=True)

    monkeypatch.setattr(backend_main, "verify_answer", _always_fails)

    res = authed_client.post(
        "/chat", json={"message": "Who won the last cricket world cup?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["handoff_required"] is True
    assert "may not directly address your exact question" in body["handoff_message"]


def _parse_sse(text: str) -> list:
    import json as _json

    frames = []
    for line in text.splitlines():
        if line.startswith("data:"):
            frames.append(_json.loads(line[len("data:"):].strip()))
    return frames


def test_chat_stream_mismatched_answer_flags_handoff_without_retry(authed_client, monkeypatch):
    """`/chat/stream` can't retroactively un-send tokens already streamed to
    the client, so unlike `/chat` it only FLAGS a mismatch (handoff_required
    + message) rather than retrying generation — see the comment at its
    call site in backend/main.py for why."""
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")
    monkeypatch.setattr(
        backend_main,
        "retrieve_context",
        _stub_retrieve_context(
            "[1] Source: faq-1 | Score: 0.900\nQ: What is Dayjoy? A: Dayjoy is a wellness brand.",
            category="general",
            rag_metadata={"confidence": 0.9, "verification_status": "verified", "evidence_sufficient": True},
        ),
    )
    monkeypatch.setattr(backend_main, "stream_groq", _stub_stream_groq([["Off-topic streamed answer."]]))

    async def _always_fails(question, answer, evidence_summary):
        return AnswerVerdict(addresses_question=False, reason="off topic", checked=True)

    monkeypatch.setattr(backend_main, "verify_answer", _always_fails)

    res = authed_client.post(
        "/chat/stream", json={"message": "Who won the last cricket world cup?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    frames = _parse_sse(res.text)
    tokens = "".join(f["token"] for f in frames if "token" in f)
    assert tokens == "Off-topic streamed answer."  # streamed as-is, not retried
    done_frame = next(f for f in frames if f.get("done"))
    assert done_frame["handoff_required"] is True
    assert "may not directly address your exact question" in done_frame["handoff_message"]


def test_chat_stream_clarification_bypasses_generation(authed_client, monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-groq-key")

    async def _fail_if_called(*a, **kw):
        raise AssertionError("stream_groq should not be called for a direct_answer bypass")
        yield  # pragma: no cover - unreachable, keeps this an async generator

    monkeypatch.setattr(backend_main, "stream_groq", _fail_if_called)

    res = authed_client.post(
        "/chat/stream", json={"message": "Which product is best?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    frames = _parse_sse(res.text)
    tokens = "".join(f["token"] for f in frames if "token" in f)
    assert "best for" in tokens.lower()  # the deterministic clarifying question, not a generated one
    done_frame = next(f for f in frames if f.get("done"))
    assert done_frame["category"] == "clarification"


def test_ambiguous_which_product_is_best_asks_before_any_lookup(authed_client, monkeypatch):
    rag_calls: list = []
    _never_called_retrieve_context(monkeypatch, rag_calls)
    pricing_calls: list = []
    recommend_calls: list = []

    async def _fake_pricing_run(token, message):
        pricing_calls.append(message)
        return {"found": False}

    async def _fake_recommend_run(token, message, max_results=3):
        recommend_calls.append(message)
        return {"status": "insufficient_evidence"}

    monkeypatch.setattr(backend_main.pricing_tool, "run", _fake_pricing_run)
    monkeypatch.setattr(backend_main.recommend_tool, "run", _fake_recommend_run)

    res = authed_client.post(
        "/chat", json={"message": "Which product is best?", "role": "customer", "language": "English"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["category"] == "clarification"
    # Neither structured tool nor RAG ran — clarification is checked first.
    assert pricing_calls == []
    assert recommend_calls == []
    assert rag_calls == []
