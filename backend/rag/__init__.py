"""
Dayjoy AI Assist — RAG (Retrieval-Augmented Generation) subsystem.

Modular enterprise RAG pipeline:

    extractors  → text extraction from PDF/DOCX/TXT/CSV/MD/PPT/XLSX
    chunking    → semantic chunking with overlap & section detection
    embeddings  → swappable embedding provider (OpenAI / Groq / local)
    vector_store→ Supabase pgvector / JSONB fallback storage + search
    retriever   → end-to-end retrieve-and-rank pipeline
    pipeline    → orchestrate ingest → chunk → embed → store

All modules are designed to be safe to import even when optional
dependencies are missing (they raise informative errors only when
actually invoked).
"""

from .extractors import extract_text, extract_metadata, SUPPORTED_MIME_TYPES
from .chunking import chunk_text, ChunkingConfig, Chunk
from .embeddings import EmbeddingProvider, get_embedding_provider
from .vector_store import VectorStore, get_vector_store
from .retriever import Retriever, RetrievalResult, get_retriever
from .pipeline import ingest_document, reindex_document

__all__ = [
    "extract_text",
    "extract_metadata",
    "SUPPORTED_MIME_TYPES",
    "chunk_text",
    "ChunkingConfig",
    "Chunk",
    "EmbeddingProvider",
    "get_embedding_provider",
    "VectorStore",
    "get_vector_store",
    "Retriever",
    "RetrievalResult",
    "get_retriever",
    "ingest_document",
    "reindex_document",
]
