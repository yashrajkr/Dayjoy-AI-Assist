"""Continuous Improvement System (Next-Gen spec, Phase 14) —
orchestrator/failure_classifier.py's deterministic classification."""

from __future__ import annotations

from backend.orchestrator.failure_classifier import (
    CATEGORY_AMBIGUITY,
    CATEGORY_HALLUCINATION,
    CATEGORY_OUTDATED_KNOWLEDGE,
    CATEGORY_POOR_STRUCTURE,
    CATEGORY_TOOL_FAILURE,
    CATEGORY_UNCLASSIFIED,
    CATEGORY_WRONG_CITATION,
    CATEGORY_WRONG_RETRIEVAL,
    classify_failure,
)


def test_evidence_insufficient_classified_as_wrong_retrieval():
    row = {
        "content": "This is a full-length answer that isn't short at all.",
        "answer_source": "dayjoy_knowledge",
        "rag_metadata": {"evidence_sufficient": False},
    }
    result = classify_failure(row)
    assert result.category == CATEGORY_WRONG_RETRIEVAL


def test_unverified_dayjoy_answer_classified_as_hallucination():
    row = {
        "content": "This is a full-length answer that isn't short at all.",
        "answer_source": "dayjoy_knowledge",
        "verification_status": "unverified",
        "sources": [{"table": "products", "id": "1"}],
    }
    result = classify_failure(row)
    assert result.category == CATEGORY_HALLUCINATION


def test_low_confidence_dayjoy_answer_classified_as_hallucination():
    row = {
        "content": "This is a full-length answer that isn't short at all.",
        "answer_source": "hybrid",
        "confidence": 0.3,
        "sources": [{"table": "products", "id": "1"}],
    }
    result = classify_failure(row)
    assert result.category == CATEGORY_HALLUCINATION


def test_dayjoy_answer_with_no_sources_classified_as_wrong_citation():
    row = {
        "content": "This is a full-length answer that isn't short at all.",
        "answer_source": "dayjoy_knowledge",
        "confidence": 0.9,
        "verification_status": "verified",
        "sources": [],
    }
    result = classify_failure(row)
    assert result.category == CATEGORY_WRONG_CITATION


def test_tool_errors_classified_as_tool_failure():
    row = {
        "content": "This is a full-length answer that isn't short at all.",
        "answer_source": "general_llm",
        "rag_metadata": {"tool_errors": ["pricing_lookup: timeout"]},
    }
    result = classify_failure(row)
    assert result.category == CATEGORY_TOOL_FAILURE


def test_knowledge_conflict_classified_as_outdated_knowledge():
    row = {
        "content": "This is a full-length answer that isn't short at all.",
        "answer_source": "dayjoy_knowledge",
        "confidence": 0.9,
        "verification_status": "verified",
        "sources": [{"table": "products", "id": "1"}],
        "rag_metadata": {"knowledge_conflict": {"category": "policy"}},
    }
    result = classify_failure(row)
    assert result.category == CATEGORY_OUTDATED_KNOWLEDGE


def test_short_answer_classified_as_poor_structure():
    row = {"content": "Not sure.", "answer_source": "general_llm"}
    result = classify_failure(row)
    assert result.category == CATEGORY_POOR_STRUCTURE


def test_handoff_with_no_evidence_signal_classified_as_ambiguity():
    row = {
        "content": "This is a full-length answer that isn't short at all.",
        "answer_source": "dayjoy_knowledge",
        "handoff_required": True,
        "rag_metadata": {},
    }
    result = classify_failure(row)
    assert result.category == CATEGORY_AMBIGUITY


def test_no_matching_signal_classified_as_unclassified():
    row = {
        "content": "This is a full-length, well-formed answer with no failure signal at all present here.",
        "answer_source": "web_search",
        "confidence": 0.9,
    }
    result = classify_failure(row)
    assert result.category == CATEGORY_UNCLASSIFIED


def test_classification_never_raises_on_missing_fields():
    result = classify_failure({})
    assert result.category in (CATEGORY_UNCLASSIFIED, CATEGORY_POOR_STRUCTURE)
