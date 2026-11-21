"""Reading routes: the guided-reading surface — the one-call chapter assembler plus
per-section reading guides and their authoring status."""

from __future__ import annotations

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.gateways import enqueue_build
from app.process.extraction import fetch_guided_reading, fetch_reading_guide, guide_status

router = APIRouter()


@router.get("/api/guided-reading")
def api_guided_reading(doc: str | None = None, scope: str = "") -> JSONResponse:
    """Everything the reading surface needs for one chapter: briefing + markdown +
    concepts + status. Reads caches only — never calls the LLM."""
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    data = fetch_guided_reading(doc, scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/reading-guide")
def api_reading_guide(
    doc: str | None = Query(None), scope: str | None = Query(None)
) -> JSONResponse:
    """The guided read for a chapter: each section's text + skeleton position + focus + checks."""
    data = fetch_reading_guide(doc, scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/reading-guide/prepare")
def api_reading_guide_prepare_status(
    doc: str | None = Query(None), scope: str | None = Query(None)
) -> JSONResponse:
    """How many of a chapter's sections have authored guidance yet (+ running flag)."""
    try:
        return JSONResponse(guide_status(doc, scope))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/api/reading-guide/prepare")
def api_reading_guide_prepare(body: dict = Body(default=None)) -> JSONResponse:
    """Author ALL of a chapter's guidance — enqueued on the processing ledger (visible in
    the Process tab, survives restarts). Returns current status."""
    body = body or {}
    doc, scope = body.get("doc"), body.get("scope")
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    try:
        enqueue_build(doc, scope, kind="guides")
        status = guide_status(doc, scope)
        status["running"] = True
        return JSONResponse(status)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)
