"""Tool Registry audit logging (Next-Generation spec, Phase 3) —
executor.py's `_run_one` now logs every tool invocation (success, timeout,
error) via the `dayjoy.tool_audit` logger, independent of the ToolResult
the caller receives.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.orchestrator.executor import run_tools
from backend.orchestrator.tools.registry import ToolSpec, get_registry


@pytest.fixture
def _temp_tool():
    """Registers a throwaway tool for the duration of one test, so this
    doesn't depend on / interfere with the real registered tools."""
    registry = get_registry()

    def _register(name: str, handler, timeout_seconds: float = 1.0, requires_auth: bool = False):
        registry.register(ToolSpec(name=name, description="test", timeout_seconds=timeout_seconds,
                                    requires_auth=requires_auth, handler=handler))
        return name

    yield _register
    # Best-effort cleanup — registry has no unregister(), but re-registering
    # the same name in another test overwrites it, so this is harmless.


@pytest.mark.asyncio
async def test_successful_tool_call_is_logged(_temp_tool, caplog):
    async def handler(**kwargs):
        return {"ok": True}

    name = _temp_tool("audit_test_success", handler)
    with caplog.at_level("INFO", logger="dayjoy.tool_audit"):
        results = await run_tools([{"name": name, "kwargs": {}}])
    assert results[0].ok is True
    assert any(f"tool={name}" in r.message and "ok=True" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_timed_out_tool_call_is_logged(_temp_tool, caplog):
    async def handler(**kwargs):
        await asyncio.sleep(10)

    name = _temp_tool("audit_test_timeout", handler, timeout_seconds=0.05)
    with caplog.at_level("WARNING", logger="dayjoy.tool_audit"):
        results = await run_tools([{"name": name, "kwargs": {}}])
    assert results[0].ok is False
    assert results[0].timed_out is True
    assert any(f"tool={name}" in r.message and "timeout" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_erroring_tool_call_is_logged(_temp_tool, caplog):
    async def handler(**kwargs):
        raise RuntimeError("boom")

    name = _temp_tool("audit_test_error", handler)
    with caplog.at_level("WARNING", logger="dayjoy.tool_audit"):
        results = await run_tools([{"name": name, "kwargs": {}}])
    assert results[0].ok is False
    assert "boom" in results[0].error
    assert any(f"tool={name}" in r.message and "ok=False" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_requires_auth_flag_is_included_in_log(_temp_tool, caplog):
    async def handler(**kwargs):
        return {}

    name = _temp_tool("audit_test_auth", handler, requires_auth=True)
    with caplog.at_level("INFO", logger="dayjoy.tool_audit"):
        await run_tools([{"name": name, "kwargs": {}}])
    assert any(f"tool={name}" in r.message and "requires_auth=True" in r.message for r in caplog.records)
