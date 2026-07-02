"""API routes for the chapter learning path: skeleton (free-recall scaffold) + shared
per-chapter progress. Orient / exam stages will add their endpoints here too."""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.drill import grade_drill, start_drill
from app.exam import grade_exam, start_exam
from app.plan import build_plan
from app.recall import check_recall
from app.skeleton import (
    fetch_orient,
    fetch_skeleton,
    get_chapter_progress,
    record_skeleton_grade,
    update_stage,
)

router = APIRouter()


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


@router.get("/api/plan")
def api_plan(doc: str | None = None, scope: str | None = None) -> JSONResponse:
    """Course-level Today plan: resume chapter+stage, reviews due, next chapter to build.
    ``scope`` = the client's reading position hint."""
    data = build_plan(doc, hint_scope=scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


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
