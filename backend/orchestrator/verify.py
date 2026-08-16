"""Thin re-export — evidence-verification logic lives in backend.rag.evidence
(RAG-layer concern, feeds Retriever.retrieve()'s RetrievalResult) so
backend/rag/retriever.py can use it without depending on the orchestrator
package above it. See backend/orchestrator/rerank.py for the same pattern."""

from __future__ import annotations

from backend.rag.evidence import (  # noqa: F401
    DEFAULT_SUFFICIENCY_THRESHOLD,
    EvidenceVerdict,
    verify_evidence,
)
