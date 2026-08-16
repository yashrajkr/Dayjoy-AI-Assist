"""
Contextual follow-up suggestions — Phase 4.

Generated from the actual answer route/category and what the user's own
message already covered — not a generic "anything else?" template.
Deterministic/rule-based (no extra LLM call), matching this phase's
low-latency, no-new-network-dependency approach.
"""

from __future__ import annotations

from typing import Any, Dict, List


def generate_followups(
    answer_source: str,
    category: str,
    message: str,
    max_suggestions: int = 4,
) -> List[str]:
    if answer_source in ("casual", "unsafe"):
        return []

    lowered = message.lower()
    suggestions: List[str] = []

    if category == "product" or answer_source in ("dayjoy_knowledge", "hybrid"):
        if not any(k in lowered for k in ("price", "dp", "mrp")):
            suggestions.append("What is the DP and MRP of this product?")
        if not any(k in lowered for k in ("bv", "pv")):
            suggestions.append("What is its BV/PV?")
        if "ingredient" not in lowered:
            suggestions.append("What are its ingredients?")
        if not any(k in lowered for k in ("compare", " vs", "versus")):
            suggestions.append("Compare it with a similar Dayjoy product.")
    elif category == "compensation":
        suggestions.append("What rank do I need for this?")
        suggestions.append("How is this commission calculated?")
    elif answer_source == "web_search":
        suggestions.append("Is there a Dayjoy product related to this?")
    elif answer_source == "general_llm":
        suggestions.append("Would you like Dayjoy-specific information on this instead?")

    return suggestions[:max_suggestions]


def generate_recommendation_followups(
    recommendation_result: Dict[str, Any],
    message: str,
    max_suggestions: int = 4,
) -> List[str]:
    """Follow-ups tailored to what a product_recommendation tool result
    actually contains — only offers what's genuinely available (e.g. never
    suggests "want alternatives?" when none were found)."""
    if recommendation_result.get("status") != "ok":
        return []

    products = recommendation_result.get("products") or []
    if not products:
        return []

    lowered = message.lower()
    suggestions: List[str] = []
    top = products[0]

    if top.get("price") and not any(k in lowered for k in ("price", "dp", "mrp", "bv", "pv")):
        suggestions.append("Do you want the current price and BV/PV?")
    if len(products) > 1 and not any(k in lowered for k in ("compare", " vs", "versus")):
        suggestions.append("Would you like me to compare these options?")
    if top.get("alternative_product_ids") and "alternative" not in lowered:
        suggestions.append("Would you like alternatives?")
    if top.get("complementary_product_ids"):
        suggestions.append("Would you like to know what pairs well with this?")
    if not suggestions:
        suggestions.append("Do you want the official product details?")

    return suggestions[:max_suggestions]
