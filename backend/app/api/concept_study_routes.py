"""Concept-based study routes — thin wrappers over study/reviews.py + study/quiz_session.py.

Input parsing/validation happens here; the queue assembly, SM-2 grading, and MCQ
session logic live in the study domain.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.study import compute_concept_mastery
from app.study import answer_quiz, prepare_quizzes, quiz_prepare_status, start_quiz_session
from app.study import build_review_queue, grade_review

router = APIRouter()


@router.get("/api/review/queue")
def api_review_queue(
    doc: str | None = Query(None),
    scope: str | None = Query(None),
    limit: int = Query(40, ge=1, le=200),
    new_limit: int | None = Query(None, alias="newLimit", ge=0, le=200),
    day_start_ts: float | None = Query(None, alias="dayStart"),
) -> JSONResponse:
    """Concepts to review now: due cards (earliest first) then new (unseen) cards."""
    return JSONResponse(build_review_queue(doc, scope, limit, new_limit, day_start_ts))


@router.post("/api/review/grade")
def api_review_grade(body: dict = Body(...)) -> JSONResponse:
    """Grade one recall (1=Again, 2=Hard, 3=Good, 4=Easy). Skeleton (structure-recall) and
    figure-recall items grade through the same route — see study/reviews.py."""
    concept_key = str(body.get("conceptKey") or "").strip()
    try:
        grade = int(body.get("grade"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "grade must be 1-4"}, status_code=400)
    if grade < 1 or grade > 4:
        return JSONResponse({"error": "grade (1-4) is required"}, status_code=400)
    payload, status = grade_review(body, concept_key, grade, time.time())
    return JSONResponse(payload, status_code=status)


@router.get("/api/concept-mastery")
def api_concept_mastery(doc: str | None = Query(None)) -> JSONResponse:
    return JSONResponse(compute_concept_mastery(doc=doc))


@router.get("/api/section/{key:path}/augment")
def api_section_augment(
    key: str, doc: str | None = Query(None), refresh: bool = Query(False)
) -> JSONResponse:
    """LLM-generated learning objectives + recap for a section (cached; keyless fallback)."""
    from app.extraction import section_augment

    return JSONResponse(section_augment(doc, key, force=refresh))


@router.post("/api/concept-quiz/session")
def api_concept_quiz_session(body: dict = Body(default=None)) -> JSONResponse:
    """Build one MCQ and stash the answer server-side. ``scope`` = a sectionKey or null."""
    body = body or {}
    payload, status = start_quiz_session(body.get("doc"), body.get("scope"))
    return JSONResponse(payload, status_code=status)


@router.get("/api/concept-quiz/prepare")
def api_concept_quiz_prepare_status(
    doc: str | None = Query(None), scope: str | None = Query(None)
) -> JSONResponse:
    """How many of a scope's concepts have LLM quiz questions authored yet (+ running flag)."""
    try:
        return JSONResponse(quiz_prepare_status(doc, scope))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/api/concept-quiz/prepare")
def api_concept_quiz_prepare(body: dict = Body(default=None)) -> JSONResponse:
    """Author ALL of a chapter's application questions up front (on the processing ledger)."""
    body = body or {}
    doc, scope = body.get("doc"), body.get("scope")
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    try:
        return JSONResponse(prepare_quizzes(doc, scope))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/api/concept-quiz/answer")
def api_concept_quiz_answer(body: dict = Body(...)) -> JSONResponse:
    session_id = str((body or {}).get("sessionId") or "")
    try:
        choice_index = int((body or {}).get("choiceIndex"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "choiceIndex required"}, status_code=400)
    payload, status = answer_quiz(session_id, choice_index)
    return JSONResponse(payload, status_code=status)
