"""Concept-based study: spaced-repetition review queue + grading, and per-concept mastery.

Keyless/deterministic — no LLM. The review schedule lives in a mutable ``concept_reviews``
collection (one row per concept, _key = concept _key); every grade also appends to the
append-only ``study_events`` floor so mastery + the heatmap keep working from one log.

The same collection also schedules SKELETON items (``itemType: "skeleton"``, _key prefixed
``skel-``): structure-recall cards seeded by the chapter walk's self-grades, so "rebuild this
branch from memory" resurfaces on the same SM-2 clock as concepts. The branch's children
(headings + essences) are snapshotted on the row at grade time — a book's structure is static,
and the snapshot lets the review reveal re-show the truth without resolving the TOC tree.
"""

from __future__ import annotations

import hashlib
import os
import random
import time
import uuid
from threading import Lock
from typing import Any

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app import srs
from app.arango_tree import connect_arango
from app.cards import is_quizzable, nearest_distractor_names
from app.concept_quiz_gen import build_concept_question, public_concept_question
from app.concept_quiz_llm import (
    ensure_questions_async,
    prepare_scope,
    scope_question_status,
    servable_from_cached,
)
from app.mastery import compute_concept_mastery, record_quiz_event

router = APIRouter()

REVIEWS = "concept_reviews"
CONCEPTS = "concepts"

# In-memory MCQ sessions (the answer is stashed server-side, withheld from the client).
_cq_sessions: dict[str, dict[str, Any]] = {}
_cq_lock = Lock()
_CQ_TTL = 3600.0


def _sweep(sessions: dict[str, dict[str, Any]], now: float) -> None:
    for sid in [s for s, v in sessions.items() if now - float(v.get("created", 0)) > _CQ_TTL]:
        del sessions[sid]


def _scope_section_keys(db, doc: str | None, scope: str | None) -> set[str] | None:
    """The set of section keys a chapter scope spans (chapter → all its sub-sections), using
    the same reading-order span as the reader/concepts view. None = whole course (no filter)."""
    if not scope:
        return None
    if not doc:
        return {scope}
    try:
        from app.extract import _blocks_in_scope, _section_level_fn

        rows = list(
            db.aql.execute(
                "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
                bind_vars={"d": doc},
            )
        )
        matched = _blocks_in_scope(rows, scope, _section_level_fn(db, doc))
        keys = {b.get("sectionKey") for b in matched if b.get("sectionKey")}
        return keys or {scope}
    except Exception:  # noqa: BLE001
        return {scope}


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
    keys = _scope_section_keys(db, doc, scope)
    targets = [
        c for c in rows if (keys is None or c.get("sectionKey") in keys) and c.get("signal")
    ]
    return rows, targets


def _ensure_reviews(db) -> None:
    if not db.has_collection(REVIEWS):
        col = db.create_collection(REVIEWS)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["due"])


# Course/library-wide review sessions introduce at most this many never-reviewed concepts per
# day (Anki-style intake discipline) so a big backlog can't flood a session. Chapter-scoped
# review is exempt — studying a chapter is a deliberate "learn these now" action.
NEW_PER_DAY = int(os.getenv("LEARN_NEW_PER_DAY", "10"))


def day_start(now: float) -> float:
    """Epoch of local midnight for ``now`` — the boundary for the daily new-card allowance."""
    lt = time.localtime(now)
    return now - (lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec)


def new_allowance(cap: int, introduced_today: int) -> int:
    return max(0, int(cap) - max(0, int(introduced_today)))


SKELETON_KEY_PREFIX = "skel-"


def skeleton_review_key(doc_id: str, section_key: str) -> str:
    """Deterministic review-row key for a skeleton (structure-recall) item — prefixed so it
    can never collide with a concept _key and is recognizable in the grade route."""
    digest = hashlib.sha256(f"{doc_id}|{section_key}".encode()).hexdigest()[:16]
    return SKELETON_KEY_PREFIX + digest


def clean_skeleton_children(children: object) -> list[dict[str, str]]:
    """Sanitize a walk-supplied children snapshot to [{heading, essence}] rows."""
    out: list[dict[str, str]] = []
    if not isinstance(children, list):
        return out
    for c in children:
        if not isinstance(c, dict):
            continue
        heading = str(c.get("heading") or "").strip()
        if heading:
            out.append({"heading": heading, "essence": str(c.get("essence") or "").strip()})
    return out


