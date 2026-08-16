"""Thin re-export — reranking logic lives in backend.rag.rerank (RAG-layer
concern, operates on RetrievedChunk) so backend/rag/retriever.py can use it
without depending on the orchestrator package above it. This module exists
so orchestrator consumers have a stable `backend.orchestrator.rerank` import
path per the package layout, without a second implementation."""

from __future__ import annotations

from backend.rag.rerank import rerank_chunks  # noqa: F401
