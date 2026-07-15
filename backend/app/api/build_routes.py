"""API routes for the processing queue/ledger: enqueue any artifact kind (optionally
time-scheduled via ``at`` epoch seconds), cancel, list, the per-chapter readiness ladder,
and the coverage grid (every chapter × every artifact, with state)."""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.overview import chapters_coverage, chapters_readiness
from app.platform import KINDS, cancel_build, enqueue_build, ensure_worker, list_builds

router = APIRouter()

# Start the worker with the app so scheduled jobs run without a triggering request.
ensure_worker()


@router.post("/api/build")
def api_build(
    doc: str | None = None, scope: str = "", body: dict | None = Body(default=None)
) -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    body = body or {}
    at = body.get("at")
    kind = str(body.get("kind") or "build")
    if kind not in KINDS:
        return JSONResponse({"error": f"kind must be one of {', '.join(KINDS)}"}, status_code=400)
    data = enqueue_build(doc, scope, not_before=int(at) if at else None, kind=kind)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.post("/api/build/cancel")
def api_build_cancel(
    doc: str | None = None, scope: str = "", kind: str = "build"
) -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    data = cancel_build(doc, scope, kind=kind)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/build")
def api_build_list(doc: str | None = None) -> JSONResponse:
    data = list_builds(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/jobs")
def api_jobs(doc: str | None = None) -> JSONResponse:
    """The full processing ledger for a course — every kind, queued/running/done/error."""
    data = list_builds(doc, kind=None)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/coverage")
def api_coverage(doc: str | None = None) -> JSONResponse:
    """Chapter × artifact coverage grid: what exists, what's stale, what's missing,
    what's queued or running — the one call that de-black-boxes the pipeline."""
    data = chapters_coverage(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/build/readiness")
def api_build_readiness(doc: str | None = None, scopes: str = "") -> JSONResponse:
    keys = [s for s in scopes.split(",") if s]
    if not keys:
        return JSONResponse({"error": "scopes required"}, status_code=400)
    data = chapters_readiness(doc, keys)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)
