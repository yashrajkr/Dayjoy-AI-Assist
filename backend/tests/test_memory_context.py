"""Memory 2.0 (Next-Gen spec, Phase 10) —
orchestrator/memory_context.py's unified short/long/task memory."""

from __future__ import annotations

import pytest

from backend.orchestrator.memory_context import gather_memory_context, task_memory_prompt_block


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    import backend.main as backend_main

    monkeypatch.setattr(backend_main, "SUPABASE_URL", "https://example.supabase.co")


def _stub_db(monkeypatch, goals=None, tasks_by_goal=None):
    import backend.main as backend_main

    async def _fake_select(token, table, columns="*", filters=None, limit=50):
        if table == "ai_coach_goals":
            return goals or []
        if table == "ai_coach_tasks":
            goal_id = filters.get("goal_id")
            return (tasks_by_goal or {}).get(goal_id, [])
        return []

    monkeypatch.setattr(backend_main, "supabase_select", _fake_select)


@pytest.mark.asyncio
async def test_gather_with_no_user_id_skips_long_term_and_task_memory(monkeypatch):
    _stub_db(monkeypatch)
    ctx = await gather_memory_context(None, None, [{"role": "user", "content": "hi"}])
    assert ctx.long_term_summaries == []
    assert ctx.task_memory == []


@pytest.mark.asyncio
async def test_gather_includes_short_term_from_history(monkeypatch):
    _stub_db(monkeypatch)
    history = [{"role": "user", "content": "Tell me about Dayjoy Turmeric"}]
    ctx = await gather_memory_context(None, "user-1", history)
    assert "Dayjoy Turmeric" in ctx.short_term.entities


@pytest.mark.asyncio
async def test_gather_includes_active_goal_task_memory(monkeypatch):
    _stub_db(
        monkeypatch,
        goals=[{"id": "goal-1", "goal_text": "Improve follow-up"}],
        tasks_by_goal={
            "goal-1": [
                {"task_text": "Call 5 leads", "status": "pending", "sort_order": 0},
                {"task_text": "Review responses", "status": "pending", "sort_order": 1},
            ]
        },
    )
    ctx = await gather_memory_context(None, "user-1", [])
    assert len(ctx.task_memory) == 1
    assert ctx.task_memory[0].goal_text == "Improve follow-up"
    assert ctx.task_memory[0].next_steps == ["Call 5 leads", "Review responses"]


@pytest.mark.asyncio
async def test_task_memory_bounded_to_max_steps_per_goal(monkeypatch):
    many_tasks = [{"task_text": f"Step {i}", "status": "pending", "sort_order": i} for i in range(10)]
    _stub_db(
        monkeypatch,
        goals=[{"id": "goal-1", "goal_text": "Grow team"}],
        tasks_by_goal={"goal-1": many_tasks[:3]},  # supabase_select's own limit already caps this
    )
    ctx = await gather_memory_context(None, "user-1", [])
    assert len(ctx.task_memory[0].next_steps) <= 3


@pytest.mark.asyncio
async def test_gather_never_raises_when_db_layer_errors(monkeypatch):
    import backend.main as backend_main

    async def _boom(*a, **kw):
        raise RuntimeError("db unreachable")

    monkeypatch.setattr(backend_main, "supabase_select", _boom)
    ctx = await gather_memory_context(None, "user-1", [{"role": "user", "content": "hi"}])
    assert ctx.task_memory == []
    assert ctx.long_term_summaries == []


def test_to_prompt_block_empty_when_nothing_to_carry():
    from backend.orchestrator.conversation_state import ConversationState
    from backend.orchestrator.memory_context import UnifiedMemoryContext

    ctx = UnifiedMemoryContext(short_term=ConversationState())
    assert ctx.to_prompt_block() == ""


def test_to_prompt_block_includes_all_three_layers():
    from backend.orchestrator.conversation_state import ConversationState
    from backend.orchestrator.memory_context import TaskMemoryItem, UnifiedMemoryContext

    ctx = UnifiedMemoryContext(
        short_term=ConversationState(entities=["Dayjoy Turmeric"], recent_topics=["pricing"]),
        long_term_summaries=["prefers Hindi"],
        task_memory=[TaskMemoryItem(goal_id="g1", goal_text="Grow sales", next_steps=["Call 5 leads"])],
    )
    block = ctx.to_prompt_block()
    assert "Dayjoy Turmeric" in block
    assert "prefers Hindi" in block
    assert "Grow sales" in block
    assert "Call 5 leads" in block


@pytest.mark.asyncio
async def test_task_memory_prompt_block_empty_when_no_goals(monkeypatch):
    _stub_db(monkeypatch, goals=[])
    block = await task_memory_prompt_block(None, "user-1")
    assert block == ""


@pytest.mark.asyncio
async def test_task_memory_prompt_block_renders_active_goal(monkeypatch):
    _stub_db(
        monkeypatch,
        goals=[{"id": "goal-1", "goal_text": "Improve follow-up"}],
        tasks_by_goal={"goal-1": [{"task_text": "Call 5 leads", "status": "pending", "sort_order": 0}]},
    )
    block = await task_memory_prompt_block(None, "user-1")
    assert "Improve follow-up" in block
    assert "Call 5 leads" in block


def test_to_dict_is_json_serializable():
    import json

    from backend.orchestrator.conversation_state import ConversationState
    from backend.orchestrator.memory_context import UnifiedMemoryContext

    ctx = UnifiedMemoryContext(short_term=ConversationState(entities=["X"]))
    json.dumps(ctx.to_dict())  # must not raise
