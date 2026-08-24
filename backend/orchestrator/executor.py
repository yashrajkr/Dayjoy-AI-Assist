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
import logging
import time
from typing import Any, Dict, List

from backend.orchestrator.tools.registry import get_registry
from backend.orchestrator.types import ToolResult

# Tool Registry audit log (Next-Generation spec, Phase 3) — every tool
# invocation this executor makes is logged here (name, ok/fail, latency,
# whether it required auth), independent of whatever the caller does with
# the ToolResult. Deliberately a plain logger, not a new DB table/endpoint —
# this codebase's established pattern for non-critical operational logging
# (see backend.main's _llm_logger, _vision_logger) rather than introducing
# new persistence for something log aggregation already covers.
_audit_logger = logging.getLogger("dayjoy.tool_audit")


async def _run_one(tool_name: str, kwargs: Dict[str, Any]) -> ToolResult:
    registry = get_registry()
    spec = registry.get(tool_name)
    start = time.monotonic()
    try:
        data = await asyncio.wait_for(spec.handler(**kwargs), timeout=spec.timeout_seconds)
        latency_ms = (time.monotonic() - start) * 1000
        _audit_logger.info(
            "tool=%s ok=True requires_auth=%s latency_ms=%.1f", tool_name, spec.requires_auth, latency_ms
        )
        return ToolResult(tool_name=tool_name, ok=True, data=data, latency_ms=latency_ms)
    except asyncio.TimeoutError:
        latency_ms = (time.monotonic() - start) * 1000
        _audit_logger.warning(
            "tool=%s ok=False error=timeout requires_auth=%s latency_ms=%.1f", tool_name, spec.requires_auth, latency_ms
        )
        return ToolResult(tool_name=tool_name, ok=False, error="timeout", latency_ms=latency_ms, timed_out=True)
    except Exception as exc:
        latency_ms = (time.monotonic() - start) * 1000
        _audit_logger.warning(
            "tool=%s ok=False error=%s requires_auth=%s latency_ms=%.1f",
            tool_name, str(exc)[:120], spec.requires_auth, latency_ms,
        )
        return ToolResult(tool_name=tool_name, ok=False, error=str(exc)[:300], latency_ms=latency_ms)


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
