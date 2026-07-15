"""LangChain ``VectorStore`` over the Postgres ``content_vectors`` table (pgvector).

A thin retrieve-only wrapper: cosine nearest-neighbour is done in Postgres with pgvector's
``<=>`` operator (HNSW-indexed), so Postgres stays the single source of truth. Indexing lives
in ``semantic_search.ensure_index``; this store does not write.

Each returned ``Document`` carries the 1-based ordinal ``n`` in metadata so the retrieval
chain can preserve ``[1] [2] …`` citation numbering. ``as_retriever`` (inherited) makes it
pluggable into an LCEL chain.
"""

from __future__ import annotations

from typing import Any, Iterable

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.vectorstores import VectorStore

from app.platform.db import db


def _vec_literal(emb: list[float]) -> str:
    return "[" + ",".join(repr(float(x)) for x in emb) + "]"


class PgContentVectorStore(VectorStore):
    """Read-only LangChain vector store over ``content_vectors`` (pgvector cosine)."""

    def __init__(self, embedding: Embeddings, doc: str | None = None) -> None:
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
        q = _vec_literal(self._embedding.embed_query(query))
        with db() as conn:
            rows = conn.execute(
                'SELECT section_key AS "sectionKey", heading, page_start AS "pageStart", '
                'page_end AS "pageEnd", text, 1 - (embedding <=> %(q)s::vector) AS score '
                "FROM content_vectors WHERE (%(doc)s::text IS NULL OR doc_id = %(doc)s) "
                "ORDER BY embedding <=> %(q)s::vector LIMIT %(k)s",
                {"q": q, "doc": self._doc, "k": k},
            ).fetchall()
        out: list[tuple[Document, float]] = []
        for n, r in enumerate(rows, start=1):
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
            out.append((doc, round(float(r["score"]), 3)))
        return out

    def similarity_search(self, query: str, k: int = 6, **kwargs: Any) -> list[Document]:
        return [d for d, _ in self.similarity_search_with_score(query, k=k, **kwargs)]

    def add_texts(self, texts: Iterable[str], metadatas: list[dict] | None = None, **kwargs: Any):
        raise NotImplementedError("Indexing is handled by semantic_search.ensure_index")

    @classmethod
    def from_texts(cls, texts, embedding, metadatas=None, **kwargs):
        raise NotImplementedError(
            "Build via ensure_index(...) then PgContentVectorStore(embedding, doc)"
        )
