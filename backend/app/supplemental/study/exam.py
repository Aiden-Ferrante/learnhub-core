"""Chapter exam — a scored, interleaved multiple-choice exam across the WHOLE chapter.

Reuses the concept MCQ builder, but draws its target concepts from every section in the
chapter scope (via the fixed chapter-scope span), not a single section. The exam is
generated up front as a fixed question set; the client answers all, then submits for a
score + pass/fail, which is recorded into the chapter path progress.
"""

from __future__ import annotations

import random
import time
import uuid

from app.gateways import db
from app.supplemental.study.cards import is_quizzable
from app.supplemental.study.concept_quiz_gen import build_concept_question, public_concept_question
from app.supplemental.study.concept_quiz_llm import ensure_questions_async, servable_from_cached
from app.process.content import scope_section_keys
from app.supplemental.study.mastery import record_quiz_event
from app.process.content import resolve_doc_id
from app.process.extraction import update_stage

PASS_PCT = 80
_TTL = 60 * 60  # an exam session is valid for an hour

_EXAM: dict[str, dict] = {}


def _sweep(now: float) -> None:
    for k in [k for k, v in _EXAM.items() if now - v.get("created", 0) > _TTL]:
        _EXAM.pop(k, None)


def _doc_pool(doc_id: str) -> list[dict]:
    with db() as conn:
        return conn.execute(
            'SELECT key, name, kind, signal, source, section_key AS "sectionKey", '
            'quiz_questions AS "quizQuestions" FROM concepts WHERE doc_id = %(d)s',
            {"d": doc_id},
        ).fetchall()


def _exam_question(doc_id: str, target: dict, pool: list[dict], rng) -> dict | None:
    """Best available question for an exam target without blocking: a cached LLM understanding
    question if the section was authored, else a deterministic recall MCQ with tiered
    (same-section, then same-kind) distractors."""
    cached = target.get("quizQuestions") or []
    if cached:
        q = servable_from_cached(target, rng.choice(cached), rng)
        if q:
            return q
    return build_concept_question(target, pool, rng)


def _chapter_targets(doc_id: str, scope: str | None, pool: list[dict]) -> list[dict]:
    # Keys only — no need to load every section's markdown to filter the concept pool.
    keys = scope_section_keys(doc_id, scope)
    return [c for c in pool if (keys is None or c.get("sectionKey") in keys) and is_quizzable(c)]


def start_exam(doc_id: str | None, scope: str | None, n: int = 12) -> dict:
    """Build the exam: up to ``n`` interleaved MCQs across the chapter's concepts."""
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    pool = _doc_pool(doc_id)
    targets = _chapter_targets(doc_id, scope, pool) if scope else [c for c in pool if is_quizzable(c)]
    if len(pool) < 4 or not targets:
        return {"error": "Not enough concepts in this chapter to build an exam — study/extract more first."}

    rng = random.Random()
    rng.shuffle(targets)  # interleave across sections
    chosen = targets[: max(1, min(n, len(targets)))]
    # Stays fast: a cached LLM understanding question where one exists, else a mechanical MCQ
    # with confusable distractors (no blocking generation). Backfill so future exams improve.
    questions = [q for q in (_exam_question(doc_id, t, pool, rng) for t in chosen) if q]
    ensure_questions_async(doc_id, {c.get("sectionKey") for c in chosen if c.get("sectionKey")})
    if not questions:
        return {"error": "Could not build exam questions"}

    sid = str(uuid.uuid4())
    now = time.time()
    _sweep(now)
    _EXAM[sid] = {"questions": questions, "doc": doc_id, "scope": scope, "created": now}
    pub = [public_concept_question(q) for q in questions]
    return {"sessionId": sid, "total": len(questions), "passPct": PASS_PCT, "questions": pub}


def grade_exam(session_id: str, answers: list) -> dict:
    """Score the submitted answers, record per-question events + the exam stage result."""
    sess = _EXAM.pop(str(session_id or ""), None)
    if not sess:
        return {"error": "Unknown or expired exam session — start a new one."}
    questions = sess["questions"]
    results = []
    correct = 0
    for i, q in enumerate(questions):
        raw = answers[i] if i < len(answers) else None
        try:
            ans = int(raw)
        except (TypeError, ValueError):
            ans = -1
        ok = ans == q["answer_index"]
        if ok:
            correct += 1
        record_quiz_event(
            q.get("sectionKey"), ok, doc=sess.get("doc"),
            stem=q.get("expected"), expected=q.get("signal"), concept_key=q.get("conceptKey"),
        )
        results.append({
            "correct": ok,
            "expected": q.get("expected"),
            "yourChoice": ans,
            "explanation": q.get("signal") or "",
            "source": q.get("source"),
        })

    total = len(questions)
    score = round(100 * correct / total) if total else 0
    passed = score >= PASS_PCT
    update_stage(
        sess.get("doc"), sess.get("scope"), "exam",
        {"score": score, "correct": correct, "total": total, "pass": passed, "done": passed},
    )
    return {"score": score, "correct": correct, "total": total, "pass": passed, "results": results}
