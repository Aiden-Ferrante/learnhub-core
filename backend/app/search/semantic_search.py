"""Lean semantic search + grounded answer over the content layer — the keyless replacement for
the old (empty) qdrant RAG.

Embeds each ``section_content`` block once (via the already-running sentence-transformers MiniLM,
384-d) into the ``content_vectors`` table, then answers queries with pgvector cosine (``<=>``,
HNSW-indexed) — Postgres is the one store, no separate vector DB. ``ask()`` retrieves the top
passages and has Ollama write a grounded, cited answer. Everything local/keyless.
"""

from __future__ import annotations

from typing import Any

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from app.platform.db import db
from app.search.concept_resolve import embed_texts
from app.platform.llm import get_chat_model

VECTORS = "content_vectors"
SECTION_CONTENT = "section_content"
_BATCH = 64
_EMBED_CHARS = 1200  # how much of each block we embed (MiniLM truncates long inputs anyway)
_STORE_CHARS = 2400  # how much block text we keep for answer context


def _vec_literal(emb: list[float]) -> str:
    """pgvector text literal for an embedding — ``[0.1,0.2,…]`` (cast ``::vector`` in SQL)."""
    return "[" + ",".join(repr(float(x)) for x in emb) + "]"

ANSWER_SYSTEM = (
    "You answer questions strictly from the provided textbook passages. Rules:\n"
    "- Use ONLY the sources; do not add outside facts. If the sources don't answer it, say so.\n"
    "- Cite the passages you use inline as [1], [2], … matching the source numbers.\n"
    "- Be concise and direct; prefer the book's own terminology.\n"
    "- If sources conflict or are partial, say what they do and don't establish."
)


def index_status(doc: str | None = None) -> dict[str, Any]:
    """How many of a doc's content blocks are embedded yet."""
    with db() as conn:
        total = conn.execute(
            "SELECT count(*) AS n FROM section_content "
            "WHERE (%(doc)s::text IS NULL OR doc_id = %(doc)s) AND markdown IS NOT NULL",
            {"doc": doc},
        ).fetchone()["n"]
        indexed = conn.execute(
            "SELECT count(*) AS n FROM content_vectors "
            "WHERE (%(doc)s::text IS NULL OR doc_id = %(doc)s)",
            {"doc": doc},
        ).fetchone()["n"]
    return {"docId": doc, "total": total, "indexed": indexed}


def ensure_index(doc: str | None = None, limit: int = 100000) -> dict[str, Any]:
    """Embed every not-yet-embedded content block (optionally scoped to ``doc``). Idempotent —
    keyed by the block's own key, so re-running only fills gaps. Returns counts."""
    with db() as conn:
        rows = conn.execute(
            'SELECT key, doc_id AS "docId", section_key AS "sectionKey", heading, '
            'page_start AS "pageStart", page_end AS "pageEnd", markdown AS text '
            "FROM section_content b WHERE (%(doc)s::text IS NULL OR doc_id = %(doc)s) "
            "AND markdown IS NOT NULL "
            "AND NOT EXISTS (SELECT 1 FROM content_vectors v WHERE v.key = b.key) "
            "LIMIT %(lim)s",
            {"doc": doc, "lim": limit},
        ).fetchall()
    indexed = 0
    for i in range(0, len(rows), _BATCH):
        batch = rows[i : i + _BATCH]
        texts = [f"{r.get('heading') or ''}\n{(r.get('text') or '')[:_EMBED_CHARS]}".strip() for r in batch]
        embs = embed_texts(texts)
        if not embs or len(embs) != len(batch):
            return {**index_status(doc), "error": "embedder unavailable", "indexed_now": indexed}
        params = [
            {
                "key": r["key"],
                "doc_id": r["docId"],
                "section_key": r.get("sectionKey"),
                "heading": r.get("heading"),
                "page_start": r.get("pageStart"),
                "page_end": r.get("pageEnd"),
                "text": (r.get("text") or "")[:_STORE_CHARS],
                "embedding": _vec_literal(embs[j]),
            }
            for j, r in enumerate(batch)
        ]
        with db() as conn, conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO content_vectors "
                "(key, doc_id, section_key, heading, page_start, page_end, text, embedding) "
                "VALUES (%(key)s, %(doc_id)s, %(section_key)s, %(heading)s, %(page_start)s, "
                "%(page_end)s, %(text)s, %(embedding)s::vector) "
                "ON CONFLICT (key) DO UPDATE SET doc_id = EXCLUDED.doc_id, "
                "section_key = EXCLUDED.section_key, heading = EXCLUDED.heading, "
                "page_start = EXCLUDED.page_start, page_end = EXCLUDED.page_end, "
                "text = EXCLUDED.text, embedding = EXCLUDED.embedding",
                params,
            )
        indexed += len(batch)
    return {**index_status(doc), "indexed_now": indexed}


