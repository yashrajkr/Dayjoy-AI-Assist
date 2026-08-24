"""Golden Answer Evaluation (Capability 43) —
orchestrator/answer_eval.py's rubric scorer + the expert-reviewed
golden_answer_eval.json fixture.

Deterministic by design (see answer_eval.py's module docstring for why):
these tests run against synthetic sample answers, not a live model, so
they verify the SCORER is correct — a good answer scores well, a bad one
(missing facts, containing a prohibited claim, no structure when it
should have one) scores poorly. Complements, doesn't replace, the
existing live-grading scripts for qualitative judgment a deterministic
check can't make.
"""

from __future__ import annotations

from pathlib import Path

from backend.orchestrator.answer_eval import GoldenCase, load_golden_cases, score_against_rubric

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "golden_answer_eval.json"


def test_fixture_loads_and_has_minimum_coverage():
    cases = load_golden_cases(str(FIXTURE_PATH))
    assert 100 <= len(cases) <= 300
    categories = {c.category for c in cases}
    assert {"pricing", "policy", "recommendation", "business_strategy"}.issubset(categories)


def test_fixture_covers_all_required_question_types():
    """Locks in the dataset's required breadth: products, policies,
    training, distributors, customers, ambiguous questions, Hinglish,
    follow-ups, uploaded-document questions, and unsupported questions."""
    cases = load_golden_cases(str(FIXTURE_PATH))
    categories = {c.category for c in cases}
    required_families = {
        "products": {"products", "pricing", "safety"},
        "policies": {"policy"},
        "training": {"training"},
        "distributors": {"onboarding", "compensation", "business_strategy", "action_plan"},
        "customers": {"customer_support", "company_info"},
        "ambiguous": {"ambiguous"},
        "hinglish": {"hinglish"},
        "follow_up": {"follow_up"},
        "uploaded_document": {"uploaded_document"},
        "unsupported": {"unsupported"},
    }
    for family, expected_categories in required_families.items():
        assert expected_categories & categories, f"no coverage for required family: {family}"
        for cat in expected_categories & categories:
            assert sum(1 for c in cases if c.category == cat) >= 1


def test_good_answer_scores_well():
    case = GoldenCase(
        question="What is the DP of Dayjoy Turmeric?",
        expected_facts=["799"],
        prohibited_claims=["guaranteed to cure"],
    )
    answer = "**TL;DR:** Dayjoy Turmeric's DP is ₹799.\n\nThe distributor price for Dayjoy Turmeric is 799 rupees."
    score = score_against_rubric(case, answer, sources_count=1)
    assert score.factual_accuracy == 1.0
    assert score.grounding is True
    assert score.relevance is True
    assert score.overall() > 0.7


def test_missing_expected_fact_lowers_factual_accuracy():
    case = GoldenCase(question="What is the DP?", expected_facts=["799", "verified"])
    answer = "The price is not something I have information on."
    score = score_against_rubric(case, answer)
    assert score.factual_accuracy == 0.0


def test_partial_expected_facts_gives_partial_credit():
    case = GoldenCase(question="What is the refund policy?", expected_facts=["7 business days", "store credit option"])
    answer = "Refunds are processed within 7 business days of return."
    score = score_against_rubric(case, answer)
    assert score.factual_accuracy == 0.5  # "7 business days" present, "store credit option" is not


def test_prohibited_claim_fails_grounding():
    case = GoldenCase(question="Is this safe?", prohibited_claims=["100% guaranteed relief"])
    answer = "This product offers 100% guaranteed relief from all symptoms."
    score = score_against_rubric(case, answer)
    assert score.grounding is False
    # grounding is a GATE, not just one-of-N factors — a prohibited claim
    # (real safety/fabrication violation) caps overall at 0, regardless
    # of how well every other dimension scored.
    assert score.overall() == 0.0


def test_no_prohibited_claim_passes_grounding():
    case = GoldenCase(question="Is this safe?", prohibited_claims=["100% guaranteed relief"])
    answer = "This product may help with symptoms, but please consult your doctor."
    score = score_against_rubric(case, answer)
    assert score.grounding is True


def test_empty_answer_fails_relevance():
    case = GoldenCase(question="What is the price?")
    score = score_against_rubric(case, "   ")
    assert score.relevance is False


def test_long_unstructured_answer_fails_clarity():
    case = GoldenCase(question="Explain the compensation plan in detail.")
    long_flat_answer = "This is a very long answer with no structure at all. " * 20
    score = score_against_rubric(case, long_flat_answer)
    assert score.clarity is False


def test_long_structured_answer_passes_clarity():
    case = GoldenCase(question="Explain the compensation plan in detail.")
    structured_answer = (
        "**TL;DR:** Here's how the compensation plan works.\n\n"
        + "## Direct Sales\nEarn BV on every direct sale. " * 10
        + "\n\n## Team Bonuses\nEarn from your downline's volume too. " * 10
    )
    score = score_against_rubric(case, structured_answer)
    assert score.clarity is True


def test_short_answer_always_passes_clarity():
    case = GoldenCase(question="What is the price?")
    score = score_against_rubric(case, "The DP is 799 rupees.")
    assert score.clarity is True


def test_citation_correctness_requires_sources_when_provided():
    case = GoldenCase(question="What is the refund policy?")
    answer = "Refunds are processed within 7 days."
    score_with_sources = score_against_rubric(case, answer, sources_count=1)
    assert score_with_sources.citation_correctness is True
    score_no_sources = score_against_rubric(case, answer, sources_count=0)
    assert score_no_sources.citation_correctness is True  # nothing to cite — trivially fine


def test_actionable_case_detects_numbered_or_bulleted_steps():
    case = GoldenCase(question="How do I get started?", expects_actionable=True)
    actionable_answer = "1. Sign up on the app\n2. Complete KYC\n3. Place your first order"
    score = score_against_rubric(case, actionable_answer)
    assert score.actionability is True


def test_actionable_case_flags_non_actionable_answer():
    case = GoldenCase(question="How do I get started?", expects_actionable=True)
    non_actionable_answer = "Getting started involves several steps that vary by region."
    score = score_against_rubric(case, non_actionable_answer)
    assert score.actionability is False


def test_actionability_not_scored_when_not_expected():
    case = GoldenCase(question="What is the price?", expects_actionable=False)
    score = score_against_rubric(case, "The price is 799.")
    assert score.actionability is None


def test_to_dict_shape():
    case = GoldenCase(question="X", expected_facts=["y"])
    score = score_against_rubric(case, "y is present here.")
    d = score.to_dict()
    assert set(d.keys()) == {
        "factual_accuracy", "grounding", "relevance", "completeness",
        "clarity", "citation_correctness", "personalization", "actionability", "overall",
    }
    assert d["personalization"] is None
    assert 0.0 <= d["overall"] <= 1.0


def test_every_fixture_case_is_well_formed():
    """Each golden case must have at minimum a question and a category —
    guards against a malformed entry silently doing nothing."""
    cases = load_golden_cases(str(FIXTURE_PATH))
    for c in cases:
        assert c.question.strip()
        assert c.category.strip()
