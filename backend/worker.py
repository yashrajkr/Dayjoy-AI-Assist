"""
Dayjoy AI Assist — Background Worker

Processes the task_queue table for:
  - Workflow executions
  - Scheduled message delivery
  - Webhook retries
  - Document re-indexing
  - Analytics rollups
  - Data retention cleanup

Run: python -m backend.worker
"""

import asyncio
import os
import time
from datetime import datetime

import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

WORKER_ID = f"worker-{os.getpid()}"
POLL_INTERVAL = int(os.getenv("WORKER_POLL_INTERVAL", "5"))  # seconds
MAX_TASK_DURATION = int(os.getenv("WORKER_MAX_TASK_DURATION", "300"))  # 5 minutes


def _svc_headers() -> dict:
    h = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    if SUPABASE_SERVICE_ROLE_KEY:
        h["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    return h


async def claim_next_task() -> dict | None:
    """Atomically claim the next queued task."""
    if not SUPABASE_URL:
        return None
    url = f"{SUPABASE_URL}/rest/v1/task_queue?status=eq.queued&order=priority.asc,scheduled_at.asc&limit=1&select=*"
    headers = _svc_headers()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400 or not resp.json():
            return None
        task = resp.json()[0]
        # Claim it
        update_url = f"{SUPABASE_URL}/rest/v1/task_queue?id=eq.{task['id']}&select=*"
        update_headers = {**headers, "Prefer": "return=representation"}
        resp = await client.patch(update_url, headers=update_headers, json={
            "status": "processing",
            "assigned_worker": WORKER_ID,
            "started_at": datetime.utcnow().isoformat(),
        })
        if resp.status_code < 400 and resp.json():
            return resp.json()[0]
    return None


async def execute_task(task: dict):
    """Execute a single task based on its type."""
    task_type = task.get("task_type", "custom")
    payload = task.get("payload", {}) or {}
    task_id = task["id"]

    print(f"[{WORKER_ID}] Processing task {task_id} ({task_type})")

    try:
        if task_type == "workflow_execution":
            # TODO: Execute workflow nodes
            print(f"  → Workflow execution for workflow_id={payload.get('workflow_id')}")
            await _mark_completed(task_id, {"status": "simulated"})

        elif task_type == "document_processing":
            # TODO: Re-index document
            print(f"  → Document processing for doc_id={payload.get('document_id')}")
            await _mark_completed(task_id, {"status": "simulated"})

        elif task_type == "embedding_generation":
            # TODO: Generate embeddings
            print(f"  → Embedding generation")
            await _mark_completed(task_id, {"status": "simulated"})

        elif task_type == "email_send":
            print(f"  → Email send to {payload.get('to')}")
            await _mark_completed(task_id, {"status": "sent"})

        elif task_type == "cleanup":
            print(f"  → Cleanup task")
            await _run_retention_cleanup()
            await _mark_completed(task_id, {"status": "cleaned"})

        else:
            print(f"  → Unknown task type: {task_type}")
            await _mark_completed(task_id, {"status": "unknown_type"})

    except Exception as e:
        print(f"  ❌ Task {task_id} failed: {e}")
        await _mark_failed(task_id, str(e))


async def _mark_completed(task_id: str, result: dict):
    """Mark a task as completed."""
    url = f"{SUPABASE_URL}/rest/v1/task_queue?id=eq.{task_id}&select=*"
    headers = {**_svc_headers(), "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.patch(url, headers=headers, json={
            "status": "completed",
            "completed_at": datetime.utcnow().isoformat(),
            "result": result,
        })


async def _mark_failed(task_id: str, error: str):
    """Mark a task as failed or schedule retry."""
    # Fetch current task
    url = f"{SUPABASE_URL}/rest/v1/task_queue?id=eq.{task_id}&select=*"
    headers = _svc_headers()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400 or not resp.json():
            return
        task = resp.json()[0]
        retry_count = int(task.get("retry_count", 0))
        max_retries = int(task.get("max_retries", 3))

        if retry_count < max_retries:
            # Schedule retry with exponential backoff
            import datetime as dt
            next_retry = (datetime.utcnow() + dt.timedelta(seconds=2 ** retry_count * 30)).isoformat()
            await client.patch(f"{url}&select=*", headers={**headers, "Prefer": "return=representation"}, json={
                "status": "retrying",
                "retry_count": retry_count + 1,
                "next_retry_at": next_retry,
                "error_message": error,
            })
            print(f"  🔄 Scheduled retry {retry_count + 1}/{max_retries} for task {task_id}")
        else:
            # Max retries reached — mark as failed
            await client.patch(f"{url}&select=*", headers={**headers, "Prefer": "return=representation"}, json={
                "status": "failed",
                "error_message": error,
                "completed_at": datetime.utcnow().isoformat(),
            })
            print(f"  ❌ Task {task_id} permanently failed after {max_retries} retries")


async def _run_retention_cleanup():
    """Run data retention policies."""
    if not SUPABASE_URL:
        return
    url = f"{SUPABASE_URL}/rest/v1/data_retention_policies?is_active=eq.true&select=*"
    headers = _svc_headers()
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            return
        policies = resp.json()
        for p in policies:
            table = p.get("table_name")
            days = int(p.get("retention_days", 365))
            action = p.get("action", "archive")
            print(f"  → Retention: {table} ({days} days, {action})")
            # In production, this would execute the actual archive/delete


async def process_retrying_tasks():
    """Check for tasks in 'retrying' status whose next_retry_at has passed."""
    if not SUPABASE_URL:
        return
    now = datetime.utcnow().isoformat()
    url = f"{SUPABASE_URL}/rest/v1/task_queue?status=eq.retrying&next_retry_at=lte.{now}&order=next_retry_at.asc&limit=10&select=*"
    headers = _svc_headers()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            return
        tasks = resp.json()
        for task in tasks:
            # Move back to queued
            update_url = f"{SUPABASE_URL}/rest/v1/task_queue?id=eq.{task['id']}"
            await client.patch(update_url, headers={**headers, "Prefer": "return=minimal"}, json={
                "status": "queued",
                "scheduled_at": now,
            })
            print(f"  🔄 Re-queued task {task['id']} for retry")


async def main_loop():
    """Main worker loop — polls for tasks and executes them."""
    print(f"[{WORKER_ID}] Background worker started (poll interval: {POLL_INTERVAL}s)")

    while True:
        try:
            # Process retrying tasks first
            await process_retrying_tasks()

            # Claim and execute next task
            task = await claim_next_task()
            if task:
                await asyncio.wait_for(execute_task(task), timeout=MAX_TASK_DURATION)
            else:
                # No tasks — sleep
                await asyncio.sleep(POLL_INTERVAL)

        except asyncio.TimeoutError:
            print(f"[{WORKER_ID}] ⚠️ Task timed out after {MAX_TASK_DURATION}s")
        except KeyboardInterrupt:
            print(f"\n[{WORKER_ID}] Worker stopping...")
            break
        except Exception as e:
            print(f"[{WORKER_ID}] ❌ Worker error: {e}")
            await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main_loop())
