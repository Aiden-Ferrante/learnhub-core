"""Study routes: DOING study — the chapter path (orient/skeleton/progress), reviews,
quizzes, exams, drills, and free recall.

Input parsing/validation happens here; queue assembly, FSRS grading, and MCQ session
logic live in supplemental/study (orient/skeleton artifacts in process/extraction).
Read models over what studying produced live in progress_routes.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.process.extraction import fetch_orient, fetch_skeleton, get_chapter_progress, record_skeleton_grade, update_stage
from app.supplemental.study import answer_quiz, prepare_quizzes, quiz_prepare_status, start_quiz_session
from app.supplemental.study import build_review_queue, grade_review
from app.supplemental.study import check_recall, grade_drill, grade_exam, start_drill, start_exam

router = APIRouter()


# ── The chapter path: orient → skeleton → progress ──────────────────────────


@router.get("/api/orient")
def api_orient(doc: str | None = None, scope: str | None = None, regenerate: int = 0) -> JSONResponse:
    data = fetch_orient(doc, scope, regenerate=bool(regenerate))
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/skeleton")
def api_skeleton(doc: str | None = None, scope: str | None = None, regenerate: int = 0) -> JSONResponse:
    data = fetch_skeleton(doc, scope, regenerate=bool(regenerate))
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.post("/api/skeleton/grade")
def api_skeleton_grade(
    doc: str | None = None, scope: str | None = None, body: dict | None = Body(default=None)
) -> JSONResponse:
    body = body or {}
    data = record_skeleton_grade(doc, scope, str(body.get("grade") or ""))
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/chapter-progress")
def api_chapter_progress(doc: str | None = None, scope: str | None = None) -> JSONResponse:
    return JSONResponse(get_chapter_progress(doc, scope))


@router.post("/api/chapter-progress")
def api_update_progress(
    doc: str | None = None, scope: str | None = None, body: dict | None = Body(default=None)
) -> JSONResponse:
    body = body or {}
    stage = str(body.get("stage") or "").strip()
    if not stage:
        return JSONResponse({"error": "stage required"}, status_code=400)
    data = update_stage(doc, scope, stage, dict(body.get("data") or {}))
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


# ── Spaced reviews ──────────────────────────────────────────────────────────


@router.get("/api/review/queue")
def api_review_queue(
    doc: str | None = Query(None),
    scope: str = Query(..., min_length=1),
    limit: int = Query(40, ge=1, le=200),
) -> JSONResponse:
    """Concepts to review now for one chapter/section scope (studying is chapter-scoped)."""
    return JSONResponse(build_review_queue(doc, scope, limit))


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


# ── Concept quiz (MCQ sessions) ─────────────────────────────────────────────


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


# ── Exam · drill · free recall ──────────────────────────────────────────────


@router.post("/api/exam/start")
def api_exam_start(
    doc: str | None = None, scope: str | None = None, body: dict | None = Body(default=None)
) -> JSONResponse:
    n = int((body or {}).get("n") or 12)
    data = start_exam(doc, scope, n=n)
    return JSONResponse(data, status_code=400 if data.get("error") else 200)


@router.post("/api/exam/grade")
def api_exam_grade(body: dict | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    data = grade_exam(str(body.get("sessionId") or ""), list(body.get("answers") or []))
    return JSONResponse(data, status_code=400 if data.get("error") else 200)


@router.post("/api/drill/start")
def api_drill_start(body: dict | None = Body(default=None)) -> JSONResponse:
    """Adaptive practice drill over the concepts you most need (missed + weakest, interleaved)."""
    body = body or {}
    data = start_drill(body.get("doc"), body.get("scope"), n=int(body.get("n") or 10))
    return JSONResponse(data, status_code=400 if data.get("error") else 200)


@router.post("/api/drill/grade")
def api_drill_grade(body: dict | None = Body(default=None)) -> JSONResponse:
    body = body or {}
    data = grade_drill(
        str(body.get("sessionId") or ""),
        list(body.get("answers") or []),
        confidences=list(body.get("confidences") or []),
    )
    return JSONResponse(data, status_code=400 if data.get("error") else 200)


@router.post("/api/recall/check")
def api_recall_check(body: dict | None = Body(default=None)) -> JSONResponse:
    """Free-recall brain dump → coverage vs the chapter's concepts (covered / missed)."""
    body = body or {}
    data = check_recall(body.get("doc"), body.get("scope"), str(body.get("text") or ""))
    return JSONResponse(data, status_code=400 if data.get("error") else 200)
