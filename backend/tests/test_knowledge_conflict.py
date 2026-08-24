"""Knowledge Conflict Resolution (Capability 9) —
orchestrator/knowledge_conflict.py's detect_conflict() and
build_conflict_guidance(), plus backend/main.py's
_conflict_guidance_from_rag_metadata() wiring.
"""

from __future__ import annotations

from backend.orchestrator.knowledge_conflict import ConflictInfo, build_conflict_guidance, detect_conflict


def _doc(id_, name, category, updated_at, score=0.8):
    return {"id": id_, "name": name, "category": category, "updated_at": updated_at, "score": score}


def test_no_conflict_with_fewer_than_two_documents():
    assert detect_conflict([_doc("1", "a", "policy", "2026-01-01")]) is None


def test_no_conflict_across_different_categories():
    docs = [_doc("1", "policy.txt", "policy", "2026-01-01"), _doc("2", "faq.txt", "faq", "2026-02-01")]
    assert detect_conflict(docs) is None


def test_no_conflict_when_same_category_but_no_dates():
    docs = [_doc("1", "a.txt", "policy", None), _doc("2", "b.txt", "policy", None)]
    assert detect_conflict(docs) is None


def test_no_conflict_when_dates_identical():
    docs = [_doc("1", "a.txt", "policy", "2026-01-01"), _doc("2", "b.txt", "policy", "2026-01-01")]
    assert detect_conflict(docs) is None


def test_conflict_detected_for_same_category_different_dates():
    docs = [
        _doc("1", "old_refund_policy.txt", "policy", "2025-01-01"),
        _doc("2", "new_refund_policy.txt", "policy", "2026-01-01"),
    ]
    conflict = detect_conflict(docs)
    assert conflict is not None
    assert conflict.authoritative_document == "new_refund_policy.txt"
    assert conflict.authoritative_updated_at == "2026-01-01"
    assert "old_refund_policy.txt" in conflict.other_documents


def test_conflict_ignores_other_category():
    docs = [_doc("1", "a.txt", "other", "2025-01-01"), _doc("2", "b.txt", "other", "2026-01-01")]
    assert detect_conflict(docs) is None


def test_conflict_guidance_names_authoritative_document():
    conflict = ConflictInfo(
        category="policy", authoritative_document="new_refund_policy.txt",
        authoritative_updated_at="2026-01-01", other_documents=["old_refund_policy.txt"],
    )
    guidance = build_conflict_guidance(conflict)
    assert "new_refund_policy.txt" in guidance
    assert "old_refund_policy.txt" in guidance
    assert "2026-01-01" in guidance


def test_conflict_guidance_from_rag_metadata_helper():
    from backend import main as backend_main

    rag_metadata = {
        "knowledge_conflict": {
            "category": "policy",
            "authoritative_document": "new.txt",
            "authoritative_updated_at": "2026-01-01",
            "other_documents": ["old.txt"],
        }
    }
    guidance = backend_main._conflict_guidance_from_rag_metadata(rag_metadata)
    assert "new.txt" in guidance
    assert "old.txt" in guidance


def test_conflict_guidance_from_rag_metadata_empty_when_no_conflict():
    from backend import main as backend_main

    assert backend_main._conflict_guidance_from_rag_metadata(None) == ""
    assert backend_main._conflict_guidance_from_rag_metadata({}) == ""
