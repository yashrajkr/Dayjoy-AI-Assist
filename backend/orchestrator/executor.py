"""
Parallel tool execution — Phase 4.

Runs planner-selected tools concurrently via `asyncio.gather`, each guarded
by its own `ToolSpec.timeout_seconds` via `asyncio.wait_for`. A tool that
times out or raises becomes a failed `ToolResult` and is dropped from the
evidence set — the request degrades gracefully rather than failing outright,
matching this codebase's existing philosophy (see `web_search()`'s
never-raises contract, `stream_response()`'s rule-based fallback).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List

from backend.orchestrator.tools.registry import get_registry
from backend.orchestrator.types import ToolResult


async def _run_one(tool_name: str, kwargs: Dict[str, Any]) -> ToolResult:
    registry = get_registry()
    spec = registry.get(tool_name)
    start = time.monotonic()
    try:
        data = await asyncio.wait_for(spec.handler(**kwargs), timeout=spec.timeout_seconds)
        return ToolResult(
            tool_name=tool_name,
            ok=True,
            data=data,
            latency_ms=(time.monotonic() - start) * 1000,
        )
    except asyncio.TimeoutError:
        return ToolResult(
            tool_name=tool_name,
            ok=False,
            error="timeout",
            latency_ms=(time.monotonic() - start) * 1000,
            timed_out=True,
        )
    except Exception as exc:
        return ToolResult(
            tool_name=tool_name,
            ok=False,
            error=str(exc)[:300],
            latency_ms=(time.monotonic() - start) * 1000,
        )


async def run_tools(tool_calls: List[Dict[str, Any]]) -> List[ToolResult]:
    """`tool_calls` is a list of `{"name": str, "kwargs": dict}`. All run
    concurrently; each is independently timed out / degraded — one tool's
    failure never blocks or fails the others."""
    if not tool_calls:
        return []
    results = await asyncio.gather(
        *[_run_one(call["name"], call.get("kwargs", {})) for call in tool_calls]
    )
    return list(results)
