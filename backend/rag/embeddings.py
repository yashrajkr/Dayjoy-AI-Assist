"""
Embedding provider abstraction for the RAG pipeline.

Supports multiple providers via a single `EmbeddingProvider` interface:

  - **openai**    → OpenAI text-embedding-3-small (default 1536 dims)
  - **groq**      → Groq embedding models (when available)
  - **local**     → Pure-Python TF-IDF hash embedding (no API calls, fixed
                    384 dims). Used when no provider is configured so the
                    RAG pipeline still works end-to-end.
  - **custom**    → Pluggable via the EMBEDDING_PROVIDER_REGISTRY.

Configuration is via environment variables:

    RAG_EMBEDDING_PROVIDER   = openai | groq | local   (default: local)
    OPENAI_API_KEY           = sk-...
    RAG_EMBEDDING_MODEL      = text-embedding-3-small
    RAG_EMBEDDING_DIMENSIONS = 1536

All providers expose:
    - name: str
    - dimensions: int
    - embed_batch(texts: List[str]) -> List[List[float]]
"""

from __future__ import annotations

import hashlib
import math
import os
import re
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

    if provider_name in ("openai",):
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
