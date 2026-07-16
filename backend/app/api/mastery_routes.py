"""Study rollups + engagement: mastery, activity heatmap, forgetting forecast, calibration,
and the passive-engagement event sink. Thin routers over the ``study`` domain, moved out of
main.py so it is a pure composition root.
"""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.study import (
    compute_activity,
    compute_calibration,
    compute_forecast,
    compute_mastery,
    ensure_chapter_item,
    record_engagement,
)

router = APIRouter()


@router.get("/api/mastery")
def api_mastery(doc: str | None = None) -> JSONResponse:
    data = compute_mastery(doc=doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/activity")
def api_activity(doc: str | None = None) -> JSONResponse:
    data = compute_activity(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/forecast")
def api_forecast(doc: str | None = None, days: int = 7) -> JSONResponse:
    """Forgetting forecast: concepts due now + falling due over the next ``days``."""
    return JSONResponse(compute_forecast(doc, days=days))


@router.get("/api/calibration")
def api_calibration(doc: str | None = None) -> JSONResponse:
    """Confidence calibration: accuracy per pre-reveal confidence level."""
    return JSONResponse(compute_calibration(doc))


@router.post("/api/engagement")
def api_engagement(body: dict = Body(default=None)) -> JSONResponse:
    """Record a passive engagement event (read/listen/…) so the dashboard reflects it."""
    body = body or {}
    kind = str(body.get("kind") or "").strip()
    scope = body.get("scope")
    if kind and scope:
        record_engagement(kind, scope, doc=body.get("doc"), concept_key=body.get("conceptKey"))
        # Reading a chapter enters it into the decay cycle (idempotent, best-effort).
        if kind == "read" and body.get("doc"):
            ensure_chapter_item(str(body["doc"]), str(scope))
    return JSONResponse({"ok": True})
