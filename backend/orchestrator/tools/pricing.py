"""
Structured pricing lookup.

IMPORTANT: `product_prices` already exists in the live Supabase project
(migration `v23_dayjoy_kb_pricing`, applied 2026-08-09 — not present in this
repo's `database/*.sql` files, i.e. the checked-in migrations are missing
one that's actually live in production) with 170 real rows: product_id
(text — matches `products.product_id`, NOT `products.id`), mrp, dp, bv, pv,
currency, effective_from, effective_to, source_document, verification_status.

An earlier pass of this work assumed no structured pricing table existed
and added a NEW `product_pricing` table — that migration has been discarded
(never applied) once this was discovered, per this project's explicit
"don't create duplicate Supabase tables" rule. This module was rewritten to
use the real, already-populated `product_prices` table instead.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, Optional

# Rows whose verification_status doesn't start with "verified" are treated
# as untrustworthy for a structured lookup — mirrors the same defensive
# pattern main.py's SEARCH_TABLES uses for compensation_rules (excluding
# the disputed sentinel row from ever surfacing as a verified fact).
_TRUSTED_STATUS_PREFIX = "verified"


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
        columns="product_id,product_name,category",
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


def _is_currently_effective(row: Dict[str, Any], today: date) -> bool:
    effective_to = row.get("effective_to")
    if not effective_to:
        return True
    try:
        return date.fromisoformat(str(effective_to)) >= today
    except (ValueError, TypeError):
        return True  # malformed date — don't silently exclude, let it surface


async def run(token: Optional[str], message: str) -> Dict[str, Any]:
    import backend.main as backend_main

    product = await _best_matching_product(token, message)
    product_id = product.get("product_id") if product else None
    if not product or not product_id:
        return {"found": False}

    rows = await backend_main.supabase_select(
        token,
        "product_prices",
        columns="product_id,mrp,dp,bv,pv,currency,effective_from,effective_to,verification_status",
        filters={"product_id": product_id},
        limit=20,
    )

    today = date.today()
    trusted = [
        r
        for r in rows
        if str(r.get("verification_status") or "").startswith(_TRUSTED_STATUS_PREFIX)
        and _is_currently_effective(r, today)
    ]
    if not trusted:
        return {"found": False, "product_name": product.get("product_name")}

    trusted.sort(key=lambda r: str(r.get("effective_from") or ""), reverse=True)
    top = trusted[0]
    return {
        "found": True,
        "product_name": product.get("product_name"),
        "product_id": product_id,
        "mrp": top.get("mrp"),
        "dp": top.get("dp"),
        "bv": top.get("bv"),
        "pv": top.get("pv"),
        "currency": top.get("currency"),
        "effective_from": top.get("effective_from"),
    }
