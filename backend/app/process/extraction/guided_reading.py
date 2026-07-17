"""Deep Chapter — the assembled reading-first chapter surface.

One non-destructive, idempotent artifact: ``deep_chapter_briefing`` — a chapter
briefing ASSEMBLED from the already-cached artifacts (orient objectives/watch-fors
+ skeleton essences + key concepts), cached per (doc, scope).

Per-concept "deep explanations" were retired (2026-07-15): they were a second,
UNGROUNDED explanation competing with the grounded ``signal``; the concept record
now has one explanation of record. The GET assembler never calls the LLM — it
serves whatever is cached (and assembles+caches the briefing the moment its
orient/skeleton parts exist), so opening a chapter is always fast.
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

from app.process.content import resolve_doc_id
from app.process.content import fetch_section_content
from psycopg.types.json import Json

from app.gateways import db


def briefing_key(doc_id: str, scope: str | None) -> str:
    return hashlib.sha256(f"{doc_id}|{scope or 'ALL'}".encode()).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# Briefing — assembled, never LLM-fused
# --------------------------------------------------------------------------- #

def build_briefing(doc_id: str, scope: str | None) -> dict | None:
    """Assemble the chapter briefing from the cached orient/skeleton/concepts.

    Reads caches only — never calls the LLM — so opening a chapter never waits
    on a model. Returns None when nothing is cached yet.
    """
    from app.process.extraction.skeleton import _attach_depths, chapter_cache_key as skel_key

    with db() as conn:
        orient = conn.execute(
            'SELECT objectives, watch_for AS "watchFor" FROM chapter_orient WHERE key = %(k)s',
            {"k": skel_key(doc_id, scope)},
        ).fetchone() or {}
        cached = conn.execute(
            "SELECT sections FROM chapter_skeletons WHERE key = %(k)s",
            {"k": skel_key(doc_id, scope)},
        ).fetchone() or {}
    sections = _attach_depths(doc_id, cached.get("sections") or [])

    objectives = orient.get("objectives") or []
    watch_for = orient.get("watchFor") or []
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

    briefing = {
        "docId": doc_id,
        "scope": scope,
        "objectives": objectives,
        "watchFor": watch_for,
        "sections": sections,
        "keyConcepts": key_concepts,
        "conceptCount": concept_count,
        "createdAt": int(time.time()),
    }
    with db() as conn:
        conn.execute(
            "INSERT INTO deep_chapter_briefing (key, doc_id, scope, objectives, watch_for, sections, "
            "key_concepts, concept_count, created_at) VALUES "
            "(%(k)s,%(d)s,%(sc)s,%(obj)s,%(wf)s,%(sec)s,%(kc)s,%(cc)s, now()) "
            "ON CONFLICT (key) DO UPDATE SET doc_id=EXCLUDED.doc_id, scope=EXCLUDED.scope, "
            "objectives=EXCLUDED.objectives, watch_for=EXCLUDED.watch_for, sections=EXCLUDED.sections, "
            "key_concepts=EXCLUDED.key_concepts, concept_count=EXCLUDED.concept_count, created_at=EXCLUDED.created_at",
            {"k": briefing_key(doc_id, scope), "d": doc_id, "sc": scope, "obj": Json(objectives),
             "wf": Json(watch_for), "sec": Json(sections), "kc": Json(key_concepts), "cc": concept_count},
        )
    return briefing


# --------------------------------------------------------------------------- #
# Status + assembler
# --------------------------------------------------------------------------- #

def deep_status(doc_id: str, scope: str | None) -> dict[str, Any]:
    """Readiness of the reading surface for a scope: briefing presence.
    ``running`` is kept for wire-compat; nothing backfills out-of-band anymore."""
    with db() as conn:
        has_briefing = conn.execute(
            "SELECT 1 FROM deep_chapter_briefing WHERE key = %(k)s", {"k": briefing_key(doc_id, scope)}
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

        with db() as conn:
            briefing = conn.execute(
                'SELECT doc_id AS "docId", scope, objectives, watch_for AS "watchFor", sections, '
                'key_concepts AS "keyConcepts", concept_count AS "conceptCount" '
                "FROM deep_chapter_briefing WHERE key = %(k)s",
                {"k": briefing_key(doc_id, scope)},
            ).fetchone()
        if not briefing:
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
