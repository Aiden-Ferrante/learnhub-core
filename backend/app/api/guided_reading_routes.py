"""API routes for the Deep Chapter reading surface: the one-call assembler plus
the background prepare/backfill pass for already-processed documents."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.extraction import fetch_guided_reading, prepare_guided_reading

router = APIRouter()


@router.get("/api/guided-reading")
def api_guided_reading(doc: str | None = None, scope: str = "") -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    data = fetch_guided_reading(doc, scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.post("/api/guided-reading/prepare")
def api_guided_reading_prepare(doc: str | None = None, scope: str = "") -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    data = prepare_guided_reading(doc, scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)
