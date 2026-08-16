"""Dayjoy knowledge-base tool — wraps `backend.main.retrieve_context`
(structured-table keyword search + RAG, already merged there) rather than
reimplementing retrieval."""

from __future__ import annotations

from typing import Any, Dict, Optional


async def run(token: Optional[str], message: str) -> Dict[str, Any]:
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    context, sources, category, rag_metadata = await backend_main.retrieve_context(token, message)
    return {
        "context": context,
        "sources": sources,
        "category": category,
        "rag_metadata": rag_metadata,
    }
