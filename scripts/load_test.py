#!/usr/bin/env python3
"""
Dayjoy AI Assist — API Load Test Script

Usage: python scripts/load_test.py --base-url http://localhost:8000 --duration 60 --concurrency 10
"""
import argparse, asyncio, time, sys
from collections import defaultdict
try:
    import httpx
except ImportError:
    print("Install httpx: pip install httpx"); sys.exit(1)

async def test_endpoint(client, url, method="GET", json=None, headers=None):
    start = time.time()
    try:
        if method == "GET":
            resp = await client.get(url, headers=headers, timeout=30.0)
        else:
            resp = await client.post(url, json=json, headers=headers, timeout=30.0)
        return resp.status_code, (time.time() - start) * 1000
    except:
        return 0, (time.time() - start) * 1000

async def run_load_test(base_url, duration, concurrency, token=None):
    print(f"\n{'='*60}\nLoad Test: {base_url}\nDuration: {duration}s | Concurrency: {concurrency}\n{'='*60}\n")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    results = defaultdict(lambda: {"count": 0, "errors": 0, "total_ms": 0, "min_ms": float("inf"), "max_ms": 0})
    endpoints = [("GET", f"{base_url}/health", "Health"), ("GET", f"{base_url}/", "Root")]

    async with httpx.AsyncClient() as client:
        end_time = time.time() + duration
        async def worker():
            while time.time() < end_time:
                for method, url, name in endpoints:
                    status, elapsed = await test_endpoint(client, url, method, headers=headers)
                    r = results[name]; r["count"] += 1; r["total_ms"] += elapsed
                    r["min_ms"] = min(r["min_ms"], elapsed); r["max_ms"] = max(r["max_ms"], elapsed)
                    if status >= 400 or status == 0: r["errors"] += 1
        await asyncio.gather(*[asyncio.create_task(worker()) for _ in range(concurrency)])

    print(f"\n{'='*60}\nRESULTS\n{'='*60}")
    for name, r in results.items():
        avg = r["total_ms"] / r["count"] if r["count"] > 0 else 0
        print(f"\n{name}: Requests={r['count']} Errors={r['errors']} Avg={avg:.1f}ms Min={r['min_ms']:.1f}ms Max={r['max_ms']:.1f}ms")
    print(f"\nTotal: {sum(r['count'] for r in results.values())} requests, {sum(r['count'] for r in results.values())/duration:.1f} req/s\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--duration", type=int, default=60)
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--token", default=None)
    asyncio.run(run_load_test(**vars(parser.parse_args())))
