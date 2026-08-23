"""Tests for backend/orchestrator/conversation_state.py (Advanced
Intelligence Layer capability 7: Conversation Continuity Engine)."""

from __future__ import annotations

from backend.orchestrator.conversation_state import build_conversation_state


def test_empty_history_produces_empty_state():
    state = build_conversation_state([])
    assert state.entities == []
    assert state.recent_topics == []
    assert state.open_task is None
    assert state.to_summary() == ""


def test_extracts_dayjoy_product_entities():
    history = [
        {"role": "user", "content": "Tell me about Dayjoy Turmeric Curcumin"},
        {"role": "assistant", "content": "Dayjoy Turmeric Curcumin supports joint health."},
    ]
    state = build_conversation_state(history)
    assert "Dayjoy Turmeric Curcumin" in state.entities


def test_does_not_duplicate_repeated_entities():
    history = [
        {"role": "user", "content": "Tell me about Dayjoy Spirulina"},
        {"role": "assistant", "content": "Dayjoy Spirulina is a wellness supplement."},
        {"role": "user", "content": "What about Dayjoy Spirulina pricing?"},
    ]
    state = build_conversation_state(history)
    assert state.entities.count("Dayjoy Spirulina") == 1


def test_tracks_recent_user_topics():
    history = [
        {"role": "user", "content": "What is Dayjoy?"},
        {"role": "assistant", "content": "Dayjoy is a wellness company."},
        {"role": "user", "content": "What products do they sell?"},
    ]
    state = build_conversation_state(history)
    assert "What is Dayjoy?" in state.recent_topics
    assert "What products do they sell?" in state.recent_topics


def test_recent_topics_capped_at_max():
    history = [{"role": "user", "content": f"Question {i}"} for i in range(10)]
    state = build_conversation_state(history, max_topics=3)
    assert len(state.recent_topics) == 3
    assert state.recent_topics == ["Question 7", "Question 8", "Question 9"]


def test_action_plan_shaped_reply_becomes_open_task():
    history = [
        {"role": "user", "content": "Create a 7-day plan."},
        {"role": "assistant", "content": "1. Call your leads\n2. Follow up\n3. Close deals"},
    ]
    state = build_conversation_state(history)
    assert state.open_task is not None
    assert "1. Call your leads" in state.open_task


def test_plain_prose_reply_is_not_an_open_task():
    history = [
        {"role": "user", "content": "What is Dayjoy?"},
        {"role": "assistant", "content": "Dayjoy is a wellness and direct-selling company."},
    ]
    state = build_conversation_state(history)
    assert state.open_task is None


def test_entities_capped_at_max():
    names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"]
    history = [{"role": "user", "content": f"Tell me about Dayjoy {name}"} for name in names]
    state = build_conversation_state(history, max_entities=5)
    assert len(state.entities) == 5


def test_to_summary_includes_all_populated_fields():
    history = [
        {"role": "user", "content": "Tell me about Dayjoy Turmeric"},
        {"role": "assistant", "content": "1. Take one capsule daily\n2. With food\n3. Consult a doctor if pregnant"},
    ]
    state = build_conversation_state(history)
    summary = state.to_summary()
    assert "Dayjoy Turmeric" in summary
    assert "Take one capsule daily" in summary
