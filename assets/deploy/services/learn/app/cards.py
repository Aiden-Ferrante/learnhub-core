"""Quiz-target quality helpers shared by the concept quiz + chapter exam.

LLM-authored understanding questions live in ``concept_quiz_llm`` (cached on
``concepts.quizQuestions``) — that is the high-quality path. This module adds the two pieces
that improve the DETERMINISTIC fallback and the choice of WHAT to quiz:

- A2 (`is_quizzable`): drop fact-shaped / sentence-length "concepts" so trivia isn't quizzed.
- C  (`nearest_distractor_names`): the most confusable distractors for a concept via embedding
     nearest-neighbor (reuses the running sentence-transformers service; degrades to []).
"""

from __future__ import annotations

from typing import Any

from app.concept_resolve import _cosine, _sig_tokens, embed_texts

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


def ensure_embeddings(db, doc_id: str) -> None:
    """Lazily embed + cache ``name. signal`` on each concept (one batched call per doc)."""
    try:
        if not db.has_collection(CONCEPTS):
            return
        rows = list(
            db.aql.execute(
                "FOR c IN concepts FILTER c.docId == @d AND c.embedding == null "
                "RETURN {key: c._key, text: CONCAT(c.name, '. ', c.signal)}",
                bind_vars={"d": doc_id},
            )
        )
        if not rows:
            return
        embs = embed_texts([r["text"][:400] for r in rows])
        if not embs or len(embs) != len(rows):
            return
        col = db.collection(CONCEPTS)
        for r, e in zip(rows, embs):
            try:
                col.update({"_key": r["key"], "embedding": e})
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


def nearest_distractor_names(db, doc_id: str, target_key: str, target_name: str, n: int = 6) -> list[str]:
    """The most semantically-similar-yet-DISTINCT other concept names — confusable distractors
    for the deterministic fallback. Excludes near-duplicates/variants of the answer (which would
    make the MCQ ambiguous). Returns [] if embeddings are unavailable."""
    if not doc_id:
        return []
    try:
        ensure_embeddings(db, doc_id)
        rows = list(
            db.aql.execute(
                "FOR c IN concepts FILTER c.docId == @d AND c.embedding != null "
                "RETURN {key: c._key, name: c.name, emb: c.embedding}",
                bind_vars={"d": doc_id},
            )
        )
    except Exception:
        return []
    tgt = next((r for r in rows if r["key"] == target_key), None)
    if not tgt:
        return []
    tgt_tokens = _sig_tokens(target_name)
    scored: list[tuple[float, str]] = []
    for r in rows:
        if r["key"] == target_key or not r["name"] or r["name"] == target_name:
            continue
        sim = _cosine(tgt["emb"], r["emb"])
        if sim >= _SIM_MAX or _is_variant(target_name, r["name"], tgt_tokens):
            continue  # near-duplicate of the answer → would be a second correct option
        scored.append((sim, r["name"]))
    scored.sort(key=lambda x: x[0], reverse=True)
    out: list[str] = []
    for _s, nm in scored:
        if nm not in out:
            out.append(nm)
        if len(out) >= n:
            break
    return out
