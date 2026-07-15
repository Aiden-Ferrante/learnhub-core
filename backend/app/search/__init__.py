"""Search — embeddings + retrieval over the content layer.

Owns: the sentence-transformers embedding client (concept_resolve) and pgvector
semantic search + the grounded ask() answerer (semantic_search). Depends on:
platform.
"""

from app.search.concept_resolve import embed_texts
from app.search.semantic_search import ask, ensure_index, index_status, semantic_search

__all__ = [
    "ask",
    "embed_texts",
    "ensure_index",
    "index_status",
    "semantic_search",
]
