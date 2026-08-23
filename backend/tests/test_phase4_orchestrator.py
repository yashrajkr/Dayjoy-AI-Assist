"""Phase 4: query rewriting, clarifying questions, contextual follow-ups,
and parallel tool execution with per-tool timeout/degradation."""

from __future__ import annotations

import asyncio

import pytest

from backend.orchestrator import clarify, followups, rewrite
from backend.orchestrator.executor import run_tools
from backend.orchestrator.tools.registry import ToolSpec, get_registry


# ---------------------------------------------------------------------------
# Query rewriting
# ---------------------------------------------------------------------------


def test_rewrite_leaves_specific_question_unchanged():
    msg = "What are the benefits of Dayjoy Spirulina?"
    assert rewrite.rewrite_query(msg, history=[]) == msg


def test_rewrite_appends_context_for_pronoun_reference():
    history = [{"role": "user", "content": "Tell me about Dayjoy Spirulina."}]
    result = rewrite.rewrite_query("What about that one?", history)
    assert "Dayjoy Spirulina" in result
    assert "What about that one?" in result  # original wording preserved


def test_rewrite_no_history_returns_unchanged():
    assert rewrite.rewrite_query("What about that one?", history=[]) == "What about that one?"


# ---------------------------------------------------------------------------
# Clarifying questions
# ---------------------------------------------------------------------------


def test_ambiguous_recommendation_triggers_clarification():
    q = clarify.needs_clarification("Which product is best?")
    assert q is not None
    assert "?" in q.question
    assert len(q.options) > 0


def test_specific_goal_does_not_trigger_clarification():
    assert clarify.needs_clarification("Which product is best for digestion?") is None


def test_unrelated_question_does_not_trigger_clarification():
    assert clarify.needs_clarification("What is the refund policy?") is None


# ---------------------------------------------------------------------------
# Follow-ups
# ---------------------------------------------------------------------------


def test_casual_and_unsafe_get_no_followups():
    assert followups.generate_followups("casual", "general", "hi") == []
    assert followups.generate_followups("unsafe", "unsafe", "does this cure cancer?") == []


def test_product_answer_gets_relevant_non_generic_followups():
    suggestions = followups.generate_followups(
        "dayjoy_knowledge", "product", "What are the benefits of Dayjoy Spirulina?"
    )
    assert any("DP" in s or "MRP" in s for s in suggestions)
    assert any("BV" in s or "PV" in s for s in suggestions)
    assert len(suggestions) <= 4


def test_followup_already_covered_topic_not_repeated():
    suggestions = followups.generate_followups(
        "dayjoy_knowledge", "product", "What is the DP and MRP of Dayjoy Spirulina?"
    )
    assert not any("DP and MRP" in s for s in suggestions)


# ---------------------------------------------------------------------------
# Parallel execution with timeout/degradation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_tools_executes_concurrently_not_sequentially(monkeypatch):
    registry = get_registry()

    async def _slow(delay: float):
        await asyncio.sleep(delay)
        return "done"

    registry.register(ToolSpec(name="_test_slow", description="", timeout_seconds=2.0, requires_auth=False, handler=_slow))

    start = asyncio.get_event_loop().time()
    results = await run_tools(
        [
            {"name": "_test_slow", "kwargs": {"delay": 0.2}},
            {"name": "_test_slow", "kwargs": {"delay": 0.2}},
        ]
    )
    elapsed = asyncio.get_event_loop().time() - start
    assert all(r.ok for r in results)
    # Sequential would take ~0.4s; concurrent should take ~0.2s.
    assert elapsed < 0.35


@pytest.mark.asyncio
async def test_run_tools_degrades_gracefully_on_timeout():
    registry = get_registry()

    async def _hangs():
        await asyncio.sleep(5.0)

    registry.register(ToolSpec(name="_test_hangs", description="", timeout_seconds=0.05, requires_auth=False, handler=_hangs))

    results = await run_tools([{"name": "_test_hangs", "kwargs": {}}])
    assert len(results) == 1
    assert results[0].ok is False
    assert results[0].timed_out is True


@pytest.mark.asyncio
async def test_run_tools_one_failure_does_not_block_others():
    registry = get_registry()

    async def _fails():
        raise RuntimeError("boom")

    async def _succeeds():
        return "ok"

    registry.register(ToolSpec(name="_test_fails", description="", timeout_seconds=2.0, requires_auth=False, handler=_fails))
    registry.register(ToolSpec(name="_test_succeeds", description="", timeout_seconds=2.0, requires_auth=False, handler=_succeeds))

    results = await run_tools(
        [{"name": "_test_fails", "kwargs": {}}, {"name": "_test_succeeds", "kwargs": {}}]
    )
    by_name = {r.tool_name: r for r in results}
    assert by_name["_test_fails"].ok is False
    assert by_name["_test_succeeds"].ok is True
    assert by_name["_test_succeeds"].data == "ok"


@pytest.mark.asyncio
async def test_run_tools_empty_list_returns_empty():
    assert await run_tools([]) == []
