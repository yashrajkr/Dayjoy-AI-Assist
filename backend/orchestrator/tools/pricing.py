"""
Structured pricing lookup — Phase 5.

Wraps the new `product_pricing` table (database/supabase_schema_v23_
product_pricing.sql) so exact figures (DP/MRP/BV/PV) come from a structured
lookup rather than RAG text search, per the brief's "prefer structured
database lookup over RAG for exact facts" requirement. `products` itself has
no price columns (confirmed during the architecture audit) — this table is
the new, minimal, separate catalog price list; `business_volume_ledger`
(v14) stays transactional/ledger-only and is untouched.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional


def _tokenize(text: str) -> set:
    return {t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) >= 3}


async def _best_matching_product(token: Optional[str], message: str) -> Optional[Dict[str, Any]]:
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    tokens = _tokenize(message)
    if not tokens:
        return None
    rows = await backend_main.supabase_select(
        token,
        "products",
        columns="id,product_name,category",
        filters={"approval_status": "approved"},
        limit=1000,
    )
    best_score = 0
    best_row: Optional[Dict[str, Any]] = None
    for row in rows:
        text = str(row.get("product_name", "")).lower()
        score = sum(1 for t in tokens if t in text)
        if score > best_score:
            best_score = score
            best_row = row
    return best_row if best_score > 0 else None


async def run(token: Optional[str], message: str) -> Dict[str, Any]:
    import backend.main as backend_main

    product = await _best_matching_product(token, message)
    if not product:
        return {"found": False}

    rows = await backend_main.supabase_select(
        token,
        "product_pricing",
        columns="sku,mrp,dp,bv,pv,currency,effective_date",
        filters={"product_id": product["id"], "is_active": True},
        limit=5,
    )
    if not rows:
        return {"found": False, "product_name": product.get("product_name")}

    rows.sort(key=lambda r: str(r.get("effective_date") or ""), reverse=True)
    top = rows[0]
    return {
        "found": True,
        "product_name": product.get("product_name"),
        "sku": top.get("sku"),
        "mrp": top.get("mrp"),
        "dp": top.get("dp"),
        "bv": top.get("bv"),
        "pv": top.get("pv"),
        "currency": top.get("currency"),
        "effective_date": top.get("effective_date"),
    }
