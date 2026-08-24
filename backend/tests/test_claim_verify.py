"""Tests for backend/orchestrator/claim_verify.py — Citation Verification
/ Claim-Level Grounding (Capabilities 7, 8). Uses the same FakeAsyncClient
stand-in pattern as test_answer_verify.py / test_contradiction.py.
"""

from __future__ import annotations

import pytest

from backend import main as backend_main
from backend.orchestrator import claim_verify as cv


class FakeResponse:
    def __init__(self, status_code: int, json_data: dict):
        self.status_code = status_code
        self._json_data = json_data

    def json(self):
        return self._json_data


class FakeAsyncClient:
    post_response: FakeResponse | Exception | None = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        if isinstance(self.post_response, Exception):
            raise self.post_response
        return self.post_response


def _client_with(post):
    FakeAsyncClient.post_response = post
    return FakeAsyncClient


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "")
    monkeypatch.setattr(backend_main, "OPENAI_API_KEY", "")


# ---------------------------------------------------------------------------
# should_verify_claims
# ---------------------------------------------------------------------------


def test_skips_casual_answers():
    long_answer = "x" * 200
    assert cv.should_verify_claims(long_answer, "casual") is False


def test_skips_general_llm_answers():
    long_answer = "x" * 200
    assert cv.should_verify_claims(long_answer, "general_llm") is False


def test_skips_short_answers():
    assert cv.should_verify_claims("Short answer.", "dayjoy_knowledge") is False


def test_verifies_substantive_dayjoy_answers():
    long_answer = "x" * 200
    assert cv.should_verify_claims(long_answer, "dayjoy_knowledge") is True
    assert cv.should_verify_claims(long_answer, "hybrid") is True


# ---------------------------------------------------------------------------
# verify_claims
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_llm_configured_skips_check():
    result = await cv.verify_claims("x" * 200, "some evidence")
    assert result.checked is False
    assert result.claims == []


@pytest.mark.asyncio
async def test_empty_answer_skips_check(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    result = await cv.verify_claims("", "some evidence")
    assert result.checked is False


@pytest.mark.asyncio
async def test_parses_valid_claim_list(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    content = (
        '[{"claim": "DP is 799", "state": "verified"}, '
        '{"claim": "It helps with joint pain", "state": "ai_analysis"}, '
        '{"claim": "It cures arthritis", "state": "unverified"}]'
    )
    monkeypatch.setattr(
        cv.httpx, "AsyncClient",
        _client_with(FakeResponse(200, {"choices": [{"message": {"content": content}}]})),
    )
    result = await cv.verify_claims("Dayjoy Turmeric DP is 799. It helps with joint pain and cures arthritis.", "DP is 799.")
    assert result.checked is True
    assert len(result.claims) == 3
    assert result.claims[0].state == cv.CLAIM_VERIFIED
    assert result.claims[2].state == cv.CLAIM_UNVERIFIED
    assert result.has_unverified_claim is True


@pytest.mark.asyncio
async def test_no_unverified_claims_when_all_supported(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    content = '[{"claim": "DP is 799", "state": "verified"}]'
    monkeypatch.setattr(
        cv.httpx, "AsyncClient",
        _client_with(FakeResponse(200, {"choices": [{"message": {"content": content}}]})),
    )
    result = await cv.verify_claims("Dayjoy Turmeric DP is 799.", "DP is 799.")
    assert result.has_unverified_claim is False


@pytest.mark.asyncio
async def test_invalid_state_values_are_dropped(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    content = '[{"claim": "Something", "state": "not_a_real_state"}, {"claim": "DP is 799", "state": "verified"}]'
    monkeypatch.setattr(
        cv.httpx, "AsyncClient",
        _client_with(FakeResponse(200, {"choices": [{"message": {"content": content}}]})),
    )
    result = await cv.verify_claims("x" * 200, "some evidence")
    assert result.checked is True
    assert len(result.claims) == 1
    assert result.claims[0].claim == "DP is 799"


@pytest.mark.asyncio
async def test_caps_at_eight_claims(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    content = str([{"claim": f"claim {i}", "state": "verified"} for i in range(20)]).replace("'", '"')
    monkeypatch.setattr(
        cv.httpx, "AsyncClient",
        _client_with(FakeResponse(200, {"choices": [{"message": {"content": content}}]})),
    )
    result = await cv.verify_claims("x" * 200, "some evidence")
    assert len(result.claims) == 8


@pytest.mark.asyncio
async def test_provider_error_degrades_to_unchecked(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(cv.httpx, "AsyncClient", _client_with(FakeResponse(500, {})))
    result = await cv.verify_claims("x" * 200, "some evidence")
    assert result.checked is False


@pytest.mark.asyncio
async def test_network_error_degrades_to_unchecked(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(cv.httpx, "AsyncClient", _client_with(ConnectionError("boom")))
    result = await cv.verify_claims("x" * 200, "some evidence")
    assert result.checked is False


@pytest.mark.asyncio
async def test_unparseable_response_degrades_to_unchecked(monkeypatch):
    monkeypatch.setattr(backend_main, "GROQ_API_KEY", "fake-key")
    monkeypatch.setattr(
        cv.httpx, "AsyncClient",
        _client_with(FakeResponse(200, {"choices": [{"message": {"content": "not json"}}]})),
    )
    result = await cv.verify_claims("x" * 200, "some evidence")
    assert result.checked is False


def test_to_dict_shape():
    result = cv.ClaimVerificationResult(
        claims=[cv.ClaimVerdict(claim="DP is 799", state=cv.CLAIM_VERIFIED)], checked=True,
    )
    d = result.to_dict()
    assert d == {"checked": True, "claims": [{"claim": "DP is 799", "state": "verified"}]}
