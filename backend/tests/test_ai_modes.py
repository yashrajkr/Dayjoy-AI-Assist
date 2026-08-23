"""Tests for backend/ai_modes.py — the AI Mode System's backend-side config.
No existing test file covered this module before; added while wiring in the
two new modes (Create/Analyze) so all six modes have real coverage."""

from __future__ import annotations

import pytest

from backend import ai_modes


def test_all_six_modes_are_valid():
    assert ai_modes.VALID_AI_MODES == (
        "normal",
        "thinking",
        "deep_research",
        "compare_products",
        "create",
        "analyze",
    )


@pytest.mark.parametrize("mode", ai_modes.VALID_AI_MODES)
def test_every_valid_mode_has_a_top_k(mode):
    assert isinstance(ai_modes.top_k_for(mode), int)
    assert ai_modes.top_k_for(mode) > 0


def test_normal_mode_has_no_addendum():
    assert ai_modes.addendum_for("normal") == ""


@pytest.mark.parametrize("mode", ["thinking", "deep_research", "compare_products", "create", "analyze"])
def test_non_normal_modes_have_a_real_addendum(mode):
    addendum = ai_modes.addendum_for(mode)
    assert addendum.strip() != ""
    assert mode.upper().replace("_", " ") in addendum or "MODE:" in addendum


def test_unknown_mode_falls_back_to_normal():
    assert ai_modes.normalize_ai_mode("not_a_real_mode") == "normal"
    assert ai_modes.top_k_for("not_a_real_mode") == ai_modes.AI_MODE_TOP_K["normal"]
    assert ai_modes.addendum_for("not_a_real_mode") == ""


def test_create_mode_asks_for_finished_content_not_explanation():
    addendum = ai_modes.addendum_for("create")
    assert "finished" in addendum.lower()


def test_analyze_mode_asks_for_findings_and_evidence():
    addendum = ai_modes.addendum_for("analyze")
    assert "Findings" in addendum
    assert "Evidence" in addendum
