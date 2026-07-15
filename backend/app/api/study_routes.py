"""API routes over the study-event floor served to MCP clients.

One survivor of the concept-layer pivot: /api/mistakes (recent wrong answers).
The triple-era deck/quiz/exam/Socratic surfaces were removed with the triple
pipeline — concept_study_routes owns quizzing now.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.platform import db

router = APIRouter()


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
