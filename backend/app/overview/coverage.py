"""Cross-domain readiness/coverage read models over the jobs ledger.

The black-box killers behind the course home's readiness ladder and the Process tab's
chapter × artifact-kind grid. These reports span every domain (concepts, deep overlay,
quizzes, guides, skeleton, audiobooks) plus the queue, which is why they live in
overview/ — above the domains — rather than inside any one of them.
"""

from __future__ import annotations

import os
from typing import Any

from app.content import scope_blocks
from app.extraction import concept_count
from app.extraction import briefing_key
from app.extraction import guide_status
from app.extraction import SKELETON_PROMPT_VERSION, chapter_cache_key
from app.media import audiobook_path, timeline_path
from app.platform import db
from app.content import resolve_doc_id
from app.platform import KINDS, list_builds
from app.study import scope_question_status


def chapters_readiness(doc_id: str | None, scopes: list[str]) -> dict[str, Any]:
    """Readiness ladder per chapter: concept coverage + deep coverage + any build job.
    Loads the doc's section blocks ONCE and spans each scope over them."""
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}

    with db() as conn:
        rows = conn.execute(
            'SELECT section_key AS "sectionKey", "order", heading, level '
            'FROM section_content WHERE doc_id = %(d)s ORDER BY "order"',
            {"d": doc_id},
        ).fetchall()
    jobs = {j["scope"]: j for j in list_builds(doc_id).get("builds", [])}

    out: dict[str, Any] = {}
    for scope in scopes:
        # One shared resolver (outline-first) — this used to skip the outline step and
        # could disagree with the reader about a chapter's extent on mixed keyspaces.
        keys = sorted({b.get("sectionKey") for b in scope_blocks(doc_id, scope, rows=rows) if b.get("sectionKey")})
        concepts = concept_count(doc_id, list(keys))
        with db() as conn:
            briefing = conn.execute(
                "SELECT 1 FROM deep_chapter_briefing WHERE key = %(k)s",
                {"k": briefing_key(doc_id, scope)},
            ).fetchone() is not None
        job = jobs.get(scope)
        out[scope] = {
            "concepts": concepts,
            "briefing": briefing,
            "build": {
                "status": job.get("status"),
                "notBefore": job.get("notBefore"),
                "phase": job.get("phase"),
                "done": job.get("done"),
                "total": job.get("total"),
                "error": job.get("error"),
            }
            if job
            else None,
        }
    return {"docId": doc_id, "chapters": out}


def chapters_coverage(doc_id: str | None) -> dict[str, Any]:
    """The black-box killer: every chapter × every artifact kind, with its state.

    Per chapter: concept count, quiz-authoring x/y, skeleton fresh/stale/missing,
    orient/briefing presence, guide x/y, generated audiobook sources, and any
    queued/running/failed job per kind. One call answers "what state is my library in"."""
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}

    with db() as conn:
        doc_row = conn.execute(
            "SELECT outline FROM documents WHERE key = %(d)s", {"d": doc_id}
        ).fetchone() or {}
        blocks = conn.execute(
            'SELECT section_key AS "sectionKey", "order", heading, level '
            'FROM section_content WHERE doc_id = %(d)s ORDER BY "order"',
            {"d": doc_id},
        ).fetchall()
    top = [e for e in (doc_row.get("outline") or []) if (e.get("listDepth") or 0) == 0]
    numbered = [e for e in top if e.get("numberKey")]
    chapter_entries = [e for e in (numbered or top) if e.get("sectionKey")]
    jobs_by = {
        (j["scope"], j.get("kind") or "build"): j
        for j in list_builds(doc_id, kind=None).get("builds", [])
    }

    def job_state(scope: str, kind: str) -> dict[str, Any] | None:
        j = jobs_by.get((scope, kind))
        if not j:
            return None
        return {k: j.get(k) for k in ("status", "notBefore", "phase", "done", "total", "error")}

    chapters: list[dict[str, Any]] = []
    for e in chapter_entries:
        scope = e["sectionKey"]
        keys = sorted({b.get("sectionKey") for b in scope_blocks(doc_id, scope, rows=blocks) if b.get("sectionKey")})
        with db() as conn:
            skel_row = conn.execute(
                "SELECT sections, prompt_version FROM chapter_skeletons WHERE key = %(k)s",
                {"k": chapter_cache_key(doc_id, scope)},
            ).fetchone()
            orient_row = conn.execute(
                "SELECT objectives, watch_for AS \"watchFor\" FROM chapter_orient WHERE key = %(k)s",
                {"k": chapter_cache_key(doc_id, scope)},
            ).fetchone()
            briefing_present = conn.execute(
                "SELECT 1 FROM deep_chapter_briefing WHERE key = %(k)s",
                {"k": briefing_key(doc_id, scope)},
            ).fetchone() is not None
        if not (skel_row and skel_row.get("sections")):
            skeleton = "missing"
        else:
            skeleton = "fresh" if (skel_row.get("prompt_version") or 0) == SKELETON_PROMPT_VERSION else "stale"
        quiz = scope_question_status(doc_id, set(keys)) if keys else {"total": 0, "authored": 0, "running": False}
        chapters.append(
            {
                "scope": scope,
                "title": e.get("title") or scope,
                "sections": len(keys),
                "concepts": concept_count(doc_id, keys),
                "quizzes": {"authored": quiz["authored"], "total": quiz["total"]},
                "skeleton": skeleton,
                "orient": bool(orient_row and (orient_row.get("objectives") or orient_row.get("watchFor"))),
                "briefing": briefing_present,
                "guides": {k: v for k, v in guide_status(doc_id, scope).items() if k != "running"},
                "audiobooks": [
                    src for src in ("text", "guided", "concepts")
                    if os.path.exists(audiobook_path(doc_id, scope, src))
                ],
                "readAlong": os.path.exists(timeline_path(doc_id, scope, "text")),
                "jobs": {k: js for k in KINDS if (js := job_state(scope, k))},
            }
        )
    return {"docId": doc_id, "chapters": chapters}
