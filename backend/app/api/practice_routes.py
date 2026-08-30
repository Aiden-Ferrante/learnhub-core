"""Practice routes: the item pool — generated practice items, their authoring job and
curation writes — plus EXAM sittings, the one assembly over that pool which stores a row.

Practice grading stays on /api/review/grade (study_routes). An exam's self-grades go
through /api/exams/{key}/grade, which routes to the same engine and only tags the study
event differently."""

from __future__ import annotations

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.gateways import enqueue_build
from app.process.extraction import (
    create_item,
    delete_item,
    fetch_practice,
    practice_status,
    update_item,
)
from app.supplemental.study import (
    create_exam,
    exam_results,
    fetch_exam,
    finish_exam,
    grade_answer,
    list_exams,
    resit,
    save_answer,
)

router = APIRouter()


@router.get("/api/practice")
def api_practice(doc: str | None = Query(None), scope: str | None = Query(None)) -> JSONResponse:
    """The scope's practice items (inherited through the version's blocks)."""
    data = fetch_practice(doc, scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/practice/prepare")
def api_practice_prepare_status(
    doc: str | None = Query(None), scope: str | None = Query(None)
) -> JSONResponse:
    """How much of the scope has authored items yet (+ running flag)."""
    try:
        return JSONResponse(practice_status(doc, scope))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/api/practice/prepare")
def api_practice_prepare(body: dict = Body(default=None)) -> JSONResponse:
    """Author the scope's practice items — enqueued on the processing ledger (visible in
    the Process tab, survives restarts). body: {doc, scope, kinds?, model?, regenerate?}.
    ``regenerate`` rewrites only untouched items (edited_at IS NULL); edits are permanent."""
    body = body or {}
    doc, scope = body.get("doc"), body.get("scope")
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    payload: dict = {}
    if isinstance(body.get("kinds"), list):
        payload["kinds"] = [str(k) for k in body["kinds"] if k]
    if body.get("model"):
        payload["model"] = str(body["model"]).strip()
    if body.get("regenerate"):
        payload["regenerate"] = True
    try:
        enqueue_build(doc, scope, kind="practice", payload=payload or None)
        status = practice_status(doc, scope)
        status["running"] = True
        return JSONResponse(status)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/api/practice/item")
def api_practice_create(body: dict = Body(...)) -> JSONResponse:
    """Hand-author one item: {doc, sectionKey, kind, prompt, answer, rubric?, payload?}."""
    body = body or {}
    section_key = str(body.get("sectionKey") or "").strip()
    if not section_key:
        return JSONResponse({"error": "sectionKey required"}, status_code=400)
    data = create_item(body.get("doc"), section_key, body)
    return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)


@router.post("/api/practice/item/{key}")
def api_practice_update(key: str, body: dict = Body(...)) -> JSONResponse:
    data = update_item(key, body or {})
    return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)


@router.delete("/api/practice/item/{key}")
def api_practice_delete(key: str) -> JSONResponse:
    data = delete_item(key)
    return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)


# ── Exams: a frozen sitting over the pool ───────────────────────────────────


def _envelope(data: dict) -> JSONResponse:
    """Domain functions return {error, status} on failure; routers only shape it."""
    if data.get("error"):
        return JSONResponse(data, status_code=data.pop("status", 400))
    return JSONResponse(data)


@router.get("/api/exams")
def api_exams(doc: str | None = Query(None)) -> JSONResponse:
    """Past and open sittings for a course, newest first."""
    return JSONResponse(list_exams(doc))


@router.post("/api/exams")
def api_create_exam(body: dict = Body(...)) -> JSONResponse:
    """Assemble and FREEZE a sitting: {doc, chapters: [...], perChapter?, kinds?}."""
    body = body or {}
    chapters = body.get("chapters")
    if not isinstance(chapters, list) or not chapters:
        return JSONResponse({"error": "chapters must be a non-empty list"}, status_code=400)
    try:
        per = int(body.get("perChapter") or 5)
    except (TypeError, ValueError):
        return JSONResponse({"error": "perChapter must be a number"}, status_code=400)
    kinds = body.get("kinds") if isinstance(body.get("kinds"), list) else None
    return _envelope(create_exam(body.get("doc"), [str(c) for c in chapters], per, kinds))


@router.get("/api/exams/{key}")
def api_exam(key: str) -> JSONResponse:
    """One sitting with its frozen questions — how a reload resumes mid-paper."""
    return _envelope(fetch_exam(key))


@router.post("/api/exams/{key}/answer")
def api_exam_answer(key: str, body: dict = Body(...)) -> JSONResponse:
    """Record one written answer: {itemKey, response}. Saved per answer, so a closed tab
    costs nothing."""
    body = body or {}
    item_key = str(body.get("itemKey") or "").strip()
    if not item_key:
        return JSONResponse({"error": "itemKey required"}, status_code=400)
    return _envelope(save_answer(key, item_key, str(body.get("response") or "")))


@router.post("/api/exams/{key}/finish")
def api_exam_finish(key: str) -> JSONResponse:
    """Close the paper. Answers stop being editable; grading begins."""
    return _envelope(finish_exam(key))


@router.post("/api/exams/{key}/grade")
def api_exam_grade(key: str, body: dict = Body(...)) -> JSONResponse:
    """Self-grade one answer (1-4) on the results walk — same engine as practice."""
    body = body or {}
    item_key = str(body.get("itemKey") or "").strip()
    try:
        grade = int(body.get("grade"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "grade must be 1-4"}, status_code=400)
    if not item_key or grade < 1 or grade > 4:
        return JSONResponse({"error": "itemKey and grade (1-4) are required"}, status_code=400)
    return _envelope(grade_answer(key, item_key, grade, doc=body.get("doc")))


@router.get("/api/exams/{key}/results")
def api_exam_results(key: str) -> JSONResponse:
    """Score, per-section and per-kind breakdown, and the prior sitting when this is a resit."""
    return _envelope(exam_results(key))


@router.post("/api/exams/{key}/resit")
def api_exam_resit(key: str) -> JSONResponse:
    """Sit the SAME paper again — the item list is copied, never reassembled."""
    return _envelope(resit(key))
