"""API routes over the study-event floor.

/api/mistakes (recent wrong answers) survives from the concept-layer pivot —
concept_study_routes owns quizzing. /api/study/sessions serves the derived
working-session view of the same event floor.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.platform import db
from app.study import build_review_calendar, fetch_sessions

router = APIRouter()


@router.get("/api/review-calendar")
def api_review_calendar(days: int = Query(60, ge=1, le=365)) -> dict[str, Any]:
    """Whole-library review calendar: per-day due counts (per course, per item type) over
    the horizon, plus the overdue pile. Powers the /study planner."""
    return build_review_calendar(days=days)


@router.get("/api/study/sessions")
def api_study_sessions(
    doc: str | None = Query(None),
    days: int = Query(90, ge=1, le=730),
) -> dict[str, Any]:
    """Working sessions derived from the study-event floor (gap-clustered, newest first),
    with a summary strip. Optionally scoped to one course."""
    return fetch_sessions(doc, days=days)


@router.get("/api/mistakes")
def api_mistakes(
    doc: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Most recent incorrectly answered quiz questions, newest first."""
    try:
        with db() as conn:
            rows = conn.execute(
                'SELECT section_key AS "sectionKey", extract(epoch from ts)::float8 AS ts, '
                "stem, expected FROM study_events WHERE correct = false "
                "AND (%(doc)s::text IS NULL OR doc = %(doc)s OR doc IS NULL) "
                "ORDER BY ts DESC LIMIT %(limit)s",
                {"doc": doc, "limit": limit},
            ).fetchall()
        return {"mistakes": rows}
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {"mistakes": [], "error": str(exc)}
