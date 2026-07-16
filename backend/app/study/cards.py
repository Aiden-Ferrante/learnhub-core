"""Quiz-target quality helpers shared by the concept quiz + chapter exam.

LLM-authored understanding questions live in ``concept_quiz_llm`` (cached on
``concepts.quizQuestions``) — that is the high-quality path. This module adds the two pieces
that improve the DETERMINISTIC fallback and the choice of WHAT to quiz:

- A2 (`is_quizzable`): drop fact-shaped / sentence-length "concepts" so trivia isn't quizzed.
- C  (`nearest_distractor_names`): the most confusable distractors for a concept via embedding
     nearest-neighbor (reuses the running sentence-transformers service; degrades to []).
"""

from __future__ import annotations

import re

from typing import Any

from app.search import embed_texts
from app.platform import db


# Name-token helpers (moved from search — quiz distractors are their only consumer).
_GENERIC_NAME_TOKENS = {
    "axiom", "theorem", "rule", "law", "principle", "definition", "lemma", "corollary",
    "proposition", "property", "method", "result", "notation", "the", "of", "a", "an",
    "for", "and", "to", "in", "on", "s",
}


def _sig_tokens(name: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", (name or "").lower()) if t not in _GENERIC_NAME_TOKENS and len(t) > 1}


CONCEPTS = "concepts"

# Names that signal a one-off fact/observation rather than a durable, teachable concept.
_FACT_MARKERS = ("popularity", "funding", "number of", "amount of", "percentage", "statistics")


def is_quizzable(c: dict[str, Any]) -> bool:
    """A concept worth a question: a substantive explanation, a crisp (not sentence-length) name,
    and not an obvious one-off fact/statistic. Filters the trivia that makes mechanical MCQs
    circular ('which concept does <fact> describe?' → the fact's own name)."""
    name = (c.get("name") or "").strip()
    signal = (c.get("signal") or "").strip()
    if len(signal) < 30 or not name:
        return False
    if len(name.split()) > 6:  # a descriptive phrase, not a canonical term
        return False
    if any(m in name.lower() for m in _FACT_MARKERS):
        return False
    return True


def ensure_embeddings(doc_id: str) -> None:
    """Lazily embed + cache ``name. signal`` on each concept (one batched call per doc)."""
    try:
        with db() as conn:
            rows = conn.execute(
                "SELECT key, concat(name, '. ', signal) AS text FROM concepts "
                "WHERE doc_id = %(d)s AND embedding IS NULL",
                {"d": doc_id},
            ).fetchall()
        if not rows:
            return
        embs = embed_texts([r["text"][:400] for r in rows])
        if not embs or len(embs) != len(rows):
            return
        with db() as conn:
            for r, e in zip(rows, embs):
                try:
                    conn.execute(
                        "UPDATE concepts SET embedding = %(e)s WHERE key = %(k)s",
                        {"e": e, "k": r["key"]},
                    )
                except Exception:
                    pass
    except Exception:
        pass


# Above this cosine a "distractor" is really a near-duplicate of the answer (dedup is off in
# basic mode), which would make the question ambiguous — keep distractors confusable but distinct.
_SIM_MAX = float(__import__("os").environ.get("LEARN_DISTRACTOR_SIM_MAX", "0.92"))


def _is_variant(target_name: str, other_name: str, target_tokens: set[str]) -> bool:
    """A naming variant of the target (one's distinctive tokens contain the other's) — e.g.
    'Foundation models' vs 'Foundation models (general purpose)'."""
    ot = _sig_tokens(other_name)
    if not target_tokens or not ot:
        return target_name.lower() in other_name.lower() or other_name.lower() in target_name.lower()
    return target_tokens <= ot or ot <= target_tokens


def nearest_distractor_names(doc_id: str, target_key: str, target_name: str, n: int = 6) -> list[str]:
    """The most semantically-similar-yet-DISTINCT other concept names — confusable distractors
    for the deterministic fallback. Excludes near-duplicates/variants of the answer (which would
    make the MCQ ambiguous). Returns [] if embeddings are unavailable."""
    if not doc_id:
        return []
    try:
        ensure_embeddings(doc_id)
        # Nearest by cosine distance (pgvector <=>), closest first; sim = 1 - distance.
        with db() as conn:
            rows = conn.execute(
                "WITH tgt AS (SELECT embedding FROM concepts WHERE key = %(k)s AND embedding IS NOT NULL) "
                "SELECT c.name AS name, 1 - (c.embedding <=> tgt.embedding) AS sim "
                "FROM concepts c, tgt "
                "WHERE c.doc_id = %(d)s AND c.embedding IS NOT NULL AND c.key <> %(k)s "
                "ORDER BY c.embedding <=> tgt.embedding LIMIT 100",
                {"d": doc_id, "k": target_key},
            ).fetchall()
    except Exception:
        return []
    tgt_tokens = _sig_tokens(target_name)
    out: list[str] = []
    for r in rows:
        nm, sim = r["name"], r["sim"]
        if not nm or nm == target_name:
            continue
        if sim >= _SIM_MAX or _is_variant(target_name, nm, tgt_tokens):
            continue  # near-duplicate of the answer → would be a second correct option
        if nm not in out:
            out.append(nm)
        if len(out) >= n:
            break
    return out
