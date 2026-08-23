"""
Product Recommendation Engine.

Built entirely on top of EXISTING, already-populated Supabase tables —
discovered live (not assumed) during an audit of the production database,
which is ahead of this repo's checked-in `database/*.sql` migrations:

  - `condition_recommendations` (118 rows) — condition -> product_id, sourced
    from `dayjoy_health_condition_recommendation_chart.csv` (the official
    Dayjoy Product Recommendation Chart). This IS the authoritative
    recommendation rule table; it is deliberately NOT duplicated here.
  - `products` — has who_can_use/contraindications/dosage/safety_note/
    verification_status/last_verified columns already, though sparsely
    filled today (audited: 181 approved products, only 2 have
    contraindications, 19 have who_can_use, 13 have safety_note, 112 have
    dosage). This module treats a missing field as "not documented" and
    NEVER fabricates a value for it — see _bundle_product().
  - `product_relationships` (555 rows) — product_id -> related_product_id,
    relationship_type in ("related", "cross_sell"). Mapped to
    alternative/complementary below; no third type exists in the live data,
    so this module does not invent a finer distinction than the data has.
  - `product_prices` — MRP/DP/BV/PV, already wired via tools/pricing.py;
    reused here via the same table, not re-implemented.

Matching is a lightweight token-overlap against `condition_recommendations
.condition` (free text, e.g. "An achy or heavy feeling in the legs") —
consistent with the token-overlap pattern already used elsewhere in this
codebase (backend/main.py's legacy retrieve_context, tools/pricing.py's
product matching) rather than introducing a new NLP dependency.

Audited fact: as of this audit, EVERY condition maps to exactly one
product (no condition has more than one candidate row) — so "ambiguous
recommendation" in practice is driven by the user's own query being too
vague to match a specific condition at all (multiple candidate conditions,
or none), not by the data offering competing products for one condition.
The ranking/clarification logic below still handles N>1 per condition
correctly in case that ever changes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Set

from .product_media import PRODUCT_IMAGES_EMBED, pick_primary_image

_TRUSTED_PRICE_STATUS_PREFIX = "verified"
_MIN_CONDITION_MATCH_SCORE = 1  # at least 1 overlapping non-stopword token — many real
# condition entries are a single word ("Anxiety", "Aging"), so requiring 2+ would make
# those categorically unmatchable. Over-matching is safety-netted by
# _MAX_MATCHED_CONDITIONS below (falls through to a clarifying question), not by
# raising this threshold.
_MAX_MATCHED_CONDITIONS = 3  # more than this and we ask for clarification instead of guessing


def _tokenize(text: str) -> Set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) >= 3}


_STOPWORDS = {
    "what", "which", "the", "for", "best", "product", "products", "should", "take",
    "recommend", "recommendation", "suggest", "good", "with", "and", "have", "has",
    "dayjoy", "can", "you", "me", "please", "help", "there", "any",
}


@dataclass
class MatchedCondition:
    condition: str
    product_id: str
    score: int


@dataclass
class RecommendationResult:
    status: str  # "ok" | "insufficient_evidence" | "needs_clarification"
    products: List[Dict[str, Any]] = field(default_factory=list)
    matched_conditions: List[str] = field(default_factory=list)
    clarifying_question: Optional[str] = None
    reason: Optional[str] = None


async def _match_conditions(token: Optional[str], message: str) -> List[MatchedCondition]:
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    tokens = _tokenize(message) - _STOPWORDS
    if not tokens:
        return []

    rows = await backend_main.supabase_select(
        token,
        "condition_recommendations",
        columns="condition,product_id,confidence,source_document",
        limit=1000,
    )

    scored: List[MatchedCondition] = []
    for row in rows:
        condition_text = str(row.get("condition") or "")
        condition_tokens = _tokenize(condition_text)
        score = len(tokens & condition_tokens)
        if score >= _MIN_CONDITION_MATCH_SCORE:
            scored.append(
                MatchedCondition(condition=condition_text, product_id=row["product_id"], score=score)
            )

    scored.sort(key=lambda m: m.score, reverse=True)
    return scored


def _is_currently_effective(row: Dict[str, Any], today: date) -> bool:
    effective_to = row.get("effective_to")
    if not effective_to:
        return True
    try:
        return date.fromisoformat(str(effective_to)) >= today
    except (ValueError, TypeError):
        return True


async def _fetch_price(token: Optional[str], product_id: str) -> Optional[Dict[str, Any]]:
    import backend.main as backend_main

    rows = await backend_main.supabase_select(
        token,
        "product_prices",
        columns="mrp,dp,bv,pv,currency,effective_from,effective_to,verification_status",
        filters={"product_id": product_id},
        limit=20,
    )
    today = date.today()
    trusted = [
        r
        for r in rows
        if str(r.get("verification_status") or "").startswith(_TRUSTED_PRICE_STATUS_PREFIX)
        and _is_currently_effective(r, today)
    ]
    if not trusted:
        return None
    trusted.sort(key=lambda r: str(r.get("effective_from") or ""), reverse=True)
    return trusted[0]


async def _fetch_relationships(token: Optional[str], product_id: str) -> Dict[str, List[str]]:
    import backend.main as backend_main

    rows = await backend_main.supabase_select(
        token,
        "product_relationships",
        columns="related_product_id,relationship_type",
        filters={"product_id": product_id},
        limit=50,
    )
    # "related" -> alternative (a different way to address the same goal);
    # "cross_sell" -> complementary (works alongside this product). These
    # are the only two relationship_type values that exist in the live
    # data — not inventing a finer taxonomy than what's actually there.
    alternatives = [r["related_product_id"] for r in rows if r.get("relationship_type") == "related"]
    complementary = [r["related_product_id"] for r in rows if r.get("relationship_type") == "cross_sell"]
    return {"alternative_product_ids": alternatives[:5], "complementary_product_ids": complementary[:5]}


def _bundle_product(
    product_row: Dict[str, Any],
    price_row: Optional[Dict[str, Any]],
    relationships: Dict[str, List[str]],
    matched_condition: str,
    source_document: Optional[str],
) -> Dict[str, Any]:
    """Assemble the response bundle for one recommended product. Every field
    is either a verbatim DB value or explicitly null/omitted — never a
    guessed or LLM-generated fact. Sparse fields (contraindications,
    who_can_use, safety_note — see module docstring on fill rates) are
    surfaced as None rather than papered over with an invented "not
    applicable"/"safe for everyone" claim."""
    bundle: Dict[str, Any] = {
        "product_id": product_row.get("product_id"),
        "product_name": product_row.get("product_name"),
        "category": product_row.get("category"),
        "matched_condition": matched_condition,
        "benefits": product_row.get("benefits"),
        "problem_tags": product_row.get("problem_tags"),
        "usage": product_row.get("usage"),
        "dosage": product_row.get("dosage"),
        "who_can_use": product_row.get("who_can_use"),
        "contraindications": product_row.get("contraindications"),
        "safety_note": product_row.get("safety_note"),
        "verification_status": product_row.get("verification_status"),
        "last_verified": product_row.get("last_verified"),
        "evidence_source": source_document or product_row.get("source_document"),
        "alternative_product_ids": relationships.get("alternative_product_ids", []),
        "complementary_product_ids": relationships.get("complementary_product_ids", []),
    }
    image = pick_primary_image(product_row.get("product_images"))
    bundle["image_url"] = image["image_url"] if image else None
    bundle["image_alt"] = image["alt_text"] if image else None
    if price_row:
        bundle["price"] = {
            "mrp": price_row.get("mrp"),
            "dp": price_row.get("dp"),
            "bv": price_row.get("bv"),
            "pv": price_row.get("pv"),
            "currency": price_row.get("currency"),
        }
    else:
        bundle["price"] = None
    return bundle


