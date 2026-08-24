"""
Web search provider abstraction.

Business logic (main.py) never talks to a specific search API directly —
it calls `web_search_multi()`, which tries each configured provider in
`get_search_providers()` in order until one returns results. Adding a new
provider (Bing, SerpAPI, Google Custom Search) means writing one class and
appending it to that list; nothing else changes.

Kept free of FastAPI/pydantic imports (plain dataclasses only) so main.py
can import this module without any risk of a circular import.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import List, Optional, Protocol, Tuple

import httpx


@dataclass
class WebSearchResult:
    title: str
    url: Optional[str]
    content: str


class SearchProvider(Protocol):
    name: str

    def is_configured(self) -> bool: ...

    async def search(self, query: str, max_results: int) -> List[WebSearchResult]: ...


class TavilyProvider:
    """Primary provider — LLM-oriented search API."""

    name = "tavily"

    def __init__(self) -> None:
        self.api_key = os.getenv("TAVILY_API_KEY", "").strip()

    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def search(self, query: str, max_results: int = 4) -> List[WebSearchResult]:
        if not self.api_key:
            return []
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": self.api_key,
                    "query": query,
                    "search_depth": "basic",
                    "max_results": max_results,
                    "include_answer": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        results: List[WebSearchResult] = []
        for r in data.get("results", [])[:max_results]:
            content = str(r.get("content") or "").strip()
            if not content:
                continue
            results.append(
                WebSearchResult(
                    title=r.get("title") or r.get("url") or "Web result",
                    url=r.get("url"),
                    content=content,
                )
            )
        return results


class BraveProvider:
    """Fallback provider — used when Tavily is unconfigured or fails."""

    name = "brave"

    def __init__(self) -> None:
        self.api_key = os.getenv("BRAVE_API_KEY", "").strip()

    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def search(self, query: str, max_results: int = 4) -> List[WebSearchResult]:
        if not self.api_key:
            return []
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                headers={"Accept": "application/json", "X-Subscription-Token": self.api_key},
                params={"q": query, "count": max_results},
            )
            resp.raise_for_status()
            data = resp.json()

        results: List[WebSearchResult] = []
        for r in (data.get("web", {}).get("results") or [])[:max_results]:
            content = str(r.get("description") or "").strip()
            if not content:
                continue
            results.append(
                WebSearchResult(
                    title=r.get("title") or r.get("url") or "Web result",
                    url=r.get("url"),
                    content=content,
                )
            )
        return results


# Live capability status, updated by real traffic rather than a separate
# billable probe call (Tavily/Brave have no free "check my quota" endpoint
# the way OpenAI's /v1/models list does) — see main.py's GET /capabilities,
# which reports this for the frontend. Auto-recovers the moment a real
# search succeeds again after a prior failure (e.g. a plan/quota limit
# being lifted) — no restart needed, same "no fake completion, no silent
# failure" spirit as the vision capability check.
_last_status: dict = {"provider": None, "available": None, "reason": None, "checked_at": 0.0}


def get_web_search_status() -> dict:
    return dict(_last_status)


def get_search_providers() -> List[SearchProvider]:
    """Ordered provider chain — primary first, fallback(s) after.

    To add a provider (Bing / SerpAPI / Google Custom Search): write a class
    matching `SearchProvider` and append an instance here. Everything else
    (routing, response labeling, tests) is provider-agnostic.
    """
    return [TavilyProvider(), BraveProvider()]


async def web_search_multi(
    query: str, max_results: int = 4
) -> Tuple[List[WebSearchResult], Optional[str], bool]:
    """Try each configured provider in order until one returns results.

    Returns (results, provider_name_used, any_provider_configured).
    `provider_name_used` is None if every provider failed or none are
    configured — callers use that to distinguish "web search unavailable"
    from "web search found nothing" and fall back to the LLM's own
    knowledge, labeling the answer accordingly. Never raises.
    """
    providers = get_search_providers()
    any_configured = any(p.is_configured() for p in providers)

    last_failure: Optional[Exception] = None
    last_failed_provider: Optional[str] = None
    for provider in providers:
        if not provider.is_configured():
            continue
        try:
            results = await provider.search(query, max_results)
        except Exception as e:
            print(f"[web_search] {provider.name} failed: {e}")
            last_failure, last_failed_provider = e, provider.name
            continue
        _last_status.update(
            provider=provider.name, available=True, reason=None, checked_at=time.time()
        )
        if results:
            return results, provider.name, any_configured

    if last_failure is not None:
        reason = "quota_exceeded" if "432" in str(last_failure) else "provider_error"
        _last_status.update(
            provider=last_failed_provider, available=False, reason=reason, checked_at=time.time()
        )
    elif not any_configured:
        _last_status.update(provider=None, available=False, reason="not_configured", checked_at=time.time())

    return [], None, any_configured
