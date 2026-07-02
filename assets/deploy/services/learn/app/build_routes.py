"""API routes for the chapter build queue: enqueue (optionally time-scheduled via
``at`` epoch seconds), cancel, list, and the per-chapter readiness ladder."""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.build_queue import (
    cancel_build,
    chapters_readiness,
    enqueue_build,
    ensure_worker,
    list_builds,
)

router = APIRouter()

# Start the worker with the app so scheduled jobs run without a triggering request.
ensure_worker()


@router.post("/api/build")
def api_build(
    doc: str | None = None, scope: str = "", body: dict | None = Body(default=None)
) -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    at = (body or {}).get("at")
    data = enqueue_build(doc, scope, not_before=int(at) if at else None)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.post("/api/build/cancel")
def api_build_cancel(doc: str | None = None, scope: str = "") -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    data = cancel_build(doc, scope)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/build")
def api_build_list(doc: str | None = None) -> JSONResponse:
    data = list_builds(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/build/readiness")
def api_build_readiness(doc: str | None = None, scopes: str = "") -> JSONResponse:
    keys = [s for s in scopes.split(",") if s]
    if not keys:
        return JSONResponse({"error": "scopes required"}, status_code=400)
    data = chapters_readiness(doc, keys)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)