def skeleton_card(row: dict[str, Any]) -> dict[str, Any]:
    """Shape a skeleton review row as a queue card (same envelope as concept cards; the panel
    keys and grades by ``conceptKey``, which for skeleton items is the review-row key)."""
    return {
        "itemType": "skeleton",
        "conceptKey": row.get("_key"),
        "name": row.get("heading") or row.get("sectionKey"),
        "kind": "skeleton",
        "signal": "",
        "children": row.get("children") or [],
        "sectionKey": row.get("sectionKey"),
        "docId": row.get("docId"),
        "state": row.get("state", "review"),
        "due": row.get("due"),
    }


def _card(c: dict[str, Any], state: str, due: float | None) -> dict[str, Any]:
    return {
        "conceptKey": c["key"],
        "name": c.get("name"),
        "kind": c.get("kind"),
        "signal": c.get("signal"),
        "source": c.get("source"),
        "sectionKey": c.get("sectionKey"),
        "docId": c.get("docId"),
        "pageStart": c.get("pageStart"),
        "pageEnd": c.get("pageEnd"),
        "state": state,
        "due": due,
    }


@router.get("/api/review/queue")
def api_review_queue(
    doc: str | None = Query(None),
    scope: str | None = Query(None),
    limit: int = Query(40, ge=1, le=200),
    new_limit: int | None = Query(None, alias="newLimit", ge=0, le=200),
    day_start_ts: float | None = Query(None, alias="dayStart"),
) -> JSONResponse:
    """Concepts to review now: due cards (earliest first) then new (unseen) cards. ``scope`` =
    a sectionKey limits to that section; omit for the whole-course queue.

    Without a scope, new-card intake is capped per local day (``newLimit``, default
    LEARN_NEW_PER_DAY): the queue serves due cards plus at most (cap − introduced-today) new
    ones. ``dayStart`` lets the client pass its own midnight so the day boundary follows the
    learner's timezone, not the server's."""
    now = time.time()
    try:
        db = connect_arango()
        if not db.has_collection(CONCEPTS):
            return JSONResponse({"cards": [], "counts": {"due": 0, "new": 0, "later": 0}})
        _ensure_reviews(db)
        concepts = list(
            db.aql.execute(
                "FOR c IN concepts "
                "FILTER (@doc == null OR c.docId == @doc) AND (@scope == null OR c.sectionKey == @scope) "
                "SORT c.order "
                "RETURN {key: c._key, name: c.name, kind: c.kind, signal: c.signal, "
                "source: c.source, sectionKey: c.sectionKey, docId: c.docId, "
                "pageStart: c.pageStart, pageEnd: c.pageEnd}",
                bind_vars={"doc": doc, "scope": scope},
            )
        )
        reviews: dict[str, dict[str, Any]] = {}
        for r in db.aql.execute(
            "FOR r IN concept_reviews FILTER (@doc == null OR r.docId == @doc) "
            "AND r.itemType != 'skeleton' "
            "RETURN {key: r._key, due: r.due, state: r.state}",
            bind_vars={"doc": doc},
        ):
            reviews[r["key"]] = r
        # Skeleton (structure-recall) cards: exist only once the chapter walk has graded them,
        # so they surface purely on their SM-2 due date — never as "new".
        skeleton_rows = list(
            db.aql.execute(
                "FOR r IN concept_reviews FILTER r.itemType == 'skeleton' "
                "AND (@doc == null OR r.docId == @doc) "
                "AND (@scope == null OR r.sectionKey == @scope OR r.chapterScope == @scope) "
                "RETURN r",
                bind_vars={"doc": doc, "scope": scope},
            )
        )
        # Daily new-card allowance (unscoped sessions only): how many concepts already got
        # their first grade since the learner's midnight?
        introduced_today = 0
        if scope is None:
            since = day_start_ts if day_start_ts is not None else day_start(now)
            introduced_today = next(
                db.aql.execute(
                    "RETURN COUNT(FOR r IN concept_reviews "
                    "FILTER (@doc == null OR r.docId == @doc) AND r.itemType != 'skeleton' "
                    "AND r.firstReview != null AND r.firstReview >= @since RETURN 1)",
                    bind_vars={"doc": doc, "since": since},
                )
            )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"cards": [], "counts": {"due": 0, "new": 0, "later": 0}, "error": str(exc)})

    due: list[dict[str, Any]] = []
    new: list[dict[str, Any]] = []
    later = 0
    for c in concepts:
        r = reviews.get(c["key"])
        if r is None:
            new.append(_card(c, "new", None))
        elif float(r.get("due", 0)) <= now:
            due.append(_card(c, r.get("state", "review"), r.get("due")))
        else:
            later += 1
    for r in skeleton_rows:
        if float(r.get("due", 0)) <= now:
            due.append(skeleton_card(r))
        else:
            later += 1
    due.sort(key=lambda x: x.get("due") or 0)
    if scope is None:
        allowance = new_allowance(new_limit if new_limit is not None else NEW_PER_DAY, introduced_today)
        served_new = new[:allowance]
    else:
        allowance = len(new)
        served_new = new
    queue = (due + served_new)[:limit]
    return JSONResponse(
        {
            "cards": queue,
            "counts": {
                "due": len(due),
                "new": len(new),
                "later": later,
                "newAllowance": allowance,
            },
        }
    )


