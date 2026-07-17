"""Extraction quality as a number — a critic gate sampled after every extraction run.

Successor to the July 2026 /loop's throwaway gemma critic: after an extraction finishes,
sample N of the concepts it just wrote, have a local critic model judge each against the
extraction contract (grounded / informative / durable — the same rules the extraction
prompt enforces), and patch the aggregate score onto the job's ledger row next to
``outcomes``. Prompt changes then get a regression number instead of vibes.

Best-effort by design: the eval never fails or blocks the extraction, and it is skipped
when disabled (``LEARN_EXTRACT_EVAL=0``). Keyless/local — the critic is an Ollama model
(``LEARN_EVAL_MODEL``, falling back to the quiz-author model, then the default).
"""

from __future__ import annotations

import os
from typing import Any

from app.gateways import db
from app.gateways import ollama_structured_completion
from app.gateways import ConceptVerdict

EVAL_SYSTEM = (
    "You are a strict reviewer of concept-lessons extracted from a textbook. For ONE "
    "concept you are given its name, kind, signal (the distilled explanation shown to a "
    "learner), and source_sentence (the verbatim passage that is supposed to justify it). "
    "Judge three things, each strictly:\n"
    "- grounded: every claim in signal is stated in source_sentence — no added facts, "
    "numbers, or scope.\n"
    "- informative: signal EXPLAINS what the concept is or does; it is not a restatement "
    "of the name, not a vague umbrella claim ('X is powerful/important').\n"
    "- durable: the concept is a teachable, general idea a learner could define or apply "
    "elsewhere — not a one-off fact, statistic, product mention, prediction, or opinion.\n"
    "Set reason to ONE short sentence about the weakest judgment. Be strict: when in "
    "doubt, judge false."
)


def eval_enabled() -> bool:
    return os.environ.get("LEARN_EXTRACT_EVAL", "1") != "0"


def _eval_model() -> str | None:
    return (
        os.environ.get("LEARN_EVAL_MODEL")
        or os.environ.get("LEARN_QUIZ_AUTHOR_MODEL")
        or None  # None -> llm.py falls back to OLLAMA_MODEL
    )


def _sample_concepts(doc_id: str, section_keys: list[str] | None, n: int) -> list[dict[str, Any]]:
    """A deterministic sample of the scope's concepts (md5-ordered, so re-running the
    eval grades the same rows and scores stay comparable across prompt changes)."""
    with db() as conn:
        return conn.execute(
            'SELECT key, name, kind, signal, source, section_key AS "sectionKey" '
            "FROM ext_concepts WHERE doc_id = %(d)s "
            "AND (%(ks)s::text[] IS NULL OR section_key = ANY(%(ks)s::text[])) "
            "ORDER BY md5(key) LIMIT %(n)s",
            {"d": doc_id, "ks": section_keys, "n": n},
        ).fetchall()


def grade_concept(concept: dict[str, Any], model: str | None = None) -> dict[str, Any] | None:
    """One critic call. Returns the verdict dict (grounded/informative/durable/reason)
    or None when the model is unreachable/unparseable after a retry."""
    user = (
        f"Concept: {concept.get('name')}\n"
        f"Kind: {concept.get('kind')}\n"
        f"Signal: {concept.get('signal')}\n"
        f"Source passage:\n{(concept.get('source') or '').strip()}"
    )
    for _ in range(2):
        obj, _err = ollama_structured_completion(
            [{"role": "system", "content": EVAL_SYSTEM}, {"role": "user", "content": user}],
            ConceptVerdict,
            temperature=0.0,
            model=model or _eval_model(),
        )
        if isinstance(obj, dict):
            return obj
    return None


def summarize_verdicts(concepts: list[dict[str, Any]], verdicts: list[dict[str, Any] | None]) -> dict[str, Any]:
    """Aggregate per-concept verdicts into the job-row report (pure; unit-tested)."""
    graded = passed = 0
    failures: list[dict[str, Any]] = []
    for c, v in zip(concepts, verdicts):
        if v is None:
            continue
        graded += 1
        ok = bool(v.get("grounded")) and bool(v.get("informative")) and bool(v.get("durable"))
        if ok:
            passed += 1
        else:
            failures.append({
                "name": c.get("name"),
                "sectionKey": c.get("sectionKey"),
                "grounded": bool(v.get("grounded")),
                "informative": bool(v.get("informative")),
                "durable": bool(v.get("durable")),
                "reason": (v.get("reason") or "")[:200],
            })
    return {
        "sampled": len(concepts),
        "graded": graded,
        "passed": passed,
        "score": round(passed / graded, 3) if graded else None,
        "failures": failures[:20],
    }


def evaluate_extraction_sample(
    doc_id: str, section_keys: list[str] | None = None, sample_n: int = 8, model: str | None = None
) -> dict[str, Any] | None:
    """Grade a sample of the scope's freshly-written concepts. Returns the report for the
    job row, or None when there is nothing to grade."""
    concepts = _sample_concepts(doc_id, section_keys, max(1, sample_n))
    if not concepts:
        return None
    use_model = model or _eval_model()
    verdicts = [grade_concept(c, use_model) for c in concepts]
    report = summarize_verdicts(concepts, verdicts)
    report["model"] = use_model or "default"
    return report