def _rank(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ranking per the requirement's priority order, applied as tie-breaks
    since (1) explicit user goal and (3) authoritative recommendation rule
    are already satisfied by construction (every candidate here came from a
    condition-chart match) — remaining signals differentiate WHEN a
    condition ever maps to more than one product:
      (5) safety constraints — a product with a documented contraindication
          ranks behind one with none documented (not proof of safety, just
          fewer known red flags) only as the very last tie-break, never as
          a hard filter (data is too sparse to exclude on absence).
      (7) confidence/evidence quality — verification_status == "approved"
          and a real evidence_source both count as stronger evidence than
          either being absent.
    """

    def score(c: Dict[str, Any]) -> tuple:
        verified = 1 if str(c.get("verification_status") or "").lower() == "approved" else 0
        has_evidence = 1 if c.get("evidence_source") else 0
        has_contraindication = 1 if c.get("contraindications") else 0
        return (verified, has_evidence, -has_contraindication)

    return sorted(candidates, key=score, reverse=True)


async def run(token: Optional[str], message: str, max_results: int = 3) -> Dict[str, Any]:
    """Main entry point. Returns a dict with `status` of:
      - "ok": `products` is a ranked, non-empty list.
      - "needs_clarification": the query matched too many distinct
        conditions to guess which one the user means; `clarifying_question`
        is set and no products are guessed.
      - "insufficient_evidence": no condition in the chart matched the
        query well enough to recommend anything — callers should fall back
        to RAG/general knowledge or say so, never invent a product.
    """
    import backend.main as backend_main  # lazy: see tools/__init__.py docstring

    matches = await _match_conditions(token, message)
    if not matches:
        return RecommendationResult(
            status="insufficient_evidence",
            reason="no_condition_matched_the_query",
        ).__dict__

    distinct_conditions = {m.condition for m in matches[:10]}
    if len(distinct_conditions) > _MAX_MATCHED_CONDITIONS:
        options = ", ".join(sorted(distinct_conditions)[:4])
        return RecommendationResult(
            status="needs_clarification",
            matched_conditions=sorted(distinct_conditions),
            clarifying_question=(
                f"I found a few different things that could match — could you tell me more "
                f"specifically what you're looking to address? For example: {options}."
            ),
        ).__dict__

    # De-dupe by product_id (a product can legitimately map to several
    # matched conditions), keeping the highest-scoring condition match.
    best_by_product: Dict[str, MatchedCondition] = {}
    for m in matches:
        existing = best_by_product.get(m.product_id)
        if not existing or m.score > existing.score:
            best_by_product[m.product_id] = m

    candidates: List[Dict[str, Any]] = []
    for product_id, matched in list(best_by_product.items())[: max_results * 2]:
        product_rows = await backend_main.supabase_select(
            token,
            "products",
            columns=(
                "id,product_id,product_name,category,benefits,problem_tags,usage,dosage,"
                "who_can_use,contraindications,safety_note,verification_status,"
                f"last_verified,source_document,approval_status,{PRODUCT_IMAGES_EMBED}"
            ),
            filters={"product_id": product_id, "approval_status": "approved"},
            limit=1,
        )
        if not product_rows:
            continue  # never recommend an unapproved/unknown product
        product_row = product_rows[0]
        price_row = await _fetch_price(token, product_id)
        relationships = await _fetch_relationships(token, product_id)
        candidates.append(
            _bundle_product(product_row, price_row, relationships, matched.condition, product_row.get("source_document"))
        )

    if not candidates:
        return RecommendationResult(
            status="insufficient_evidence",
            reason="matched_conditions_had_no_approved_product",
        ).__dict__

    ranked = _rank(candidates)[:max_results]
    return RecommendationResult(
        status="ok",
        products=ranked,
        matched_conditions=sorted({c["matched_condition"] for c in ranked}),
    ).__dict__
