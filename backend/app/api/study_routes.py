"""API routes for the triple-era read surfaces still served to MCP clients.

Only two survive the concept-layer pivot: /api/deck (the MCP ``flashcard_deck``
tool) and /api/mistakes (recent wrong answers from the study-event floor). The
triple quiz/exam/Socratic-chat surfaces were removed with the rest of the
triple pipeline — concept_study_routes owns quizzing now.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.platform.db import db
from app.extraction.arango_learn import (
    fetch_triples_or_error,
    triple_id,
    triple_line,
)
from app.study.mastery import EVENTS_COLLECTION

router = APIRouter()


@router.get("/api/deck")
def api_deck(
    scope: str | None = Query(None),
    count: int = Query(20, ge=1, le=100),
    include_structural: bool = Query(False),
    doc: str | None = Query(None),
) -> dict[str, Any]:
    triples, err = fetch_triples_or_error(
        scope, limit=max(count * 3, 60), include_structural=include_structural, doc=doc
    )
    if err:
        return {"error": err, "cards": [], "tripleCount": 0}
    cards: list[dict[str, Any]] = []
    for t in triples[:count]:
        cards.append(
            {
                "id": triple_id(t),
                "front": f"Subject: {t['subject']}\n\nWhat predicate relates this to «{t['object']}»?",
                "back": f"Predicate: {t['predicate']}\n\nFull triple:\n{triple_line(t)}",
                "triple": t,
            }
        )
    return {"cards": cards, "tripleCount": len(triples), "scope": scope}


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