@router.post("/api/review/grade")
def api_review_grade(body: dict = Body(...)) -> JSONResponse:
    """Grade one recall (1=Again, 2=Hard, 3=Good, 4=Easy): advance the SR state (upsert
    concept_reviews) and append a study event so mastery moves.

    Skeleton (structure-recall) items are graded the same way: pass ``skeleton: true`` with
    ``doc`` + ``sectionKey`` (the chapter walk does this, snapshotting ``heading``/``children``/
    ``chapterScope``), or pass the card's ``conceptKey`` (``skel-…``) to re-grade from the queue.
    """
    concept_key = str(body.get("conceptKey") or "").strip()
    try:
        grade = int(body.get("grade"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "grade must be 1-4"}, status_code=400)
    if grade < 1 or grade > 4:
        return JSONResponse({"error": "grade (1-4) is required"}, status_code=400)

    now = time.time()
    if body.get("skeleton") or concept_key.startswith(SKELETON_KEY_PREFIX):
        return _grade_skeleton_item(body, concept_key, grade, now)
    if not concept_key:
        return JSONResponse({"error": "conceptKey and grade (1-4) are required"}, status_code=400)
    try:
        db = connect_arango()
        _ensure_reviews(db)
        concept = db.collection(CONCEPTS).get(concept_key) if db.has_collection(CONCEPTS) else None
        if not concept:
            return JSONResponse({"error": "unknown concept"}, status_code=404)
        doc_id = concept.get("docId")
        section_key = concept.get("sectionKey")

        reviews = db.collection(REVIEWS)
        existing = reviews.get(concept_key)
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        row = {
            **next_state,
            "_key": concept_key,
            "docId": doc_id,
            "sectionKey": section_key,
        }
        if not existing:
            row["firstReview"] = now  # feeds the daily new-card allowance
        reviews.insert(row, overwrite=True)  # idempotent upsert (1 row per concept)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)

    # Append to the mastery floor (best-effort; never breaks the grade flow).
    record_quiz_event(
        section_key,
        None,
        correct=(grade >= 3),
        doc=doc_id,
        stem=concept.get("name"),
        expected=concept.get("signal"),
        concept_key=concept_key,
    )
    return JSONResponse(
        {
            "conceptKey": concept_key,
            "due": next_state["due"],
            "intervalDays": next_state["interval"],
            "state": next_state["state"],
        }
    )


def _grade_skeleton_item(body: dict, concept_key: str, grade: int, now: float) -> JSONResponse:
    """Advance (or seed) the SM-2 state of one skeleton item and log a ``recall`` study event.

    The chapter walk creates the row (doc + sectionKey + structure snapshot); queue re-grades
    address the existing row by its ``skel-…`` key, so no snapshot is needed then.
    """
    doc_id = str(body.get("doc") or "").strip()
    section_key = str(body.get("sectionKey") or "").strip()
    try:
        db = connect_arango()
        _ensure_reviews(db)
        reviews = db.collection(REVIEWS)
        if doc_id and section_key:
            key = skeleton_review_key(doc_id, section_key)
            existing = reviews.get(key)
        elif concept_key.startswith(SKELETON_KEY_PREFIX):
            key = concept_key
            existing = reviews.get(key)
            if not existing:
                return JSONResponse({"error": "unknown skeleton item"}, status_code=404)
            doc_id = existing.get("docId")
            section_key = existing.get("sectionKey")
        else:
            return JSONResponse(
                {"error": "doc and sectionKey are required for a skeleton grade"}, status_code=400
            )
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        row = {
            **next_state,
            "_key": key,
            "itemType": "skeleton",
            "docId": doc_id,
            "sectionKey": section_key,
        }
        if not existing:
            row["firstReview"] = now
        heading = str(body.get("heading") or "").strip()
        if heading:
            row["heading"] = heading
        chapter_scope = str(body.get("chapterScope") or "").strip()
        if chapter_scope:
            row["chapterScope"] = chapter_scope
        children = clean_skeleton_children(body.get("children"))
        if children:
            row["children"] = children
        reviews.insert(row, overwrite=True)  # idempotent upsert (1 row per skeleton item)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)

    # Append to the mastery floor (best-effort; never breaks the grade flow).
    record_quiz_event(
        section_key,
        None,
        correct=(grade >= 3),
        doc=doc_id,
        stem=row.get("heading") or section_key,
        expected="; ".join(c["heading"] for c in (row.get("children") or [])) or None,
        kind="recall",
    )
    return JSONResponse(
        {
            "conceptKey": key,
            "due": next_state["due"],
            "intervalDays": next_state["interval"],
            "state": next_state["state"],
        }
    )


