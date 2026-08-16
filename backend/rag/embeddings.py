"""
Embedding provider abstraction for the RAG pipeline.

Supports multiple providers via a single `EmbeddingProvider` interface:

  - **gemini**    → Google Gemini text-embedding-004 (default 768 dims).
                    THE PRODUCTION DEFAULT PRIMARY PROVIDER. Automatic,
                    health-checked fallback to Jina on failure — see
                    get_embedding_provider()'s "gemini" branch. Never falls
                    back to LocalHashEmbedding.
  - **jina**      → Jina AI jina-embeddings-v3 (default 1024 dims). The
                    FALLBACK provider when RAG_EMBEDDING_PROVIDER=gemini and
                    Gemini is unavailable; also directly selectable on its
                    own via RAG_EMBEDDING_PROVIDER=jina.
  - **openai**    → OpenAI text-embedding-3-small (default 1536 dims)
  - **groq**      → Groq embedding models (when available)
  - **local**     → Pure-Python TF-IDF hash embedding (no API calls, fixed
                    384 dims). NOT a semantic embedding — for local
                    development only, never a production semantic-search
                    substitute. Never selected automatically as a fallback
                    for a configured remote provider (gemini/jina/openai/
                    groq); a missing/misconfigured key for those providers
                    raises (gemini/jina: after exhausting the gemini->jina
                    fallback chain) instead of silently degrading to this.
  - **custom**    → Pluggable via the EMBEDDING_PROVIDER_REGISTRY.

Configuration is via environment variables:

    RAG_EMBEDDING_PROVIDER      = gemini | jina | openai | groq | local  (default: local)
    GEMINI_API_KEY              = AIza...  (required for gemini; falls back to
                                   jina — health-checked — on failure, never
                                   silently to local-hash)
    JINA_API_KEY                = jina_...  (required when provider=jina, or
                                   as the gemini fallback)
    RAG_EMBEDDING_MODEL         = text-embedding-004 | jina-embeddings-v3 | ...
    RAG_EMBEDDING_DIMENSIONS    = 768 (gemini) | 1024 (jina) | 1536 (openai) | ...
    RAG_EMBEDDING_HEALTH_TTL    = 300  (seconds a provider health check is cached)
    JINA_BASE_URL                = https://api.jina.ai/v1   (optional override)
    JINA_TIMEOUT_SECONDS         = 30    (optional)
    JINA_MAX_RETRIES             = 3     (optional, transient failures only)
    JINA_RETRY_BASE_DELAY        = 1.0   (optional, seconds, exponential backoff base)
    GEMINI_BASE_URL               = https://generativelanguage.googleapis.com/v1beta (optional override)
    GEMINI_TIMEOUT_SECONDS        = 30    (optional)
    GEMINI_MAX_RETRIES            = 3     (optional, transient failures only)
    GEMINI_RETRY_BASE_DELAY       = 1.0   (optional, seconds, exponential backoff base)
    OPENAI_API_KEY                = sk-...

All providers expose:
    - name: str
    - dimensions: int
    - is_semantic: bool
    - embed_batch(texts: List[str]) -> List[List[float]]
    - embed(text: str) -> List[float]

Namespace/dimension safety: `knowledge_embeddings` rows carry `model_name`
and `dimensions`; `VectorStore.search()`'s "does an active embedding exist"
check now filters on the CURRENT provider's model_name (not just is_active),
so switching providers never causes a cross-model similarity comparison
against stale vectors from a different embedding space — it correctly falls
back to keyword search until `reembed_active_chunks()` (rag/reembed.py) has
backfilled the new provider's vectors.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import time
from typing import Any, Dict, List, Optional, Protocol, Type, runtime_checkable

_logger = logging.getLogger("dayjoy.rag")


@runtime_checkable
class EmbeddingProviderProtocol(Protocol):
    name: str
    dimensions: int
    is_semantic: bool

    def embed_batch(self, texts: List[str]) -> List[List[float]]: ...

    def embed(self, text: str) -> List[float]: ...


class EmbeddingProvider:
    """Base class. Subclasses implement `embed_batch`."""

    name: str = "base"
    dimensions: int = 1536
    # True for real semantic embedding models (Jina/OpenAI/Groq); False only
    # for LocalHashEmbedding, which is lexical-overlap hashing, not semantic
    # similarity. Callers (Retriever, orchestrator observability) use this to
    # surface degraded-search state instead of silently trusting the vectors.
    is_semantic: bool = True

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        raise NotImplementedError

    def embed(self, text: str) -> List[float]:
        return self.embed_batch([text])[0]


# ---------------------------------------------------------------------------
# Local fallback — deterministic hash-based embedding (no deps)
# ---------------------------------------------------------------------------

class LocalHashEmbedding(EmbeddingProvider):
    """Deterministic hash-based embedding (384 dims).

    Uses token hashing into a fixed-size vector with L2 normalization.
    Cosine similarity reflects lexical overlap, which makes it a usable
    fallback when no real embedding model is configured. It is NOT a
    semantic embedding — but it keeps the RAG pipeline functional and
    produces sensible rankings for keyword-rich queries.
    """

    name = "local-hash"
    dimensions = 384
    is_semantic = False

    def __init__(self, dimensions: int = 384):
        self.dimensions = dimensions

    def _tokenize(self, text: str) -> List[str]:
        return [t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) >= 2]

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        out: List[List[float]] = []
        for text in texts:
            vec = [0.0] * self.dimensions
            tokens = self._tokenize(text)
            for tok in tokens:
                # Hash token → bucket index
                h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
                idx = h % self.dimensions
                # Sign from a second hash
                sign_h = int(hashlib.sha1(tok.encode("utf-8")).hexdigest(), 16)
                sign = 1.0 if (sign_h % 2 == 0) else -1.0
                vec[idx] += sign
            # L2 normalize
            norm = math.sqrt(sum(v * v for v in vec))
            if norm > 0:
                vec = [v / norm for v in vec]
            out.append(vec)
        return out


# ---------------------------------------------------------------------------
# Gemini provider — production PRIMARY semantic embedding provider
# ---------------------------------------------------------------------------

class GeminiEmbeddingError(RuntimeError):
    """Any unrecoverable Gemini embedding failure.

    Deliberately a loud exception, not a silent fallback: callers must not
    catch this and substitute LocalHashEmbedding in production. See
    get_embedding_provider()'s "gemini" branch — a Gemini failure triggers a
    health-checked fallback to Jina, and if that also fails, an
    EmbeddingProviderUnavailableError is raised rather than degrading to
    local-hash.
    """


class GeminiAuthError(GeminiEmbeddingError):
    """401/403 — invalid or missing API key. Never retried."""


class GeminiRateLimitError(GeminiEmbeddingError):
    """429 — rate limited, retries exhausted."""


class GeminiEmbedding(EmbeddingProvider):
    """Google Gemini embeddings (text-embedding-004 by default, 768 dims).

    Uses Gemini's batchEmbedContents endpoint for embed_batch() and
    embedContent for a single embed() call — the Generative Language API's
    REST shape (https://ai.google.dev/api/embeddings), same retry policy as
    JinaEmbedding: 429/5xx retried with exponential backoff (honoring
    Retry-After when present), 401/403/other 4xx are permanent and never
    retried.
    """

    name = "gemini"
    dimensions = 768

    def __init__(
        self,
        api_key: str,
        model: str = "text-embedding-004",
        dimensions: int = 768,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_base_delay: float = 1.0,
    ):
        if not api_key:
            raise GeminiEmbeddingError(
                "GEMINI_API_KEY is required when RAG_EMBEDDING_PROVIDER=gemini."
            )
        self.api_key = api_key
        self.model = model if model.startswith("models/") else f"models/{model}"
        self.dimensions = dimensions
        self._base_url = (
            base_url or os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
        ).rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        out: List[List[float]] = []
        batch_size = 100  # Gemini batchEmbedContents limit
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            out.extend(self._batch_request(batch))
        return out

    def embed(self, text: str) -> List[float]:
        return self._single_request(text)

    def _single_request(self, text: str) -> List[float]:
        try:
            import httpx
        except ImportError as e:
            raise GeminiEmbeddingError("httpx is required for Gemini embeddings") from e

        url = f"{self._base_url}/{self.model}:embedContent?key={self.api_key}"
        payload = {
            "model": self.model,
            "content": {"parts": [{"text": text}]},
            "outputDimensionality": self.dimensions,
        }
        data = self._post_with_retry(httpx, url, payload)
        vec = data.get("embedding", {}).get("values")
        if not vec:
            raise GeminiEmbeddingError("Gemini embedContent response had no embedding values")
        return vec

    def _batch_request(self, texts: List[str]) -> List[List[float]]:
        try:
            import httpx
        except ImportError as e:
            raise GeminiEmbeddingError("httpx is required for Gemini embeddings") from e

        url = f"{self._base_url}/{self.model}:batchEmbedContents?key={self.api_key}"
        payload = {
            "requests": [
                {
                    "model": self.model,
                    "content": {"parts": [{"text": t}]},
                    "outputDimensionality": self.dimensions,
                }
                for t in texts
            ]
        }
        data = self._post_with_retry(httpx, url, payload)
        embeddings = data.get("embeddings", [])
        vectors = [e.get("values") for e in embeddings]
        if len(vectors) != len(texts) or not all(vectors):
            raise GeminiEmbeddingError(
                f"Gemini batchEmbedContents returned {len(vectors)} embeddings for {len(texts)} inputs"
            )
        return vectors

    def _post_with_retry(self, httpx_module: Any, url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        last_error: Optional[BaseException] = None
        for attempt in range(self.max_retries + 1):
            try:
                resp = httpx_module.post(url, json=payload, timeout=self.timeout)
            except (httpx_module.TimeoutException, httpx_module.TransportError) as e:
                last_error = e
                if attempt < self.max_retries:
                    time.sleep(self._backoff_delay(attempt))
                    continue
                raise GeminiEmbeddingError(
                    f"Gemini embeddings request failed after {self.max_retries + 1} "
                    f"attempts (network/timeout): {e}"
                ) from e

            if resp.status_code in (401, 403):
                raise GeminiAuthError(
                    f"Gemini embeddings authentication failed ({resp.status_code}). "
                    "Check GEMINI_API_KEY. Not retrying."
                )

            if resp.status_code == 429:
                if attempt < self.max_retries:
                    delay = self._retry_after_seconds(resp) or self._backoff_delay(attempt)
                    time.sleep(delay)
                    continue
                raise GeminiRateLimitError(
                    f"Gemini embeddings rate-limited (429) after "
                    f"{self.max_retries + 1} attempts: {resp.text[:300]}"
                )

            if resp.status_code >= 500:
                if attempt < self.max_retries:
                    time.sleep(self._backoff_delay(attempt))
                    continue
                raise GeminiEmbeddingError(
                    f"Gemini embeddings server error ({resp.status_code}) after "
                    f"{self.max_retries + 1} attempts: {resp.text[:300]}"
                )

            if resp.status_code >= 400:
                raise GeminiEmbeddingError(
                    f"Gemini embeddings request rejected ({resp.status_code}): {resp.text[:300]}"
                )

            return resp.json()

        raise GeminiEmbeddingError(f"Gemini embeddings failed: {last_error}")

    def _backoff_delay(self, attempt: int) -> float:
        return self.retry_base_delay * (2 ** attempt)

    def _retry_after_seconds(self, resp: Any) -> Optional[float]:
        val = resp.headers.get("Retry-After") or resp.headers.get("retry-after")
        if not val:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None


# ---------------------------------------------------------------------------
# Jina AI provider — fallback semantic embedding provider (also directly
# selectable on its own via RAG_EMBEDDING_PROVIDER=jina)
# ---------------------------------------------------------------------------

class JinaEmbeddingError(RuntimeError):
    """Any unrecoverable Jina embedding failure.

    Deliberately a loud exception, not a silent fallback: callers must not
    catch this and substitute LocalHashEmbedding (or any other fake vector)
    in production. See get_embedding_provider() — a missing JINA_API_KEY
    when RAG_EMBEDDING_PROVIDER=jina raises this at provider-construction
    time rather than degrading to local-hash.
    """


class JinaAuthError(JinaEmbeddingError):
    """401/403 — invalid or missing API key. Never retried."""


class JinaRateLimitError(JinaEmbeddingError):
    """429 — rate limited, retries exhausted."""


class JinaEmbedding(EmbeddingProvider):
    """Jina AI embeddings (jina-embeddings-v3 by default, 1024 dims).

    Uses Jina's task-specific encoding per their retrieval best practice:
      - embed_batch() — used by the ingestion pipeline for chunks/documents
        → task="retrieval.passage"
      - embed()       — used by the retriever for a single user query
        → task="retrieval.query"

    Retry policy: 429 and 5xx are retried with exponential backoff (honoring
    a `Retry-After` header when Jina sends one for 429s). 401/403 and other
    4xx are treated as permanent (bad key / bad request) and never retried.
    """

    name = "jina"
    dimensions = 1024

    def __init__(
        self,
        api_key: str,
        model: str = "jina-embeddings-v3",
        dimensions: int = 1024,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_base_delay: float = 1.0,
    ):
        if not api_key:
            raise JinaEmbeddingError(
                "JINA_API_KEY is required when RAG_EMBEDDING_PROVIDER=jina."
            )
        self.api_key = api_key
        self.model = model
        self.dimensions = dimensions
        self._base_url = (base_url or os.getenv("JINA_BASE_URL", "https://api.jina.ai/v1")).rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed documents/chunks for indexing — task=retrieval.passage."""
        if not texts:
            return []
        out: List[List[float]] = []
        batch_size = 32
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            out.extend(self._request(batch, task="retrieval.passage"))
        return out

    def embed(self, text: str) -> List[float]:
        """Embed a single user query — task=retrieval.query."""
        return self._request([text], task="retrieval.query")[0]

    def _request(self, texts: List[str], task: str) -> List[List[float]]:
        try:
            import httpx
        except ImportError as e:
            raise JinaEmbeddingError("httpx is required for Jina embeddings") from e

        payload = {
            "model": self.model,
            "task": task,
            "dimensions": self.dimensions,
            "input": texts,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        last_error: Optional[BaseException] = None
        for attempt in range(self.max_retries + 1):
            try:
                resp = httpx.post(
                    f"{self._base_url}/embeddings",
                    headers=headers,
                    json=payload,
                    timeout=self.timeout,
                )
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last_error = e
                if attempt < self.max_retries:
                    time.sleep(self._backoff_delay(attempt))
                    continue
                raise JinaEmbeddingError(
                    f"Jina embeddings request failed after {self.max_retries + 1} "
                    f"attempts (network/timeout): {e}"
                ) from e

            if resp.status_code in (401, 403):
                # Bad/missing key — permanent, never retry.
                raise JinaAuthError(
                    f"Jina embeddings authentication failed ({resp.status_code}). "
                    "Check JINA_API_KEY. Not retrying."
                )

            if resp.status_code == 429:
                if attempt < self.max_retries:
                    delay = self._retry_after_seconds(resp)
                    if delay is None:
                        delay = self._backoff_delay(attempt)
                    time.sleep(delay)
                    continue
                raise JinaRateLimitError(
                    f"Jina embeddings rate-limited (429) after "
                    f"{self.max_retries + 1} attempts: {resp.text[:300]}"
                )

            if resp.status_code >= 500:
                # Transient provider-side failure — retry.
                if attempt < self.max_retries:
                    time.sleep(self._backoff_delay(attempt))
                    continue
                raise JinaEmbeddingError(
                    f"Jina embeddings server error ({resp.status_code}) after "
                    f"{self.max_retries + 1} attempts: {resp.text[:300]}"
                )

            if resp.status_code >= 400:
                # Other 4xx (bad model/task/dimensions/input) — a
                # configuration problem, not transient. Do not retry.
                raise JinaEmbeddingError(
                    f"Jina embeddings request rejected ({resp.status_code}): "
                    f"{resp.text[:300]}"
                )

            data = resp.json()
            vectors = [d["embedding"] for d in data.get("data", [])]
            if len(vectors) != len(texts):
                raise JinaEmbeddingError(
                    f"Jina returned {len(vectors)} embeddings for {len(texts)} inputs"
                )
            return vectors

        # Unreachable: the loop above always returns or raises.
        raise JinaEmbeddingError(f"Jina embeddings failed: {last_error}")

    def _backoff_delay(self, attempt: int) -> float:
        return self.retry_base_delay * (2 ** attempt)

    def _retry_after_seconds(self, resp: Any) -> Optional[float]:
        val = resp.headers.get("Retry-After") or resp.headers.get("retry-after")
        if not val:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None


# ---------------------------------------------------------------------------
# OpenAI provider
# ---------------------------------------------------------------------------

class OpenAIEmbedding(EmbeddingProvider):
    name = "openai"
    dimensions = 1536

    def __init__(self, api_key: str, model: str = "text-embedding-3-small", dimensions: int = 1536):
        self.api_key = api_key
        self.model = model
        self.dimensions = dimensions
        self._base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        try:
            import httpx
        except ImportError as e:
            raise RuntimeError("httpx is required for OpenAI embeddings") from e
        out: List[List[float]] = []
        # OpenAI limits batch to 100 inputs; chunk to stay safe
        batch_size = 64
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            payload = {
                "model": self.model,
                "input": batch,
            }
            # Only pass dimensions for models that support it
            if "text-embedding-3" in self.model:
                payload["dimensions"] = self.dimensions
            resp = httpx.post(
                f"{self._base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json()
            out.extend([d["embedding"] for d in data.get("data", [])])
        return out


# ---------------------------------------------------------------------------
# Groq provider (Groq supports embeddings on certain models)
# ---------------------------------------------------------------------------

class GroqEmbedding(EmbeddingProvider):
    name = "groq"
    dimensions = 768

    def __init__(self, api_key: str, model: str = "llama3-embed-8b", dimensions: int = 768):
        self.api_key = api_key
        self.model = model
        self.dimensions = dimensions

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        try:
            import httpx
        except ImportError as e:
            raise RuntimeError("httpx is required for Groq embeddings") from e
        out: List[List[float]] = []
        batch_size = 32
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            payload = {"model": self.model, "input": batch}
            resp = httpx.post(
                "https://api.groq.com/openai/v1/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
                timeout=60.0,
            )
            if resp.status_code >= 400:
                # Groq may not support embeddings on all accounts → fall back to local
                raise RuntimeError(f"Groq embedding failed: {resp.status_code} {resp.text}")
            data = resp.json()
            out.extend([d["embedding"] for d in data.get("data", [])])
        return out


# ---------------------------------------------------------------------------
# Provider registry & factory
# ---------------------------------------------------------------------------

EMBEDDING_PROVIDER_REGISTRY: Dict[str, Type[EmbeddingProvider]] = {
    "gemini": GeminiEmbedding,
    "jina": JinaEmbedding,
    "openai": OpenAIEmbedding,
    "groq": GroqEmbedding,
    "local": LocalHashEmbedding,
    "local-hash": LocalHashEmbedding,
}

_provider_cache: Optional[EmbeddingProvider] = None


# ---------------------------------------------------------------------------
# Health checks
# ---------------------------------------------------------------------------

class EmbeddingProviderUnavailableError(RuntimeError):
    """Raised when RAG_EMBEDDING_PROVIDER=gemini and BOTH Gemini and its
    Jina fallback are unconfigured/unhealthy. Deliberately loud: the caller
    must fix configuration or explicitly opt into local-hash for dev, not
    silently receive a non-semantic embedding provider in production."""


# provider name -> (healthy: bool, checked_at: float)
_health_cache: Dict[str, tuple] = {}


def _health_check_ttl() -> float:
    return float(os.getenv("RAG_EMBEDDING_HEALTH_TTL", "300"))


def check_provider_health(provider: EmbeddingProvider, force: bool = False) -> bool:
    """Real (network) health check: embeds a short probe string and confirms
    a vector of the expected dimensionality comes back. Cached for
    RAG_EMBEDDING_HEALTH_TTL seconds (default 300) per provider name so this
    isn't a network round-trip on every request — only on cache expiry."""
    now = time.time()
    cached = _health_cache.get(provider.name)
    if cached and not force and (now - cached[1]) < _health_check_ttl():
        return cached[0]
    try:
        vec = provider.embed("health check probe")
        healthy = bool(vec) and len(vec) == provider.dimensions
        if not healthy:
            _logger.warning(
                "Embedding provider %s health check returned an unexpected vector "
                "(len=%s, expected=%s)",
                provider.name, len(vec) if vec else 0, provider.dimensions,
            )
    except Exception as e:
        _logger.warning("Embedding provider %s health check failed: %s", provider.name, e)
        healthy = False
    _health_cache[provider.name] = (healthy, now)
    return healthy


def reset_health_cache() -> None:
    """Test/ops helper — clears cached health-check results so the next
    check_provider_health() call always hits the network."""
    _health_cache.clear()


def get_embedding_provider(force_refresh: bool = False) -> EmbeddingProvider:
    """Return the configured embedding provider (cached)."""
    global _provider_cache
    if _provider_cache and not force_refresh:
        return _provider_cache

    provider_name = os.getenv("RAG_EMBEDDING_PROVIDER", "local").lower().strip()
    dimensions = int(os.getenv("RAG_EMBEDDING_DIMENSIONS", "0"))

    if provider_name in ("gemini",):
        # PRIMARY production provider. Health-checked automatic fallback to
        # Jina on failure; if both are unavailable, raise loudly rather than
        # silently degrading to LocalHashEmbedding — see
        # EmbeddingProviderUnavailableError.
        gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
        gemini_model = os.getenv("RAG_EMBEDDING_MODEL", "text-embedding-004")
        gemini_dims = dimensions if dimensions else 768
        gemini_error: Optional[BaseException] = None

        if gemini_key:
            try:
                candidate = GeminiEmbedding(
                    api_key=gemini_key,
                    model=gemini_model,
                    dimensions=gemini_dims,
                    timeout=float(os.getenv("GEMINI_TIMEOUT_SECONDS", "30")),
                    max_retries=int(os.getenv("GEMINI_MAX_RETRIES", "3")),
                    retry_base_delay=float(os.getenv("GEMINI_RETRY_BASE_DELAY", "1.0")),
                )
                if check_provider_health(candidate):
                    _provider_cache = candidate
                    return _provider_cache
                gemini_error = GeminiEmbeddingError("health check failed")
            except Exception as e:
                gemini_error = e
        else:
            gemini_error = GeminiEmbeddingError("GEMINI_API_KEY is not set")

        _logger.warning(
            "Gemini embedding provider unavailable (%s) — falling back to Jina.",
            gemini_error,
        )

        jina_key = os.getenv("JINA_API_KEY", "").strip()
        if jina_key:
            try:
                jina_candidate = JinaEmbedding(
                    api_key=jina_key,
                    model=os.getenv("JINA_FALLBACK_MODEL", "jina-embeddings-v3"),
                    dimensions=int(os.getenv("JINA_FALLBACK_DIMENSIONS", "1024")),
                    timeout=float(os.getenv("JINA_TIMEOUT_SECONDS", "30")),
                    max_retries=int(os.getenv("JINA_MAX_RETRIES", "3")),
                    retry_base_delay=float(os.getenv("JINA_RETRY_BASE_DELAY", "1.0")),
                )
                if check_provider_health(jina_candidate):
                    _provider_cache = jina_candidate
                    return _provider_cache
                _logger.error("Jina fallback embedding provider also failed its health check.")
            except Exception as e:
                _logger.error("Jina fallback embedding provider construction failed: %s", e)
        else:
            _logger.error("No JINA_API_KEY configured — no fallback available for Gemini failure.")

        raise EmbeddingProviderUnavailableError(
            "RAG_EMBEDDING_PROVIDER=gemini but both Gemini and its Jina fallback "
            "are unavailable/unconfigured/unhealthy. Refusing to silently degrade "
            "to LocalHashEmbedding in production mode — set GEMINI_API_KEY and/or "
            "JINA_API_KEY, or explicitly set RAG_EMBEDDING_PROVIDER=local for "
            "local development only."
        )

    if provider_name in ("jina",):
        api_key = os.getenv("JINA_API_KEY", "").strip()
        if not api_key:
            # Do NOT fall back to local-hash here. A production RAG deployment
            # explicitly configured for jina with no key is a misconfiguration
            # that must fail loudly, not silently degrade to a non-semantic
            # embedding that would poison retrieval quality invisibly.
            raise JinaEmbeddingError(
                "RAG_EMBEDDING_PROVIDER=jina but JINA_API_KEY is not set. "
                "Set JINA_API_KEY, or choose a different RAG_EMBEDDING_PROVIDER "
                "if you intend to run without real embeddings."
            )
        model = os.getenv("RAG_EMBEDDING_MODEL", "jina-embeddings-v3")
        if dimensions == 0:
            dimensions = 1024
        timeout = float(os.getenv("JINA_TIMEOUT_SECONDS", "30"))
        max_retries = int(os.getenv("JINA_MAX_RETRIES", "3"))
        retry_base_delay = float(os.getenv("JINA_RETRY_BASE_DELAY", "1.0"))
        _provider_cache = JinaEmbedding(
            api_key=api_key,
            model=model,
            dimensions=dimensions,
            timeout=timeout,
            max_retries=max_retries,
            retry_base_delay=retry_base_delay,
        )
    elif provider_name in ("openai",):
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            # Fall back to local — but unlike jina above, this must not be a
            # *silent* degrade: an operator who set RAG_EMBEDDING_PROVIDER=
            # openai believes real semantic search is running. Log it loudly
            # so it shows up in server logs / error tracking, even though we
            # still keep the pipeline functional rather than hard-failing.
            _logger.warning(
                "RAG_EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set — "
                "falling back to LocalHashEmbedding (NOT a semantic embedding; "
                "lexical-overlap only). Set OPENAI_API_KEY to restore real "
                "semantic search."
            )
            _provider_cache = LocalHashEmbedding()
            return _provider_cache
        model = os.getenv("RAG_EMBEDDING_MODEL", "text-embedding-3-small")
        if dimensions == 0:
            dimensions = 1536
        _provider_cache = OpenAIEmbedding(api_key=api_key, model=model, dimensions=dimensions)
    elif provider_name in ("groq",):
        api_key = os.getenv("GROQ_API_KEY", "").strip()
        if not api_key:
            _logger.warning(
                "RAG_EMBEDDING_PROVIDER=groq but GROQ_API_KEY is not set — "
                "falling back to LocalHashEmbedding (NOT a semantic embedding; "
                "lexical-overlap only). Set GROQ_API_KEY to restore real "
                "semantic search."
            )
            _provider_cache = LocalHashEmbedding()
            return _provider_cache
        model = os.getenv("RAG_EMBEDDING_MODEL", "llama3-embed-8b")
        if dimensions == 0:
            dimensions = 768
        _provider_cache = GroqEmbedding(api_key=api_key, model=model, dimensions=dimensions)
    else:
        # Local fallback — always works. This is the documented dev default
        # (RAG_EMBEDDING_PROVIDER unset), not a degrade of a configured
        # provider, but production deployments should still know they're
        # running without semantic search.
        if dimensions == 0:
            dimensions = 384
        _logger.warning(
            "RAG_EMBEDDING_PROVIDER=%s — using LocalHashEmbedding (NOT a "
            "semantic embedding; lexical-overlap only). Set "
            "RAG_EMBEDDING_PROVIDER=jina|openai|groq with the matching API "
            "key for real semantic search.",
            provider_name,
        )
        _provider_cache = LocalHashEmbedding(dimensions=dimensions)

    return _provider_cache


def embedding_provider_status(provider: Optional[EmbeddingProvider] = None) -> Dict[str, Any]:
    """Small, explicit status dict for callers that need to know — without
    string-matching `provider.name` — whether the active embedding provider
    is real semantic search or the local-hash lexical fallback. Used by the
    RAG retriever (embedding_degraded on RetrievalResult) and the
    orchestrator's observability layer."""
    p = provider or get_embedding_provider()
    return {
        "provider": getattr(p, "name", "unknown"),
        "dimensions": getattr(p, "dimensions", None),
        "is_semantic": bool(getattr(p, "is_semantic", True)),
        "degraded": not bool(getattr(p, "is_semantic", True)),
    }
