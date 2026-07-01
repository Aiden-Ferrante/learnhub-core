"""API routes for the Deep Chapter reading surface: the one-call assembler plus
the background prepare/backfill pass for already-processed documents."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.deep_chapter import fetch_deep_chapter, prepare_deep_chapter

router = APIRouter()


@router.get("/api/deep-chapter")
def api_deep_chapter(doc: str | None = None, scope: str = "") -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    data = fetch_deep_chapter(doc, scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.post("/api/deep-chapter/prepare")
def api_deep_chapter_prepare(doc: str | None = None, scope: str = "") -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    data = prepare_deep_chapter(doc, scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)
