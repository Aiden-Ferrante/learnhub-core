"""Exam question generation: deterministic builder + optional Ollama enrichment.

This module is intentionally free of database/HTTP imports at module scope so the
pure generation logic can be unit-tested without ArangoDB or Ollama. The Ollama
client is imported lazily inside ``generate_llm_questions``.

A *question* is a dict with the full server-side shape::

    {
      "id": "q1",
      "stem": str,
      "choices": [str, str, str, str],
      "answer_index": int,        # correct index into choices
      "expected": str,            # choices[answer_index]
      "explanation": str,
      "triple": {subject,predicate,object} | None,
      "source": "deterministic" | "llm",
    }

Use ``public_question`` to produce the client-facing form (answers withheld).
"""

from __future__ import annotations

import json
import os
import random
from typing import Any

Triple = dict[str, str]
Question = dict[str, Any]


def _quiz_llm_enabled() -> bool:
    """Whether quizzes may call the LLM to author questions. Default OFF — quizzes use the
    deterministic triple-based builder so no Ollama model is loaded for studying (concept
    extraction stays the only LLM workload). Set ``LEARN_QUIZ_LLM=1`` to re-enable."""
    return os.environ.get("LEARN_QUIZ_LLM", "0").strip().lower() in ("1", "true", "yes", "on")

MAX_LLM_TRIPLE_LINES = 80

EXAM_AUTHOR_SYSTEM = (
    "You are an exam author. Using ONLY the knowledge-graph triples provided "
    "(each line is `subject | predicate | object`), write multiple-choice exam "
    "questions that check understanding of the material.\n"
    "Rules:\n"
    "- Each question tests exactly one fact supported by the triples.\n"
    "- Provide exactly 4 options: one correct answer and three plausible but "
    "wrong distractors drawn from other entities in the triples.\n"
    "- Do not invent facts outside the triples.\n"
    "- Output STRICT JSON only, no prose, no code fences, in this exact shape:\n"
    '{"questions": [{"stem": "...", "options": ["...","...","...","..."], '
    '"answerIndex": 0, "explanation": "..."}]}'
)


# --------------------------------------------------------------------------- #
# Pure helpers (generation-local; no DB import)
# --------------------------------------------------------------------------- #

def _triple_line(t: Triple) -> str:
    return f'{t["subject"]} | {t["predicate"]} | {t["object"]}'


def _format_triples_block(triples: list[Triple], max_lines: int = MAX_LLM_TRIPLE_LINES) -> str:
    lines = [_triple_line(t) for t in triples[:max_lines]]
    body = "\n".join(lines)
    if len(triples) > max_lines:
        body += f"\n... ({len(triples) - max_lines} more triples omitted)"
    return body


def _entity_pool(triples: list[Triple], exclude: set[str]) -> list[str]:
    pool: set[str] = set()
    for t in triples:
        pool.add(t["subject"])
        pool.add(t["object"])
    pool -= exclude
    return sorted(pool, key=str.casefold)


def _predicate_pool(triples: list[Triple], exclude: set[str]) -> list[str]:
    pool: set[str] = {t["predicate"] for t in triples}
    pool -= exclude
    return sorted(pool, key=str.casefold)


def _finalize_choices(
    correct: str, distractors: list[str], rng: random.Random
) -> tuple[list[str], int]:
    """Assemble exactly 4 unique choices (correct + up to 3 distractors), padded, shuffled."""
    choices = [correct]
    for d in distractors:
        if len(choices) >= 4:
            break
        if d and d != correct and d not in choices:
            choices.append(d)
    pad = 0
    while len(choices) < 4:
        pad += 1
        choices.append(f"(none of these · {pad})")
    rng.shuffle(choices)
    return choices, choices.index(correct)


def _make_question(
    stem: str,
    choices: list[str],
    answer_index: int,
    triple: Triple | None,
    source: str,
    explanation: str | None = None,
) -> Question:
    if explanation is None:
        explanation = f"Stored triple: {_triple_line(triple)}" if triple else ""
    return {
        "stem": stem,
        "choices": choices,
        "answer_index": answer_index,
        "expected": choices[answer_index],
        "explanation": explanation,
        "triple": triple,
        "source": source,
    }


# --------------------------------------------------------------------------- #
# Deterministic question variants
# --------------------------------------------------------------------------- #

def _object_question(t: Triple, triples: list[Triple], rng: random.Random) -> Question:
    correct = t["object"]
    pool = _entity_pool(triples, {correct, t["subject"]})
    rng.shuffle(pool)
    choices, ai = _finalize_choices(correct, pool, rng)
    stem = f'In the knowledge graph: «{t["subject"]}» — {t["predicate"]} — ?'
    return _make_question(stem, choices, ai, t, "deterministic")


def _subject_question(t: Triple, triples: list[Triple], rng: random.Random) -> Question:
    correct = t["subject"]
    pool = _entity_pool(triples, {correct, t["object"]})
    rng.shuffle(pool)
    choices, ai = _finalize_choices(correct, pool, rng)
    stem = f'In the knowledge graph: ? — {t["predicate"]} — «{t["object"]}». What is the subject?'
    return _make_question(stem, choices, ai, t, "deterministic")


