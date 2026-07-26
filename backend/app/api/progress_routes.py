"""Progress routes: TRACKING study — read models over the append-only study-event floor
and the review schedule (mastery, activity, forecast, the cross-course
planner, derived sessions). Everything here is a read except /api/engagement,
which appends one event."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app.gateways import db
from app.supplemental.study import (
    build_review_calendar,
    build_study_debt,
    compute_activity,
    compute_concept_mastery,
    compute_forecast,
    compute_mastery,
    delete_manual_session,
    fetch_sessions,
    record_engagement,
    upsert_manual_session,
)

router = APIRouter()


@router.get("/api/mastery")
def api_mastery(doc: str | None = None) -> JSONResponse:
    data = compute_mastery(doc=doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/concept-mastery")
def api_concept_mastery(doc: str | None = Query(None)) -> JSONResponse:
    return JSONResponse(compute_concept_mastery(doc=doc))


@router.get("/api/activity")
def api_activity(doc: str | None = None) -> JSONResponse:
    data = compute_activity(doc=doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/forecast")
def api_forecast(doc: str | None = None, days: int = 7) -> JSONResponse:
    data = compute_forecast(doc=doc, days=days)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.post("/api/engagement")
def api_engagement(body: dict = Body(default=None)) -> JSONResponse:
    data = record_engagement(dict(body or {}))
    return JSONResponse(data, status_code=400 if data.get("error") else 200)


@router.get("/api/review-calendar")
def api_review_calendar(days: int = Query(60, ge=1, le=365)) -> dict[str, Any]:
    """Whole-library review calendar: per-day due counts (per course, per item type) over
    the horizon, plus the overdue pile. Powers the /study planner."""
    return build_review_calendar(days=days)


@router.get("/api/study-debt")
def api_study_debt(days: int = Query(7)) -> dict[str, Any]:
    """The compact cross-course review-debt rollup (nav badge, morning vault briefing):
    what's due now and what fades within ``days``, per course and in total."""
    return build_study_debt(days=days)


@router.get("/api/study/sessions")
def api_study_sessions(
    doc: str | None = Query(None),
    days: int = Query(90, ge=1, le=730),
) -> dict[str, Any]:
    """Working sessions derived from the study-event floor (gap-clustered, newest first),
    merged with the user's manual time blocks, with a summary strip. Optionally scoped
    to one course."""
    return fetch_sessions(doc, days=days)


@router.post("/api/study/manual-session")
def api_manual_session_upsert(payload: dict[str, Any] = Body(...)) -> JSONResponse:
    """Create (no ``key``) or update (``key``) a manual study-time block. Timestamps are
    epoch seconds. The write-side exception in this read-model router — manual blocks
    ARE tracking data, owned here next to the sessions read they feed."""
    data = upsert_manual_session(
        doc=str(payload.get("doc") or ""),
        start=float(payload.get("start") or 0),
        end=float(payload.get("end") or 0),
        note=(str(payload["note"]).strip() or None) if payload.get("note") else None,
        key=str(payload["key"]) if payload.get("key") else None,
    )
    return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)


@router.delete("/api/study/manual-session")
def api_manual_session_delete(key: str = Query(...)) -> JSONResponse:
    data = delete_manual_session(key)
    return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
