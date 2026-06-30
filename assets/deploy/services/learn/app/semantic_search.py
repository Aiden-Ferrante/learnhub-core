"""Lean semantic search + grounded answer over the content layer — the keyless replacement for
the old (empty) qdrant RAG.

Embeds each ``section_content`` block once (via the already-running sentence-transformers MiniLM,
384-d) into a ``content_vectors`` collection, then answers queries by brute-force cosine in numpy
— no vector DB needed at a few-thousand blocks. ``ask()`` retrieves the top passages and has
Ollama write a grounded, cited answer. Everything local/keyless.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.concept_resolve import embed_texts
from app.llm import ollama_chat_completion

VECTORS = "content_vectors"
SECTION_CONTENT = "section_content"
_BATCH = 64
_EMBED_CHARS = 1200  # how much of each block we embed (MiniLM truncates long inputs anyway)
_STORE_CHARS = 2400  # how much block text we keep for answer context

ANSWER_SYSTEM = (
    "You answer questions strictly from the provided textbook passages. Rules:\n"
    "- Use ONLY the sources; do not add outside facts. If the sources don't answer it, say so.\n"
    "- Cite the passages you use inline as [1], [2], … matching the source numbers.\n"
    "- Be concise and direct; prefer the book's own terminology.\n"
    "- If sources conflict or are partial, say what they do and don't establish."
)


def ensure_vectors_collection(db) -> None:
    if not db.has_collection(VECTORS):
        db.create_collection(VECTORS)
        db.collection(VECTORS).add_persistent_index(fields=["docId"], sparse=False)


def index_status(db, doc: str | None = None) -> dict[str, Any]:
    """How many of a doc's content blocks are embedded yet."""
    total = db.aql.execute(
        "RETURN LENGTH(FOR b IN section_content FILTER (@doc == null OR b.docId == @doc) "
        "AND b.markdown != null RETURN 1)",
        bind_vars={"doc": doc},
    ).next()
    indexed = (
        db.aql.execute(
            "RETURN LENGTH(FOR v IN content_vectors FILTER (@doc == null OR v.docId == @doc) RETURN 1)",
            bind_vars={"doc": doc},
        ).next()
        if db.has_collection(VECTORS)
        else 0
    )
    return {"docId": doc, "total": total, "indexed": indexed}


def ensure_index(db, doc: str | None = None, limit: int = 100000) -> dict[str, Any]:
    """Embed every not-yet-embedded content block (optionally scoped to ``doc``). Idempotent —
    keyed by the block's own ``_key``, so re-running only fills gaps. Returns counts."""
    ensure_vectors_collection(db)
    rows = list(
        db.aql.execute(
            "LET have = (FOR v IN content_vectors FILTER (@doc == null OR v.docId == @doc) RETURN v._key) "
            "FOR b IN section_content FILTER (@doc == null OR b.docId == @doc) AND b.markdown != null "
            "AND b._key NOT IN have LIMIT @lim "
            "RETURN {key: b._key, docId: b.docId, sectionKey: b.sectionKey, heading: b.heading, "
            "pageStart: b.pageStart, pageEnd: b.pageEnd, text: b.markdown}",
            bind_vars={"doc": doc, "lim": limit},
        )
    )
    col = db.collection(VECTORS)
    indexed = 0
    for i in range(0, len(rows), _BATCH):
        batch = rows[i : i + _BATCH]
        texts = [f"{r.get('heading') or ''}\n{(r.get('text') or '')[:_EMBED_CHARS]}".strip() for r in batch]
        embs = embed_texts(texts)
        if not embs or len(embs) != len(batch):
            return {**index_status(db, doc), "error": "embedder unavailable", "indexed_now": indexed}
        col.import_bulk(
            [
                {
                    "_key": r["key"],
                    "docId": r["docId"],
                    "sectionKey": r.get("sectionKey"),
                    "heading": r.get("heading"),
                    "pageStart": r.get("pageStart"),
                    "pageEnd": r.get("pageEnd"),
                    "text": (r.get("text") or "")[:_STORE_CHARS],
                    "embedding": embs[j],
                }
                for j, r in enumerate(batch)
            ],
            on_duplicate="replace",
        )
        indexed += len(batch)
    return {**index_status(db, doc), "indexed_now": indexed}


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


def semantic_search(db, query: str, doc: str | None = None, k: int = 8) -> dict[str, Any]:
    """Embed the query and return the top-k most similar content blocks by cosine."""
    if not (query or "").strip():
        return {"matches": [], "error": "empty query"}
    qv = embed_texts([query])
    if not qv:
        return {"matches": [], "error": "embedder unavailable"}
    rows, mat = _load_matrix(db, doc)
    if mat is None:
        return {"matches": [], "indexed": 0, "hint": "no embeddings yet — call ensure_index for this doc"}
    q = np.asarray(qv[0], dtype=np.float32)
    sims = (mat @ q) / (np.linalg.norm(mat, axis=1) * (np.linalg.norm(q) + 1e-9) + 1e-9)
    top = np.argsort(-sims)[:k]
    matches = [
        {
            "sectionKey": rows[int(i)]["sectionKey"],
            "heading": rows[int(i)]["heading"],
            "pageStart": rows[int(i)]["pageStart"],
            "pageEnd": rows[int(i)]["pageEnd"],
            "score": round(float(sims[int(i)]), 3),
            "snippet": (rows[int(i)]["text"] or "")[:300].strip(),
            "text": rows[int(i)]["text"],
        }
        for i in top
    ]
    return {"query": query, "matches": matches, "indexed": len(rows)}


def ask(db, query: str, doc: str | None = None, k: int = 6, model: str | None = None) -> dict[str, Any]:
    """Retrieve the top passages and have Ollama answer the question grounded in them, with
    inline [n] citations. Returns {answer, citations, matches}."""
    res = semantic_search(db, query, doc, k)
    matches = res.get("matches") or []
    if not matches:
        return {"answer": None, "citations": [], "error": res.get("error") or res.get("hint") or "no matches"}
    context = "\n\n".join(
        f"[{i + 1}] (p.{m.get('pageStart')}, {m.get('heading') or m.get('sectionKey')})\n"
        f"{(m.get('text') or '')[:1200]}"
        for i, m in enumerate(matches)
    )
    user = f"Question: {query}\n\nSources:\n{context}\n\nAnswer using only the sources above, citing [n]."
    answer, err = ollama_chat_completion(
        [{"role": "system", "content": ANSWER_SYSTEM}, {"role": "user", "content": user}],
        temperature=0.3,
        model=model,
    )
    if err:
        return {"answer": None, "citations": [], "error": err}
    citations = [
        {"n": i + 1, "sectionKey": m.get("sectionKey"), "heading": m.get("heading"), "page": m.get("pageStart")}
        for i, m in enumerate(matches)
    ]
    return {"query": query, "answer": answer, "citations": citations}
