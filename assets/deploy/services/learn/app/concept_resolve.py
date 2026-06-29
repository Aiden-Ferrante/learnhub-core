"""Within-document concept resolution: merge duplicate concepts (the same idea taught or
referenced across several sections) into ONE canonical concept by embedding similarity.

Non-destructive: every concept row gets a ``canonicalKey`` (the representative's ``_key``;
the representative points to itself). Reads group by ``canonicalKey``; all section/page
provenance is kept. Degrades to a no-op (each concept canonical to itself) when the embedding
service is unavailable, so extraction never hard-breaks.

Reuses the already-running GPU ``sentence-transformers`` service (MiniLM) via ``/embed``.
The clustering is a pure, unit-testable function; only ``embed_texts`` and the DB write touch
the outside world.
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
_DEFAULT_SIM = float(os.environ.get("LEARN_CONCEPT_SIM", "0.85"))

_ALPHA = re.compile(r"[a-z]")

# Generic words that don't distinguish one concept from another — ignored when comparing names
# so "Decomposition Axiom" vs "Intersection Axiom" compare as {decomposition} vs {intersection}.
_GENERIC_NAME_TOKENS = {
    "axiom", "theorem", "rule", "law", "principle", "definition", "lemma", "corollary",
    "proposition", "property", "method", "result", "notation", "the", "of", "a", "an",
    "for", "and", "to", "in", "on", "s",
}


def _alpha_len(name: str) -> int:
    return len(_ALPHA.findall((name or "").lower()))


def is_notation(name: str) -> bool:
    """A name that is essentially a single letter / short notation (X, Z, P, σ) is too
    polysemous to merge on — the X/Y/Z guard from the prerequisite-learning literature."""
    return _alpha_len(name) <= 2


def _sig_tokens(name: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", (name or "").lower()) if t not in _GENERIC_NAME_TOKENS and len(t) > 1}


def names_compatible(a: str, b: str) -> bool:
    """True unless the two names carry DIFFERENT distinctive words. Blocks merging distinct
    same-kind concepts with similar signals (Decomposition vs Intersection axiom); allows true
    duplicates, which the extractor canonicalises to the same/overlapping name. Falls back to
    permissive when a name has no distinctive token (rely on the embedding then)."""
    ta, tb = _sig_tokens(a), _sig_tokens(b)
    if not ta or not tb:
        return True
    return bool(ta & tb) or ta <= tb or tb <= ta


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


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def cluster_duplicates(
    concepts: list[dict],
    embeddings: list[list[float]],
    ranks: dict[str, int],
    threshold: float,
) -> dict[str, str]:
    """Pure: union concepts whose embeddings are >= ``threshold`` AND share a ``kind`` AND are
    not bare notation; return ``{concept_key: canonical_key}``. The canonical representative of
    a group is a ``definition`` if present, else the earliest in reading order, else the one
    with the fullest signal."""
    keys = [c["key"] for c in concepts]
    parent = {k: k for k in keys}

    def find(x: str) -> str:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:  # path compression
            parent[x], x = root, parent[x]
        return root

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    n = len(concepts)
    for i in range(n):
        for j in range(i + 1, n):
            ci, cj = concepts[i], concepts[j]
            if ci["kind"] != cj["kind"]:
                continue
            if is_notation(ci["name"]) or is_notation(cj["name"]):
                continue
            if not names_compatible(ci["name"], cj["name"]):
                continue
            if _cosine(embeddings[i], embeddings[j]) >= threshold:
                union(ci["key"], cj["key"])

    groups: dict[str, list[dict]] = {}
    for c in concepts:
        groups.setdefault(find(c["key"]), []).append(c)

    canonical: dict[str, str] = {}
    for members in groups.values():
        rep = min(
            members,
            key=lambda c: (
                0 if c.get("kind") == "definition" else 1,
                ranks.get(c["key"], 1_000_000),
                -len(c.get("signal") or ""),
            ),
        )
        for c in members:
            canonical[c["key"]] = rep["key"]
    return canonical


def _write_canonical(db, canonical: dict[str, str]) -> None:
    items = [{"key": k, "canon": v} for k, v in canonical.items()]
    if not items:
        return
    db.aql.execute(
        "FOR it IN @items UPDATE it.key WITH { canonicalKey: it.canon } IN concepts",
        bind_vars={"items": items},
    )


def resolve_concepts_document(
    db, doc_id: str, ranks: dict[str, int] | None = None, threshold: float | None = None
) -> dict:
    """Tag every concept of a document with a ``canonicalKey`` (within-document dedup).
    Idempotent and re-runnable. If the embedding service is down, each concept is made
    canonical to itself (no merges) so extraction still completes."""
    threshold = _DEFAULT_SIM if threshold is None else threshold
    ranks = ranks or {}
    rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d "
            "RETURN {key: c._key, name: c.name, kind: c.kind, signal: c.signal}",
            bind_vars={"d": doc_id},
        )
    )
    if not rows:
        return {"concepts": 0, "canonical": 0, "merged": 0, "embedded": False}

    texts = [f"{r['name']}: {r.get('signal') or ''}" for r in rows]
    embeddings = embed_texts(texts)
    if not embeddings or len(embeddings) != len(rows):
        _write_canonical(db, {r["key"]: r["key"] for r in rows})
        return {"concepts": len(rows), "canonical": len(rows), "merged": 0, "embedded": False}

    canonical = cluster_duplicates(rows, embeddings, ranks, threshold)
    _write_canonical(db, canonical)
    n_canon = len(set(canonical.values()))
    return {
        "concepts": len(rows),
        "canonical": n_canon,
        "merged": len(rows) - n_canon,
        "embedded": True,
    }
