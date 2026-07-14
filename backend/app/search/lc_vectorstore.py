"""LangChain ``VectorStore`` over the existing ArangoDB ``content_vectors`` collection.

A thin retrieve-only wrapper: it reuses the same brute-force numpy cosine that
``semantic_search`` already runs (no external vector DB — ArangoDB stays the source of
truth). Indexing stays in ``semantic_search.ensure_index``; this store does not write.

Each returned ``Document`` carries the 1-based ordinal ``n`` in metadata so the retrieval
chain can preserve ``[1] [2] …`` citation numbering. ``as_retriever`` (inherited) makes it
pluggable into an LCEL chain.
"""

from __future__ import annotations

from typing import Any, Iterable

import numpy as np
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.vectorstores import VectorStore


def _load_matrix(db, doc: str | None):
    rows = list(
        db.aql.execute(
            "FOR v IN content_vectors FILTER (@doc == null OR v.docId == @doc) "
            "RETURN {sectionKey: v.sectionKey, heading: v.heading, pageStart: v.pageStart, "
            "pageEnd: v.pageEnd, text: v.text, embedding: v.embedding}",
            bind_vars={"doc": doc},
        )
    )
    if not rows:
        return [], None
    mat = np.asarray([r["embedding"] for r in rows], dtype=np.float32)
    return rows, mat


class ArangoContentVectorStore(VectorStore):
    """Read-only LangChain vector store over ``content_vectors`` (in-memory cosine)."""

    def __init__(self, db: Any, embedding: Embeddings, doc: str | None = None) -> None:
        self._db = db
        self._embedding = embedding
        self._doc = doc

    @property
    def embeddings(self) -> Embeddings:
        return self._embedding

    def similarity_search_with_score(
        self, query: str, k: int = 6, **kwargs: Any
    ) -> list[tuple[Document, float]]:
        if not (query or "").strip():
            return []
        rows, mat = _load_matrix(self._db, self._doc)
        if mat is None:
            return []
        q = np.asarray(self._embedding.embed_query(query), dtype=np.float32)
        sims = (mat @ q) / (np.linalg.norm(mat, axis=1) * (np.linalg.norm(q) + 1e-9) + 1e-9)
        top = np.argsort(-sims)[:k]
        out: list[tuple[Document, float]] = []
        for n, i in enumerate(top, start=1):
            r = rows[int(i)]
            doc = Document(
                page_content=r.get("text") or "",
                metadata={
                    "n": n,
                    "sectionKey": r.get("sectionKey"),
                    "heading": r.get("heading"),
                    "pageStart": r.get("pageStart"),
                    "pageEnd": r.get("pageEnd"),
                },
            )
            out.append((doc, round(float(sims[int(i)]), 3)))
        return out

    def similarity_search(self, query: str, k: int = 6, **kwargs: Any) -> list[Document]:
        return [d for d, _ in self.similarity_search_with_score(query, k=k, **kwargs)]

    def add_texts(self, texts: Iterable[str], metadatas: list[dict] | None = None, **kwargs: Any):
        raise NotImplementedError("Indexing is handled by semantic_search.ensure_index")

    @classmethod
    def from_texts(cls, texts, embedding, metadatas=None, **kwargs):
        raise NotImplementedError(
            "Build via ensure_index(...) then ArangoContentVectorStore(db, embedding, doc)"
        )
