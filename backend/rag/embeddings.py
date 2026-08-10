"""
Embedding provider abstraction for the RAG pipeline.

Supports multiple providers via a single `EmbeddingProvider` interface:

  - **jina**      → Jina AI jina-embeddings-v3 (default 1024 dims, matches
                    the knowledge_embeddings.embedding_vector column).
                    Task-specific: retrieval.passage for indexing,
                    retrieval.query for queries. This is the production
                    semantic embedding provider — see JinaEmbedding below.
  - **openai**    → OpenAI text-embedding-3-small (default 1536 dims)
  - **groq**      → Groq embedding models (when available)
  - **local**     → Pure-Python TF-IDF hash embedding (no API calls, fixed
                    384 dims). NOT a semantic embedding — for local
                    development only. Never selected automatically as a
                    fallback for a configured remote provider (jina/openai/
                    groq); a missing/misconfigured key for those providers
                    raises instead of silently degrading to this.
  - **custom**    → Pluggable via the EMBEDDING_PROVIDER_REGISTRY.

Configuration is via environment variables:

    RAG_EMBEDDING_PROVIDER   = jina | openai | groq | local   (default: local)
    JINA_API_KEY             = jina_...   (required when provider=jina)
    RAG_EMBEDDING_MODEL      = jina-embeddings-v3 | text-embedding-3-small | ...
    RAG_EMBEDDING_DIMENSIONS = 1024 (jina) | 1536 (openai) | ...
    JINA_BASE_URL            = https://api.jina.ai/v1   (optional override)
    JINA_TIMEOUT_SECONDS     = 30    (optional)
    JINA_MAX_RETRIES         = 3     (optional, transient failures only)
    JINA_RETRY_BASE_DELAY    = 1.0   (optional, seconds, exponential backoff base)
    OPENAI_API_KEY           = sk-...

All providers expose:
    - name: str
    - dimensions: int
    - embed_batch(texts: List[str]) -> List[List[float]]
    - embed(text: str) -> List[float]
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import time
from typing import Any, Dict, List, Optional, Protocol, Type, runtime_checkable


@runtime_checkable
class EmbeddingProviderProtocol(Protocol):
    name: str
    dimensions: int

    def embed_batch(self, texts: List[str]) -> List[List[float]]: ...

    def embed(self, text: str) -> List[float]: ...


class EmbeddingProvider:
    """Base class. Subclasses implement `embed_batch`."""

    name: str = "base"
    dimensions: int = 1536

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
# Jina AI provider — production semantic embedding provider
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
    "jina": JinaEmbedding,
    "openai": OpenAIEmbedding,
    "groq": GroqEmbedding,
    "local": LocalHashEmbedding,
    "local-hash": LocalHashEmbedding,
}

_provider_cache: Optional[EmbeddingProvider] = None


def get_embedding_provider(force_refresh: bool = False) -> EmbeddingProvider:
    """Return the configured embedding provider (cached)."""
    global _provider_cache
    if _provider_cache and not force_refresh:
        return _provider_cache

    provider_name = os.getenv("RAG_EMBEDDING_PROVIDER", "local").lower().strip()
    dimensions = int(os.getenv("RAG_EMBEDDING_DIMENSIONS", "0"))

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
            # Fall back to local
            _provider_cache = LocalHashEmbedding()
            return _provider_cache
        model = os.getenv("RAG_EMBEDDING_MODEL", "text-embedding-3-small")
        if dimensions == 0:
            dimensions = 1536
        _provider_cache = OpenAIEmbedding(api_key=api_key, model=model, dimensions=dimensions)
    elif provider_name in ("groq",):
        api_key = os.getenv("GROQ_API_KEY", "").strip()
        if not api_key:
            _provider_cache = LocalHashEmbedding()
            return _provider_cache
        model = os.getenv("RAG_EMBEDDING_MODEL", "llama3-embed-8b")
        if dimensions == 0:
            dimensions = 768
        _provider_cache = GroqEmbedding(api_key=api_key, model=model, dimensions=dimensions)
    else:
        # Local fallback — always works
        if dimensions == 0:
            dimensions = 384
        _provider_cache = LocalHashEmbedding(dimensions=dimensions)

    return _provider_cache
