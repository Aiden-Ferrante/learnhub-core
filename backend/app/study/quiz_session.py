"""Concept MCQ sessions: build a question, stash the answer server-side, grade it.

The answer is withheld from the client (in-memory session keyed by uuid, 1h TTL).
Question source order: a cached LLM application question when one exists (mostly —
some recall stays in the mix), else the deterministic de-leaked question with
confusable (embedding-nearest) distractors. Backfill authoring runs lazily.

Functions return (payload, status) tuples; the route layer only parses input.
"""

from __future__ import annotations

import random
import time
import uuid
from threading import Lock
from typing import Any

from app.content.scope import _scope_section_keys
from app.platform.arango import connect_arango
from app.study.cards import is_quizzable, nearest_distractor_names
from app.study.concept_quiz_gen import build_concept_question, public_concept_question
from app.study.concept_quiz_llm import (
    ensure_questions_async,
    scope_question_status,
    servable_from_cached,
)
from app.study.mastery import record_quiz_event

CONCEPTS = "concepts"

# In-memory MCQ sessions (the answer is stashed server-side, withheld from the client).
_cq_sessions: dict[str, dict[str, Any]] = {}
_cq_lock = Lock()
_CQ_TTL = 3600.0


def _sweep(sessions: dict[str, dict[str, Any]], now: float) -> None:
    for sid in [s for s, v in sessions.items() if now - float(v.get("created", 0)) > _CQ_TTL]:
        del sessions[sid]


def _pool(db, doc: str | None, scope: str | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (doc_pool, scope_targets). Distractors draw from the whole doc; the quizzed
    concept is picked from the scope — which for a chapter spans ALL its sub-sections."""
    rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER @doc == null OR c.docId == @doc "
            "RETURN {key: c._key, name: c.name, kind: c.kind, signal: c.signal, "
            "source: c.source, sectionKey: c.sectionKey, quizQuestions: c.quizQuestions}",
            bind_vars={"doc": doc},
        )
    )
    keys = _scope_section_keys(doc, scope)
    targets = [
        c for c in rows if (keys is None or c.get("sectionKey") in keys) and c.get("signal")
    ]
    return rows, targets


def start_quiz_session(doc: str | None, scope: str | None) -> tuple[dict[str, Any], int]:
    """Build one MCQ (stem = a concept's signal, choices = concept names) and stash the
    answer server-side. ``scope`` = a sectionKey or None (whole course)."""
    try:
        db = connect_arango()
        if not db.has_collection(CONCEPTS):
            return {"error": "No concepts to quiz"}, 400
        pool, targets = _pool(db, doc, scope)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    # A2: prefer quiz-worthy concepts (skip fact-shaped / sentence-name trivia); fall back to the
    # full set only if filtering leaves nothing.
    worthy = [t for t in targets if is_quizzable(t)]
    targets = worthy or targets
    if len(pool) < 2 or not targets:
        return {"error": "Not enough concepts here to build a quiz. Extract more first."}, 400
    rng = random.Random()
    target = rng.choice(targets)
    cached = target.get("quizQuestions") or []
    question = None
    if cached and rng.random() < 0.75:
        question = servable_from_cached(target, rng.choice(cached), rng)
    if question is None:
        nn = nearest_distractor_names(db, doc, target.get("key"), target.get("name"))
        question = build_concept_question(target, pool, rng, distractor_names=nn)
    if any(not (t.get("quizQuestions")) for t in targets):
        ensure_questions_async(doc, _scope_section_keys(doc, scope))
    if not question:
        return {"error": "Could not build a question"}, 400

    session_id = str(uuid.uuid4())
    now = time.time()
    with _cq_lock:
        _sweep(_cq_sessions, now)
        _cq_sessions[session_id] = {"question": question, "doc": doc, "created": now}

    pub = public_concept_question(question)
    return {"sessionId": session_id, "stem": pub["stem"], "choices": pub["choices"]}, 200


def answer_quiz(session_id: str, choice_index: int) -> tuple[dict[str, Any], int]:
    """Grade a stashed MCQ: pop the session, compare, and log a study event."""
    with _cq_lock:
        session = _cq_sessions.pop(session_id, None)
    if not session:
        return {"error": "Unknown or expired quiz session"}, 404

    q = session["question"]
    correct = choice_index == q["answer_index"]
    record_quiz_event(
        q.get("sectionKey"),
        None,
        correct,
        doc=session.get("doc"),
        stem=q.get("expected"),
        expected=q.get("signal"),
        concept_key=q.get("conceptKey"),
    )
    return {
        "correct": correct,
        "expected": q["expected"],
        "signal": q.get("signal"),
        "source": q.get("source"),
    }, 200


def _quiz_job_running(doc: str | None, scope: str | None) -> bool:
    """Is a ledgered quiz-authoring job queued/running for this scope?"""
    try:
        from app.platform.jobs import list_builds

        for j in list_builds(doc, kind="quizzes").get("builds", []):
            if j.get("scope") == scope and j.get("status") in ("queued", "running"):
                return True
    except Exception:  # noqa: BLE001
        pass
    return False


def quiz_prepare_status(doc: str | None, scope: str | None) -> dict[str, Any]:
    """How many of a scope's concepts have LLM quiz questions authored yet (+ running flag,
    covering both the inline backfill thread and a ledgered queue job)."""
    db = connect_arango()
    keys = _scope_section_keys(doc, scope)
    status = scope_question_status(db, doc, keys)
    status["running"] = bool(status.get("running")) or _quiz_job_running(doc, scope)
    return status


def prepare_quizzes(doc: str | None, scope: str) -> dict[str, Any]:
    """Author ALL of a chapter's application questions up front — enqueued on the processing
    ledger (visible in the pipeline grid, survives restarts) rather than a fire-and-forget
    thread. Returns current status."""
    from app.platform.jobs import enqueue_build

    db = connect_arango()
    enqueue_build(doc, scope, kind="quizzes")
    keys = _scope_section_keys(doc, scope)
    status = scope_question_status(db, doc, keys)
    status["running"] = True
    return status
