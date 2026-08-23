"""AI Mode System — backend-side mode config.

Mirrors `src/app/lib/aiModes.ts` on the frontend. A "mode" here changes two
real things about a request, never just a label:
  1. `top_k` — how many chunks the RAG retriever pulls (ai_modes.py ->
     retrieve_context -> retriever.retrieve), so Deep Research/Compare
     Products genuinely see more source material, not just a relabeled
     Normal-mode answer.
  2. A system-prompt addendum layered onto the existing admin "custom
     guidance" path (`_system_prompt_for` in main.py), asking for a
     different shape of answer (deeper reasoning / structured synthesis /
     a comparison table). No chain-of-thought is ever requested or exposed.

This is intentionally separate from `RouteResult.mode` ("dayjoy"/"hybrid"),
which is an unrelated internal routing decision about whether web results
may be mixed with Dayjoy knowledge.
"""

from typing import Dict

VALID_AI_MODES = ("normal", "thinking", "deep_research", "compare_products")

AI_MODE_TOP_K: Dict[str, int] = {
    "normal": 5,
    "thinking": 5,
    "deep_research": 10,
    "compare_products": 10,
}

AI_MODE_ADDENDA: Dict[str, str] = {
    "normal": "",
    "thinking": (
        "\n\nTHINKING MODE: this question calls for more deliberate reasoning than a quick "
        "lookup. Work through the relevant factors carefully before answering, and give a "
        "more thorough, structured answer than you would for a simple factual question — "
        "but still output ONLY your final answer. Never narrate your reasoning process or "
        "show intermediate steps/chain-of-thought; the user sees only the finished answer."
    ),
    "deep_research": (
        "\n\nDEEP RESEARCH MODE: synthesize across ALL the retrieved context below, not just "
        "the single best-matching chunk. Produce a structured, sectioned answer (use short "
        "headings or a list where it helps) that draws together every relevant point in the "
        "context. If the context clearly doesn't cover part of the question, say so rather "
        "than filling the gap with unsupported claims. Do not claim to have done live web "
        "research unless \"[web]\"-labeled context is actually present below."
    ),
    "compare_products": (
        "\n\nCOMPARE PRODUCTS MODE: the user wants a structured comparison. Identify the "
        "specific product(s) named or implied in the question, using ONLY the retrieved "
        "product context below — never invent specs, ingredients, or pricing for a product "
        "that isn't in the context. If fewer than two comparable products are present in the "
        "context, say so plainly instead of fabricating a comparison. When you do have "
        "enough material, present it as a markdown table with columns: Product | Key "
        "Features | Benefits | Suitable For | Important Differences, followed by a short "
        "recommendation only if the context supports one."
    ),
}


def normalize_ai_mode(ai_mode: str) -> str:
    """Fall back to 'normal' for any value the client sends that isn't recognized,
    rather than erroring — keeps older/mismatched clients working."""
    return ai_mode if ai_mode in VALID_AI_MODES else "normal"


def top_k_for(ai_mode: str) -> int:
    return AI_MODE_TOP_K[normalize_ai_mode(ai_mode)]


def addendum_for(ai_mode: str) -> str:
    return AI_MODE_ADDENDA[normalize_ai_mode(ai_mode)]
