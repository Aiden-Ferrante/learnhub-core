"""LangChain ``Embeddings`` over the existing sentence-transformers service (keyless, local).

Wraps the same ``/embed`` HTTP endpoint that ``concept_resolve.embed_texts`` uses
(MiniLM, 384-d), so the vector store / retrieval chain can speak the LangChain
``Embeddings`` interface without a new model or any API key.

Used only by the retrieval path (``lc_vectorstore`` / ``semantic_search.ask``). The
concept-dedup path keeps calling ``embed_texts`` directly because it relies on a
``None``-degrades-to-no-dedup contract that the list-returning ``Embeddings`` interface
can't express; here a failure raises, and the retrieval caller wraps it in try/except.
"""

from __future__ import annotations

import json
import os
import urllib.request

from langchain_core.embeddings import Embeddings

_EMBED_URL = (os.environ.get("SENTENCE_TRANSFORMER_URL") or "http://sentence-transformers:80").rstrip("/")


class SentenceTransformerEmbeddings(Embeddings):
    """Embeddings backed by the shared sentence-transformers ``/embed`` endpoint."""

    def __init__(self, url: str | None = None, timeout: int = 60) -> None:
        self._url = (url or _EMBED_URL).rstrip("/")
        self._timeout = timeout

    def _embed(self, texts: list[str]) -> list[list[float]]:
        req = urllib.request.Request(
            f"{self._url}/embed",
            data=json.dumps({"texts": texts}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self._timeout) as resp:
            embs = json.load(resp).get("embeddings")
        if not embs or len(embs) != len(texts):
            raise RuntimeError("sentence-transformers /embed returned no embeddings")
        return embs

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return self._embed(list(texts))

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text])[0]