def _predicate_question(t: Triple, triples: list[Triple], rng: random.Random) -> Question:
    correct = t["predicate"]
    pool = _predicate_pool(triples, {correct})
    rng.shuffle(pool)
    choices, ai = _finalize_choices(correct, pool, rng)
    stem = f'Which relationship connects «{t["subject"]}» to «{t["object"]}»?'
    return _make_question(stem, choices, ai, t, "deterministic")


# object weighted x2 vs subject/predicate
_VARIANTS = (_object_question, _object_question, _subject_question, _predicate_question)


def _candidate_triples(triples: list[Triple]) -> list[Triple]:
    return [
        t
        for t in triples
        if t.get("subject") and t.get("object") and t.get("predicate")
        and t["subject"] != t["object"]
    ]


def build_deterministic_questions(
    triples: list[Triple], count: int, rng: random.Random | None = None
) -> list[Question]:
    rng = rng or random.Random()
    candidates = _candidate_triples(triples)
    rng.shuffle(candidates)
    out: list[Question] = []
    seen: set[str] = set()
    for t in candidates:
        if len(out) >= count:
            break
        builder = rng.choice(_VARIANTS)
        q = builder(t, triples, rng)
        key = q["stem"].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
    return out


# --------------------------------------------------------------------------- #
# LLM parsing / validation
# --------------------------------------------------------------------------- #

def _extract_json(text: str) -> Any:
    if not isinstance(text, str):
        return None
    t = text.strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    i, j = t.find("{"), t.rfind("}")
    if i != -1 and j != -1 and j > i:
        try:
            return json.loads(t[i : j + 1])
        except Exception:
            return None
    return None


def _validate_llm_item(item: Any) -> Question | None:
    if not isinstance(item, dict):
        return None
    stem = item.get("stem")
    options = item.get("options")
    ai = item.get("answerIndex")
    if not isinstance(stem, str) or not stem.strip():
        return None
    if not isinstance(options, list) or len(options) != 4:
        return None
    opts = [o.strip() for o in options if isinstance(o, str) and o.strip()]
    if len(opts) != 4 or len(set(opts)) != 4:
        return None
    # bool is a subclass of int — reject it explicitly
    if isinstance(ai, bool) or not isinstance(ai, int) or not (0 <= ai < 4):
        return None
    explanation = item.get("explanation")
    explanation = explanation.strip() if isinstance(explanation, str) else ""
    return _make_question(stem.strip(), opts, ai, None, "llm", explanation=explanation)


def parse_llm_questions(raw: str, max_items: int) -> list[Question]:
    data = _extract_json(raw)
    if not isinstance(data, dict):
        return []
    items = data.get("questions")
    if not isinstance(items, list):
        return []
    out: list[Question] = []
    for it in items:
        q = _validate_llm_item(it)
        if q is not None:
            out.append(q)
        if len(out) >= max_items:
            break
    return out


def generate_llm_questions(
    triples: list[Triple], count: int, model: str | None = None
) -> list[Question]:
    """Best-effort LLM generation. Returns [] on any error (caller falls back).

    ``model`` is the UI-selected Ollama model; ``None`` falls back to the default."""
    block = _format_triples_block(triples)
    user = (
        f"Write {count} multiple-choice questions from these triples. "
        f"Return strict JSON as specified.\n\nTriples:\n{block}"
    )
    try:
        from app.llm import ollama_chat_completion
    except Exception:
        return []
    messages = [
        {"role": "system", "content": EXAM_AUTHOR_SYSTEM},
        {"role": "user", "content": user},
    ]
    reply, err = ollama_chat_completion(messages, temperature=0.2, model=model)
    if err or not reply:
        return []
    return parse_llm_questions(reply, count)


# --------------------------------------------------------------------------- #
# Top-level assembly
# --------------------------------------------------------------------------- #

def build_exam(
    triples: list[Triple],
    count: int = 8,
    use_llm: bool = True,
    rng: random.Random | None = None,
    model: str | None = None,
) -> list[Question]:
    """Build up to ``count`` questions: LLM-authored first (if enabled), then
    deterministic to fill any shortfall. Returns fewer than ``count`` only when
    the triple set is too small. Every question is fully validated.

    ``model`` is the UI-selected Ollama model passed to the LLM author."""
    rng = rng or random.Random()
    if not _candidate_triples(triples):
        return []

    questions: list[Question] = []
    seen: set[str] = set()

    # LLM authoring is gated by LEARN_QUIZ_LLM (default off): quizzes use the deterministic
    # builder so studying never loads an Ollama model — only concept extraction does.
    if use_llm and _quiz_llm_enabled():
        for q in generate_llm_questions(triples, count, model=model):
            key = q["stem"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            questions.append(q)
            if len(questions) >= count:
                break

    if len(questions) < count:
        for q in build_deterministic_questions(triples, count * 2, rng):
            key = q["stem"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            questions.append(q)
            if len(questions) >= count:
                break

    questions = questions[:count]
    for i, q in enumerate(questions):
        q["id"] = f"q{i + 1}"
    return questions


def public_question(q: Question) -> dict[str, Any]:
    """Client-facing view of a question — answers/explanation/triple withheld."""
    return {"id": q["id"], "stem": q["stem"], "choices": q["choices"]}
