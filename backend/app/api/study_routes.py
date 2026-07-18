"""Study routes: DOING study — the chapter path (orient/skeleton/progress) and the
spaced-review queue, the loop's only two graded activities (skeleton + concept recall).

Input parsing/validation happens here; queue assembly and FSRS grading live in
supplemental/study (orient/skeleton artifacts in process/extraction).
Read models over what studying produced live in progress_routes.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.process.extraction import fetch_orient, fetch_skeleton, get_chapter_progress, record_skeleton_grade, update_stage
from app.supplemental.study import build_review_queue, grade_review

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
    chapter-resurface items grade through the same route — see study/reviews.py."""
    concept_key = str(body.get("conceptKey") or "").strip()
    try:
        grade = int(body.get("grade"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "grade must be 1-4"}, status_code=400)
    if grade < 1 or grade > 4:
        return JSONResponse({"error": "grade (1-4) is required"}, status_code=400)
    payload, status = grade_review(body, concept_key, grade, time.time())
    return JSONResponse(payload, status_code=status)
