"""Practice routes: the item pool — generated practice items, their authoring job,
and curation writes. Grading stays on /api/review/grade (study_routes); this file is
creation and reading only."""

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
