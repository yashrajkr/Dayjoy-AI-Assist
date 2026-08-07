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

    for provider in providers:
        if not provider.is_configured():
            continue
        try:
            results = await provider.search(query, max_results)
        except Exception as e:
            print(f"[web_search] {provider.name} failed: {e}")
            continue
        if results:
            return results, provider.name, any_configured

    return [], None, any_configured
