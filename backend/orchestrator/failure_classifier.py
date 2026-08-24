"""Failure Classification — Continuous Improvement System (Next-Generation
spec, Phase 14).

Deterministic, rule-based classification of WHY a specific answer likely
failed, from signals already persisted on `chat_messages` (verification_
status, rag_metadata, answer_source, confidence, sources — see database/
supabase_schema_v15_chat_messages_rag_columns.sql and v17_answer_routing.sql)
— no new LLM call, no new table. Feeds
admin_api.py's GET /admin/analytics/improvement-candidates, which
aggregates classified NEGATIVE-FEEDBACK messages (chat_messages.feedback
= 'down', an explicit human "this didn't help" signal) into a ranked
review queue.

Explicitly a REPORTING layer, not an acting one: per the brief's own
"DO NOT allow uncontrolled self-modification" rule, this never edits
prompts, knowledge, or routing — it only classifies and counts, for a
human to review and decide what (if anything) to change. There is no
code path from this module back into production behavior.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

CATEGORY_HALLUCINATION = "hallucination"
CATEGORY_WRONG_RETRIEVAL = "wrong_retrieval"
CATEGORY_WRONG_CITATION = "wrong_citation"
CATEGORY_POOR_STRUCTURE = "poor_answer_structure"
CATEGORY_TOOL_FAILURE = "tool_failure"
CATEGORY_AMBIGUITY = "ambiguity_failure"
CATEGORY_OUTDATED_KNOWLEDGE = "outdated_knowledge"
CATEGORY_UNCLASSIFIED = "unclassified"

ALL_CATEGORIES = (
    CATEGORY_HALLUCINATION, CATEGORY_WRONG_RETRIEVAL, CATEGORY_WRONG_CITATION,
    CATEGORY_POOR_STRUCTURE, CATEGORY_TOOL_FAILURE, CATEGORY_AMBIGUITY,
    CATEGORY_OUTDATED_KNOWLEDGE, CATEGORY_UNCLASSIFIED,
)


@dataclass
class FailureClassification:
    category: str
    reason: str


def classify_failure(message_row: Dict[str, Any]) -> FailureClassification:
    """`message_row` is one `chat_messages` row (an assistant message with
    feedback='down'). Rules are checked in order of how specific/confident
    the signal is — first match wins, matching format_intent.py/quality_
    router.py's established "ordered rule table, not a scored model"
    style elsewhere in this package."""
    answer_source: Optional[str] = message_row.get("answer_source")
    verification_status: Optional[str] = message_row.get("verification_status")
    confidence = message_row.get("confidence")
    content: str = message_row.get("content") or ""
    sources = message_row.get("sources") or []
    rag_metadata: Dict[str, Any] = message_row.get("rag_metadata") or {}
    handoff_required: bool = bool(message_row.get("handoff_required"))

    if handoff_required and rag_metadata.get("evidence_sufficient") is None:
        # Handed off with no evidence signal at all — the question likely
        # couldn't be resolved to a clear intent, not a knowledge gap.
        return FailureClassification(CATEGORY_AMBIGUITY, "handed off with no retrieval evidence — likely an ambiguous question")

    if rag_metadata.get("evidence_sufficient") is False:
        return FailureClassification(CATEGORY_WRONG_RETRIEVAL, "retrieval itself flagged evidence as insufficient for this query")

    if answer_source in ("dayjoy_knowledge", "hybrid") and verification_status == "unverified":
        return FailureClassification(CATEGORY_HALLUCINATION, "answered as Dayjoy knowledge but verification could not confirm grounding")

    if answer_source in ("dayjoy_knowledge", "hybrid") and confidence is not None and confidence < 0.5:
        return FailureClassification(CATEGORY_HALLUCINATION, f"low confidence ({confidence}) for a claimed Dayjoy-knowledge answer")

    if answer_source in ("dayjoy_knowledge", "hybrid") and not sources:
        return FailureClassification(CATEGORY_WRONG_CITATION, "claimed Dayjoy knowledge but no sources were attached")

    tool_errors = rag_metadata.get("tool_errors") or []
    if tool_errors:
        return FailureClassification(CATEGORY_TOOL_FAILURE, f"tool error(s) recorded: {tool_errors[:3]}")

    if rag_metadata.get("knowledge_conflict"):
        return FailureClassification(CATEGORY_OUTDATED_KNOWLEDGE, "multiple same-category documents matched — possible stale/conflicting knowledge")

    if len(content.strip()) < 40:
        return FailureClassification(CATEGORY_POOR_STRUCTURE, "answer is very short — likely incomplete or unhelpful")

    return FailureClassification(CATEGORY_UNCLASSIFIED, "no specific failure signal matched — needs manual review")
