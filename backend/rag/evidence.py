"""
Evidence sufficiency check — decides whether retrieved (and ideally
reranked, see rag/rerank.py) evidence is strong enough to answer from, or
whether the caller should abstain / hand off to a human.

This extends the existing confidence-bucket + handoff_required logic
(Retriever._compute_confidence, backend/main.py's handoff_required
computation) rather than replacing it: it is a thin decision function over
the same chunk data, not a new subsystem.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

from backend.rag.vector_store import RetrievedChunk

# Matches the default RAG_HANDOFF_THRESHOLD used in backend/main.py and
# rag/retriever.py, so "insufficient evidence" here lines up with the
# existing handoff trigger instead of introducing a second, conflicting
# threshold.
DEFAULT_SUFFICIENCY_THRESHOLD = 0.40


@dataclass
class EvidenceVerdict:
    sufficient: bool
    top_score: float
    reason: str  # "ok" | "no_evidence_retrieved" | "top_evidence_below_sufficiency_threshold"


def verify_evidence(
    chunks: List[RetrievedChunk],
    sufficiency_threshold: float = DEFAULT_SUFFICIENCY_THRESHOLD,
) -> EvidenceVerdict:
    """Safe to call whether or not `chunks` has been reranked — uses
    `rerank_score` when present (rag/rerank.py sets it), otherwise falls
    back to the raw retrieval `.score`."""
    if not chunks:
        return EvidenceVerdict(sufficient=False, top_score=0.0, reason="no_evidence_retrieved")

    top = max((c.rerank_score if c.rerank_score is not None else c.score) for c in chunks)
    if top < sufficiency_threshold:
        return EvidenceVerdict(
            sufficient=False,
            top_score=top,
            reason="top_evidence_below_sufficiency_threshold",
        )
    return EvidenceVerdict(sufficient=True, top_score=top, reason="ok")
