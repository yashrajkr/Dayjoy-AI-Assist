"""
Wellness Profile — 4-way provenance (v33 migration + wellness_profile.py +
main.py::_format_wellness_context).

Covers: fact/hypothesis split, the confidence<->provenance invariant,
save_inferred_signal's refusal to write fact-tier provenance or overwrite an
existing confirmed fact, and a regression test for the real bug this session
fixed — _format_wellness_context used to label EVERY preference "already
confirmed" regardless of provenance, which is exactly the "never present an
inference as a user-confirmed fact" rule this whole feature exists to
enforce.
"""

from __future__ import annotations

import pytest

from backend.orchestrator.tools.wellness_profile import (
    FACT_PROVENANCE,
    TENTATIVE_PROVENANCE,
    save_inferred_signal,
    split_facts_and_hypotheses,
)


def _pref(key, value, provenance, confidence=None):
    return {"key": key, "value": value, "provenance": provenance, "confidence": confidence}


# ---------------------------------------------------------------------------
# split_facts_and_hypotheses
# ---------------------------------------------------------------------------


def test_split_facts_and_hypotheses_separates_by_provenance():
    signals = [
        _pref("preferred_time", "mornings", "user_provided"),
        _pref("dietary", "vegetarian", "verified_import"),
        _pref("coaching_style", "gentle", "inferred_conversation", 0.6),
        _pref("equipment", "none", "ai_recommendation", 0.4),
    ]
    facts, hypotheses = split_facts_and_hypotheses(signals)
    assert {f["key"] for f in facts} == {"preferred_time", "dietary"}
    assert {h["key"] for h in hypotheses} == {"coaching_style", "equipment"}


def test_split_handles_empty_and_unknown_provenance():
    facts, hypotheses = split_facts_and_hypotheses([])
    assert facts == [] and hypotheses == []
    # An unrecognized provenance value must not silently land in "facts" —
    # it's simply excluded from both, never defaulted to "confirmed".
    facts, hypotheses = split_facts_and_hypotheses([_pref("x", "y", "unknown_value")])
    assert facts == [] and hypotheses == []


def test_all_four_provenance_values_covered():
    assert set(FACT_PROVENANCE) == {"user_provided", "verified_import"}
    assert set(TENTATIVE_PROVENANCE) == {"inferred_conversation", "ai_recommendation"}


# ---------------------------------------------------------------------------
# save_inferred_signal
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_save_inferred_signal_rejects_fact_provenance():
    with pytest.raises(ValueError):
        await save_inferred_signal("tok", "user-1", "dietary", "vegan", "user_provided", 0.9)


@pytest.mark.asyncio
async def test_save_inferred_signal_rejects_out_of_range_confidence():
    with pytest.raises(ValueError):
        await save_inferred_signal("tok", "user-1", "dietary", "vegan", "ai_recommendation", 1.5)
    with pytest.raises(ValueError):
        await save_inferred_signal("tok", "user-1", "dietary", "vegan", "ai_recommendation", -0.1)


@pytest.mark.asyncio
async def test_save_inferred_signal_writes_new_tentative_row(monkeypatch):
    import backend.main as backend_main

    inserted = {}

    async def fake_select(token, table, columns="*", filters=None, limit=50):
        return []

    async def fake_insert(token, table, payload):
        inserted.update(payload)
        return payload

    monkeypatch.setattr(backend_main, "supabase_select", fake_select)
    monkeypatch.setattr(backend_main, "supabase_insert", fake_insert)

    result = await save_inferred_signal("tok", "user-1", "coaching_style", "gentle", "inferred_conversation", 0.55)
    assert result["provenance"] == "inferred_conversation"
    assert result["confidence"] == 0.55
    assert inserted["user_id"] == "user-1"


