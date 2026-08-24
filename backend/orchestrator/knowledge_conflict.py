"""Knowledge Conflict Resolution (Capability 9).

Detects when RAG retrieval matched two or more DIFFERENT documents in the
SAME category for one question — the concrete shape of "two DayJoy
sources conflict" the brief describes (old policy vs. new policy, two
product spec sheets, etc.). Built entirely from metadata
`rag/retriever.py`'s `_build_matched_documents()` already computes
(category, updated_at, score) — no new retrieval pass, no LLM call.

Deliberately narrow and honest about what it can and can't detect: this
flags a same-category multi-document match as a POTENTIAL conflict and
recommends preferring the more recently updated document — it does not
read document content to confirm the two documents actually disagree
(that would need an LLM call per pair, which this pass doesn't add). A
same-category match is common even without conflict (e.g. two policy docs
that happen to both mention refunds without disagreeing) — so this is
framed to the model as "these matched together, prefer the newer one and
mention it if relevant," never as an assertion that a contradiction was
proven.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ConflictInfo:
    category: str
    authoritative_document: str
    authoritative_updated_at: Optional[str]
    other_documents: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "category": self.category,
            "authoritative_document": self.authoritative_document,
            "authoritative_updated_at": self.authoritative_updated_at,
            "other_documents": self.other_documents,
        }


def detect_conflict(matched_documents: List[Dict[str, Any]]) -> Optional[ConflictInfo]:
    """Returns a ConflictInfo when 2+ matched documents share a category
    and have distinguishable updated_at timestamps (so "prefer the newer
    one" is actually a real, orderable decision) — else None."""
    if not matched_documents or len(matched_documents) < 2:
        return None

    by_category: Dict[str, List[Dict[str, Any]]] = {}
    for doc in matched_documents:
        category = doc.get("category")
        if not category or category == "other":
            continue
        by_category.setdefault(category, []).append(doc)

    for category, docs in by_category.items():
        if len(docs) < 2:
            continue
        dated = [d for d in docs if d.get("updated_at")]
        if len(dated) < 2:
            continue
        # Distinct timestamps only — two docs both "updated today" by a
        # bulk re-import isn't a meaningful recency signal to act on.
        distinct_dates = {d["updated_at"] for d in dated}
        if len(distinct_dates) < 2:
            continue
        dated.sort(key=lambda d: str(d["updated_at"]), reverse=True)
        newest = dated[0]
        others = [d.get("name") or d.get("id") for d in dated[1:]]
        return ConflictInfo(
            category=category,
            authoritative_document=newest.get("name") or newest.get("id") or "unknown",
            authoritative_updated_at=newest.get("updated_at"),
            other_documents=[o for o in others if o],
        )
    return None


def build_conflict_guidance(conflict: ConflictInfo) -> str:
    """Deterministic system-prompt addendum for when a conflict was
    detected — tells the model which document to treat as authoritative
    and to mention the update when it materially affects the answer,
    matching the brief's "inform the user when relevant" (not
    unconditionally, to avoid cluttering every answer with a disclosure
    that doesn't matter for that specific question)."""
    others = ", ".join(f'"{o}"' for o in conflict.other_documents)
    return (
        f"Note: more than one {conflict.category} document matched this question, with different "
        f'update dates. Treat "{conflict.authoritative_document}"'
        + (f" (updated {conflict.authoritative_updated_at})" if conflict.authoritative_updated_at else "")
        + f" as the current, authoritative source over {others}. If the older document's information "
        "would materially change the answer, briefly mention that the guidance was updated — otherwise "
        "just answer from the current version without dwelling on it."
    )
