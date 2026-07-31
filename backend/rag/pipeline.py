"""
End-to-end ingestion pipeline for the RAG subsystem.

Pipeline stages:

    extract  → extract text from uploaded file
    chunk    → split into semantic chunks
    embed    → generate embeddings for each chunk (batched)
    store    → persist chunks + embeddings into Supabase

This module is async and uses the user's JWT (or service role) for all
Supabase writes. It's designed to be called from FastAPI endpoints and
from background re-indexing tasks.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .chunking import Chunk, ChunkingConfig, chunk_text
from .embeddings import get_embedding_provider
from .extractors import SUPPORTED_MIME_TYPES, extract_text
from .vector_store import VectorStore, get_vector_store

logger = logging.getLogger("dayjoy.rag.pipeline")


@dataclass
class IngestResult:
    """Result of an ingest operation."""

    document_id: str
    chunk_count: int = 0
    embedding_count: int = 0
    token_count: int = 0
    char_count: int = 0
    error: Optional[str] = None
    page_count: int = 0
    sections: int = 0
    model_used: str = ""
    dimensions: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "document_id": self.document_id,
            "chunk_count": self.chunk_count,
            "embedding_count": self.embedding_count,
            "token_count": self.token_count,
            "char_count": self.char_count,
            "error": self.error,
            "page_count": self.page_count,
            "sections": self.sections,
            "model_used": self.model_used,
            "dimensions": self.dimensions,
        }


async def ingest_document(
    document_id: str,
    content: bytes,
    filename: str,
    mime_type: Optional[str],
    token: Optional[str] = None,
    use_service_role: bool = False,
    chunk_config: Optional[ChunkingConfig] = None,
) -> IngestResult:
    """Ingest an already-uploaded document.

    Steps:
      1. Extract text + sections + pages.
      2. Chunk text.
      3. Persist chunks to Supabase (deletes any existing chunks for this
         document first).
      4. Generate embeddings in batches.
      5. Persist embeddings.
      6. Update document chunk_count/token_count denormalized fields.
    """
    result = IngestResult(document_id=document_id)
    store = get_vector_store()
    cfg = chunk_config or ChunkingConfig.from_env()

    # 1) Extract
    try:
        full_text, pages, sections, meta = extract_text(content, filename, mime_type)
    except Exception as e:
        result.error = f"Extraction failed: {e}"
        logger.warning("[rag] %s extraction failed: %s", filename, e)
        return result

    result.page_count = meta.get("page_count", 1 if pages else 0)
    result.sections = len(sections)

    # 2) Chunk
    chunks: List[Chunk] = chunk_text(
        full_text=full_text,
        pages=pages,
        sections=sections,
        config=cfg,
    )
    if not chunks:
        result.error = "No text could be chunked from this document."
        return result
    result.chunk_count = len(chunks)
    result.token_count = sum(c.token_count for c in chunks)
    result.char_count = sum(c.char_count for c in chunks)

    # 3) Delete any existing chunks for this doc (re-index case)
    try:
        await store.delete_chunks_for_document(
            document_id=document_id,
            token=token,
            use_service_role=use_service_role,
        )
    except Exception as e:
        logger.debug("[rag] delete prior chunks failed (ok if first ingest): %s", e)

    # 4) Insert chunks
    chunk_rows = [c.to_dict() for c in chunks]
    try:
        inserted = await store.upsert_chunks(
            document_id=document_id,
            chunks=chunk_rows,
            token=token,
            use_service_role=use_service_role,
        )
    except Exception as e:
        result.error = f"Chunk insert failed: {e}"
        return result

    # 5) Embed
    provider = get_embedding_provider()
    result.model_used = provider.name
    result.dimensions = provider.dimensions
    chunk_id_to_text = {row["id"]: chunks[i].chunk_text for i, row in enumerate(inserted) if row.get("id")}
    chunk_ids = list(chunk_id_to_text.keys())
    chunk_texts = [chunk_id_to_text[cid] for cid in chunk_ids]

    embedding_count = 0
    if chunk_texts:
        try:
            # Batch in groups of 32 to keep memory and API limits in check
            batch_size = int(os.getenv("RAG_EMBED_BATCH_SIZE", "32"))
            for i in range(0, len(chunk_texts), batch_size):
                batch_texts = chunk_texts[i : i + batch_size]
                batch_ids = chunk_ids[i : i + batch_size]
                vectors = provider.embed_batch(batch_texts)
                if len(vectors) != len(batch_texts):
                    logger.warning(
                        "[rag] embedding batch size mismatch: %d texts vs %d vectors",
                        len(batch_texts),
                        len(vectors),
                    )
                    continue
                pairs = list(zip(batch_ids, vectors))
                inserted_count = await store.upsert_embeddings(
                    document_id=document_id,
                    chunk_embeddings=pairs,
                    model_name=provider.name,
                    dimensions=provider.dimensions,
                    token=token,
                    use_service_role=use_service_role,
                )
                embedding_count += inserted_count
        except Exception as e:
            logger.warning("[rag] embedding failed for doc %s: %s", document_id, e)
            # Not fatal — chunks are still searchable via keyword fallback
    result.embedding_count = embedding_count

    # 6) Update document stats + extracted_text
    try:
        await store._update(
            "knowledge_documents",
            {"id": document_id},
            {
                "extracted_text": full_text[:50000],  # cap to avoid huge rows
                "chunk_count": result.chunk_count,
                "token_count": result.token_count,
                "file_size_bytes": len(content),
                "mime_type": mime_type,
            },
            token=token,
            use_service_role=use_service_role,
        )
        await store.update_document_stats(
            document_id=document_id,
            token=token,
            use_service_role=use_service_role,
        )
    except Exception as e:
        logger.warning("[rag] document stats update failed: %s", e)

    return result


async def reindex_document(
    document_id: str,
    content: bytes,
    filename: str,
    mime_type: Optional[str],
    token: Optional[str] = None,
    use_service_role: bool = False,
) -> IngestResult:
    """Re-run chunking + embedding for an existing document."""
    return await ingest_document(
        document_id=document_id,
        content=content,
        filename=filename,
        mime_type=mime_type,
        token=token,
        use_service_role=use_service_role,
    )


async def ingest_in_background(
    document_id: str,
    content: bytes,
    filename: str,
    mime_type: Optional[str],
    token: Optional[str] = None,
    use_service_role: bool = False,
) -> asyncio.Task:
    """Fire-and-forget background ingest. Returns the asyncio Task."""
    return asyncio.create_task(
        ingest_document(
            document_id=document_id,
            content=content,
            filename=filename,
            mime_type=mime_type,
            token=token,
            use_service_role=use_service_role,
        )
    )