@pytest.mark.asyncio
async def test_save_inferred_signal_never_overwrites_a_confirmed_fact(monkeypatch):
    """The exact scenario this function exists to prevent: the AI thinks it
    has spotted a new signal for a key the user already explicitly
    confirmed — that guess must be dropped, not silently applied over the
    user's own answer."""
    import backend.main as backend_main

    update_called = False

    async def fake_select(token, table, columns="*", filters=None, limit=50):
        return [{"id": "row-1", "provenance": "user_provided"}]

    async def fake_update(token, table, filters, payload):
        nonlocal update_called
        update_called = True
        return [payload]

    monkeypatch.setattr(backend_main, "supabase_select", fake_select)
    monkeypatch.setattr(backend_main, "supabase_update", fake_update)

    result = await save_inferred_signal("tok", "user-1", "dietary", "vegan", "ai_recommendation", 0.5)
    assert result is None
    assert update_called is False


@pytest.mark.asyncio
async def test_save_inferred_signal_updates_an_existing_tentative_row(monkeypatch):
    import backend.main as backend_main

    async def fake_select(token, table, columns="*", filters=None, limit=50):
        return [{"id": "row-1", "provenance": "inferred_conversation"}]

    async def fake_update(token, table, filters, payload):
        assert filters == {"id": "row-1", "user_id": "user-1"}
        return [{**payload, "key": "coaching_style"}]

    monkeypatch.setattr(backend_main, "supabase_select", fake_select)
    monkeypatch.setattr(backend_main, "supabase_update", fake_update)

    result = await save_inferred_signal("tok", "user-1", "coaching_style", "structured", "inferred_conversation", 0.7)
    assert result["value"] == "structured"
    assert result["confidence"] == 0.7


# ---------------------------------------------------------------------------
# Regression: _format_wellness_context must never present a hypothesis as
# confirmed (the actual bug found and fixed this session).
# ---------------------------------------------------------------------------


def test_format_wellness_context_splits_facts_from_hypotheses():
    import backend.main as backend_main

    data = {
        "status": "has_active_goals",
        "goals": [{"title": "Improve energy", "goal_type": "energy", "current_value": 2, "target_value": 8, "unit": "/10"}],
        "preferences": [
            _pref("preferred_time", "mornings", "user_provided"),
            _pref("coaching_style", "gentle", "inferred_conversation", 0.6),
        ],
    }
    context = backend_main._format_wellness_context(data)

    assert "preferred_time: mornings" in context
    assert "coaching_style: gentle" in context

    # The fact must be in the "confirmed" block...
    confirmed_section = context.split("UNCONFIRMED")[0]
    assert "preferred_time: mornings" in confirmed_section
    assert "coaching_style: gentle" not in confirmed_section

    # ...and the hypothesis must be explicitly labeled unconfirmed, with its
    # confidence surfaced, never claimed as settled.
    assert "UNCONFIRMED" in context
    unconfirmed_section = context.split("UNCONFIRMED")[1]
    assert "coaching_style: gentle" in unconfirmed_section
    assert "0.6" in unconfirmed_section


def test_format_wellness_context_with_only_facts_has_no_unconfirmed_block():
    import backend.main as backend_main

    data = {
        "status": "goal_created",
        "goal": {"title": "Sleep better"},
        "goal_type": "sleep",
        "preferences": [_pref("preferred_time", "mornings", "user_provided")],
    }
    context = backend_main._format_wellness_context(data)
    assert "UNCONFIRMED" not in context
    assert "preferred_time: mornings" in context


def test_format_wellness_context_with_only_hypotheses_has_no_false_confirmed_claim():
    import backend.main as backend_main

    data = {
        "status": "has_active_goals",
        "goals": [{"title": "Sleep better", "goal_type": "sleep", "current_value": 0, "target_value": None, "unit": ""}],
        "preferences": [_pref("dietary", "possibly vegetarian", "ai_recommendation", 0.3)],
    }
    context = backend_main._format_wellness_context(data)
    assert "UNCONFIRMED" in context
    # Never claim these are confirmed when nothing confirmed exists.
    assert "confirmed, do not ask again" not in context.split("UNCONFIRMED")[0]
