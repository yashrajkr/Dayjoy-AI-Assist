"""
AI Orchestrator layer for Dayjoy AI Assist.

Phase 1 (current): intent classification + a thin tool registry that wraps
EXISTING retrieval/search functions in `backend/main.py`, `backend/rag/`, and
`backend/search_providers.py`. Nothing here reimplements retrieval, RAG,
embeddings, or auth — see backend/orchestrator/tools/ for the wrappers.

Gated end-to-end by the `ORCHESTRATOR_ENABLED` env flag (see backend/main.py)
so the legacy `_route_events` router remains the sole source of truth for
actual routing decisions until a later phase.
"""