def _top_matches(query: str, doc: str | None, k: int) -> tuple[list[dict[str, Any]], int]:
    """The one retrieval path (search + ask): embed the query, pgvector-cosine top-k.
    Returns ``(rows, indexed_count)``; raises RuntimeError when the embedder is down."""
    qv = embed_texts([query])
    if not qv:
        raise RuntimeError("embedder unavailable")
    q = _vec_literal(qv[0])
    with db() as conn:
        indexed = conn.execute(
            "SELECT count(*) AS n FROM content_vectors "
            "WHERE (%(doc)s::text IS NULL OR doc_id = %(doc)s)",
            {"doc": doc},
        ).fetchone()["n"]
        if not indexed:
            return [], 0
        rows = conn.execute(
            'SELECT section_key AS "sectionKey", heading, page_start AS "pageStart", '
            'page_end AS "pageEnd", text, 1 - (embedding <=> %(q)s::vector) AS score '
            "FROM content_vectors WHERE (%(doc)s::text IS NULL OR doc_id = %(doc)s) "
            "ORDER BY embedding <=> %(q)s::vector LIMIT %(k)s",
            {"q": q, "doc": doc, "k": k},
        ).fetchall()
    return rows, indexed


def semantic_search(query: str, doc: str | None = None, k: int = 8) -> dict[str, Any]:
    """Embed the query and return the top-k most similar content blocks by pgvector cosine."""
    if not (query or "").strip():
        return {"matches": [], "error": "empty query"}
    try:
        rows, indexed = _top_matches(query, doc, k)
    except RuntimeError as e:
        return {"matches": [], "error": str(e)}
    if not indexed:
        return {"matches": [], "indexed": 0, "hint": "no embeddings yet — call ensure_index for this doc"}
    matches = [
        {
            "sectionKey": r["sectionKey"],
            "heading": r["heading"],
            "pageStart": r["pageStart"],
            "pageEnd": r["pageEnd"],
            "score": round(float(r["score"]), 3),
            "snippet": (r["text"] or "")[:300].strip(),
            "text": r["text"],
        }
        for r in rows
    ]
    return {"query": query, "matches": matches, "indexed": indexed}


_ASK_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", ANSWER_SYSTEM),
        ("human", "Question: {query}\n\nSources:\n{context}\n\nAnswer using only the sources above, citing [n]."),
    ]
)


def _format_context(rows: list[dict[str, Any]]) -> str:
    """Numbered source block the answer cites against — `[n] (p.X, heading)` then the passage."""
    return "\n\n".join(
        f"[{n}] (p.{r.get('pageStart')}, {r.get('heading') or r.get('sectionKey')})\n"
        f"{(r.get('text') or '')[:1200]}"
        for n, r in enumerate(rows, start=1)
    )


def ask(query: str, doc: str | None = None, k: int = 6, model: str | None = None) -> dict[str, Any]:
    """Retrieve the top passages (same pgvector path as ``semantic_search``) and have Ollama
    answer grounded in them, via the LCEL prompt chain. Citations are assembled from the
    retrieved rows outside the LLM step so the [1][2] numbering matches the sources."""
    if not (query or "").strip():
        return {"answer": None, "citations": [], "error": "empty query"}
    try:
        rows, indexed = _top_matches(query, doc, k)
    except Exception as e:  # noqa: BLE001 — embedder/db down → graceful error
        return {"answer": None, "citations": [], "error": str(e)}
    if not rows:
        return {
            "answer": None,
            "citations": [],
            "error": "no embeddings yet — call ensure_index for this doc",
        }

    chain = _ASK_PROMPT | get_chat_model(model=model, temperature=0.3) | StrOutputParser()
    try:
        answer = chain.invoke({"query": query, "context": _format_context(rows)})
    except Exception as e:  # noqa: BLE001
        return {"answer": None, "citations": [], "error": str(e)}

    citations = [
        {
            "n": n,
            "sectionKey": r.get("sectionKey"),
            "heading": r.get("heading"),
            "page": r.get("pageStart"),
        }
        for n, r in enumerate(rows, start=1)
    ]
    return {"query": query, "answer": answer, "citations": citations}
