"""Web search tool — wraps `backend.main.web_search` (Tavily/Brave provider
chain via backend.search_providers.web_search_multi)."""

from __future__ import annotations

from typing import Any, Dict


async def run(message: str, max_results: int = 4) -> Dict[str, Any]:
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    context, sources, provider = await backend_main.web_search(message, max_results)
    return {"context": context, "sources": sources, "provider": provider}
