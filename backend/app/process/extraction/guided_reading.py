"""Deep Chapter — the assembled reading-first chapter surface.

The chapter briefing is DERIVED, never stored: the ``ext_briefing`` view aggregates the
already-cached parts (orient objectives/watch-fors + skeleton essences) per (doc, scope),
and ``build_briefing`` layers on the concept preview (which needs the Python scope
resolver). Nothing is written — the briefing can never drift from its parts.

Per-concept "deep explanations" were retired (2026-07-15): they were a second,
UNGROUNDED explanation competing with the grounded ``signal``; the concept record now
has one explanation of record. The assembler never calls the LLM — it reads caches only,
so opening a chapter is always fast.
"""

from __future__ import annotations

import time
from typing import Any

from app.process.content import resolve_doc_id
from app.process.content import fetch_section_content

from app.gateways import db


# --------------------------------------------------------------------------- #
# Briefing — assembled, never LLM-fused
# --------------------------------------------------------------------------- #

def build_briefing(doc_id: str, scope: str | None) -> dict | None:
    """Assemble the chapter briefing — DERIVED, never stored. The relational part
    (objectives + watch-fors + section essences) comes from the ``ext_briefing`` view
    over orient + skeleton; the concept preview needs the Python scope resolver, so it is
    layered on here. Reads caches only — never calls the LLM — so opening a chapter never
    waits on a model. Returns None when nothing is cached yet.
    """
    from app.process.extraction.skeleton import _attach_depths

    with db() as conn:
        row = conn.execute(
            'SELECT objectives, watch_for AS "watchFor", sections FROM ext_briefing '
            "WHERE doc_id = %(d)s AND scope IS NOT DISTINCT FROM %(sc)s",
            {"d": doc_id, "sc": scope},
        ).fetchone() or {}

    objectives = row.get("objectives") or []
    watch_for = row.get("watchFor") or []
    sections = _attach_depths(doc_id, row.get("sections") or [])
    if not (objectives or watch_for or sections):
        return None

    key_concepts: list[dict[str, Any]] = []
    concept_count = 0
    if scope:
        from app.process.extraction.concept_store import fetch_section_concepts

        rows = fetch_section_concepts(scope, doc_id).get("concepts", [])
        concept_count = len(rows)
        key_concepts = [
            {"name": c.get("name"), "kind": c.get("kind"), "signal": c.get("signal")}
            for c in rows[:10]
        ]

    return {
        "docId": doc_id,
        "scope": scope,
        "objectives": objectives,
        "watchFor": watch_for,
        "sections": sections,
        "keyConcepts": key_concepts,
        "conceptCount": concept_count,
        "createdAt": int(time.time()),
    }


# --------------------------------------------------------------------------- #
# Status + assembler
# --------------------------------------------------------------------------- #

def deep_status(doc_id: str, scope: str | None) -> dict[str, Any]:
    """Readiness of the reading surface for a scope: whether the briefing's parts (orient /
    skeleton) are cached — the ext_briefing view has a row exactly when they are.
    ``running`` is kept for wire-compat; nothing backfills out-of-band anymore."""
    with db() as conn:
        has_briefing = conn.execute(
            "SELECT 1 FROM ext_briefing WHERE doc_id = %(d)s AND scope IS NOT DISTINCT FROM %(sc)s",
            {"d": doc_id, "sc": scope},
        ).fetchone() is not None
    return {"running": False, "briefing": has_briefing}


def fetch_guided_reading(doc_id: str | None, scope: str) -> dict[str, Any]:
    """One-call assembler for the Deep Chapter surface: briefing + full chapter
    markdown + concepts (with deep explanations) + cached section recaps.

    Reads caches only — never calls the LLM — so it is always fast; ``status``
    tells the client whether a prepare pass would enrich it."""
    try:
        doc_id = resolve_doc_id(doc_id)
        if not doc_id:
            return {"error": "no document found"}

        # include_figures: the chapter's captioned figures woven into the prose per section.
        content = fetch_section_content(scope, doc_id, include_figures=True)
        blocks = content.get("blocks", [])
        section_keys = sorted({b.get("sectionKey") for b in blocks if b.get("sectionKey")})

        from app.process.extraction.concept_store import fetch_section_concepts

        sec = fetch_section_concepts(scope, doc_id)
        concepts = sec.get("concepts", [])

        briefing = build_briefing(doc_id, scope)

        return {
            "docId": doc_id,
            "scope": scope,
            "briefing": briefing,
            "markdown": content.get("markdown", ""),
            "blocks": blocks,
            "concepts": concepts,
            "sections": sec.get("sections", []),
            "status": deep_status(doc_id, scope),
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