@router.get("/api/concept-mastery")
def api_concept_mastery(doc: str | None = Query(None)) -> JSONResponse:
    return JSONResponse(compute_concept_mastery(doc=doc))


@router.get("/api/section/{key:path}/augment")
def api_section_augment(
    key: str, doc: str | None = Query(None), refresh: bool = Query(False)
) -> JSONResponse:
    """LLM-generated learning objectives + recap for a section (cached; keyless fallback)."""
    from app.augment import section_augment

    return JSONResponse(section_augment(doc, key, force=refresh))


@router.post("/api/concept-quiz/session")
def api_concept_quiz_session(body: dict = Body(default=None)) -> JSONResponse:
    """Build one deterministic MCQ (stem = a concept's signal, choices = concept names) and
    stash the answer server-side. ``scope`` = a sectionKey or null (whole course)."""
    body = body or {}
    doc = body.get("doc")
    scope = body.get("scope")
    try:
        db = connect_arango()
        if not db.has_collection(CONCEPTS):
            return JSONResponse({"error": "No concepts to quiz"}, status_code=400)
        pool, targets = _pool(db, doc, scope)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)

    # A2: prefer quiz-worthy concepts (skip fact-shaped / sentence-name trivia); fall back to the
    # full set only if filtering leaves nothing.
    worthy = [t for t in targets if is_quizzable(t)]
    targets = worthy or targets
    if len(pool) < 2 or not targets:
        return JSONResponse(
            {"error": "Not enough concepts here to build a quiz. Extract more first."},
            status_code=400,
        )
    rng = random.Random()
    target = rng.choice(targets)
    # Prefer a cached LLM application question when one exists (mostly — keep some recall in the
    # mix); fall back to the deterministic de-leaked question with confusable (embedding-nearest)
    # distractors. Backfill authoring runs lazily.
    cached = target.get("quizQuestions") or []
    question = None
    if cached and rng.random() < 0.75:
        question = servable_from_cached(target, rng.choice(cached), rng)
    if question is None:
        nn = nearest_distractor_names(db, doc, target.get("key"), target.get("name"))
        question = build_concept_question(target, pool, rng, distractor_names=nn)
    if any(not (t.get("quizQuestions")) for t in targets):
        ensure_questions_async(doc, _scope_section_keys(db, doc, scope))
    if not question:
        return JSONResponse({"error": "Could not build a question"}, status_code=400)

    session_id = str(uuid.uuid4())
    now = time.time()
    with _cq_lock:
        _sweep(_cq_sessions, now)
        _cq_sessions[session_id] = {"question": question, "doc": doc, "created": now}

    pub = public_concept_question(question)
    return JSONResponse({"sessionId": session_id, "stem": pub["stem"], "choices": pub["choices"]})


@router.get("/api/concept-quiz/prepare")
def api_concept_quiz_prepare_status(
    doc: str | None = Query(None), scope: str | None = Query(None)
) -> JSONResponse:
    """How many of a scope's concepts have LLM quiz questions authored yet (+ running flag)."""
    try:
        db = connect_arango()
        keys = _scope_section_keys(db, doc, scope)
        return JSONResponse(scope_question_status(db, doc, keys))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/api/concept-quiz/prepare")
def api_concept_quiz_prepare(body: dict = Body(default=None)) -> JSONResponse:
    """Author ALL of a chapter's application questions up front (background). Returns status."""
    body = body or {}
    doc, scope = body.get("doc"), body.get("scope")
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    try:
        db = connect_arango()
        keys = _scope_section_keys(db, doc, scope)
        return JSONResponse(prepare_scope(db, doc, keys))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/api/concept-quiz/answer")
def api_concept_quiz_answer(body: dict = Body(...)) -> JSONResponse:
    session_id = str((body or {}).get("sessionId") or "")
    try:
        choice_index = int((body or {}).get("choiceIndex"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "choiceIndex required"}, status_code=400)
    with _cq_lock:
        session = _cq_sessions.pop(session_id, None)
    if not session:
        return JSONResponse({"error": "Unknown or expired quiz session"}, status_code=404)

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
    return JSONResponse(
        {
            "correct": correct,
            "expected": q["expected"],
            "signal": q.get("signal"),
            "source": q.get("source"),
        }
    )
