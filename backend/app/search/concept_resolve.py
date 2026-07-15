"""Concept-embedding helpers over the GPU ``sentence-transformers`` service.

``embed_texts`` (the ``/embed`` HTTP client, degrade-to-None on failure) plus the pure
cosine/name-token helpers used by the card distractor picker and semantic search. The
embedding-based within-document dedup pass that once lived here was never invoked and
was removed with the triple pipeline (docs/aposd-review-2026-07-09.md).
"""

from __future__ import annotations

import json
import math
import os
import re
import urllib.request

# The embedding service is reachable by compose hostname even though the learn container has
# no env var for it (verified: learn -> http://sentence-transformers:80/health = 200).
_EMBED_URL = (os.environ.get("SENTENCE_TRANSFORMER_URL") or "http://sentence-transformers:80").rstrip("/")

# Generic words that don't distinguish one concept from another — ignored when comparing names
# so "Decomposition Axiom" vs "Intersection Axiom" compare as {decomposition} vs {intersection}.


def embed_texts(texts: list[str], timeout: int = 60) -> list[list[float]] | None:
    """POST to the sentence-transformers ``/embed`` endpoint. Returns the embeddings, or
    ``None`` if the service is unreachable (caller then degrades to no dedup)."""
    if not texts:
        return []
    try:
        req = urllib.request.Request(
            f"{_EMBED_URL}/embed",
            data=json.dumps({"texts": texts}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp).get("embeddings")
    except Exception:  # noqa: BLE001 — any failure = degrade, never break extraction
        return None


