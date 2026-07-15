"""Cross-domain readiness/coverage read models over the jobs ledger.

The black-box killers behind the course home's readiness ladder and the Process tab's
chapter × artifact-kind grid. These reports span every domain (concepts, deep overlay,
quizzes, guides, skeleton, audiobooks) plus the queue, which is why they live in
overview/ — above the domains — rather than inside any one of them.
"""

from __future__ import annotations

import os
from typing import Any

from app.content.scope import _blocks_in_scope, _scope_keys_from_outline, _section_level_fn
from app.extraction.concept_store import concept_count
from app.extraction.deep_chapter import BRIEFING, _bkey as briefing_key, ensure_deep_collections
from app.extraction.reading_guide import guide_status
from app.extraction.skeleton import (
    ORIENT,
    SKELETON_PROMPT_VERSION,
    SKELETONS,
    _key as chapter_cache_key,
    ensure_path_collections,
)
from app.media.audiobook import audiobook_path, timeline_path
from app.platform.arango import connect_arango
from app.platform.jobs import KINDS, _resolve_doc_id, ensure_builds_collection, list_builds
from app.study.concept_quiz_llm import scope_question_status


def chapters_readiness(doc_id: str | None, scopes: list[str]) -> dict[str, Any]:
    """Readiness ladder per chapter: concept coverage + deep coverage + any build job.
    Loads the doc's section blocks ONCE and spans each scope over them."""
    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    ensure_builds_collection(db)
    ensure_deep_collections(db)

    rows = list(
        db.aql.execute(
            "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
            bind_vars={"d": doc_id},
        )
    )
    level_of = _section_level_fn(doc_id)
    jobs = {j["scope"]: j for j in list_builds(doc_id).get("builds", [])}

    out: dict[str, Any] = {}
    for scope in scopes:
        keys = sorted({b.get("sectionKey") for b in _blocks_in_scope(rows, scope, level_of) if b.get("sectionKey")})
        concepts = concept_count(doc_id, list(keys))
        explained = 0
        if keys:
            explained = db.aql.execute(
                "RETURN LENGTH(FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks "
                "AND c.deepExplanation != null AND c.deepExplanation != '' RETURN 1)",
                bind_vars={"d": doc_id, "ks": list(keys)},
            ).next()
        briefing = db.collection(BRIEFING).get(briefing_key(doc_id, scope)) is not None
        job = jobs.get(scope)
        out[scope] = {
            "concepts": concepts,
            "explained": explained,
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
    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    ensure_builds_collection(db)
    ensure_deep_collections(db)
    ensure_path_collections(db)

    doc_row = db.collection("documents").get(doc_id) or {}
    top = [e for e in (doc_row.get("outline") or []) if (e.get("listDepth") or 0) == 0]
    numbered = [e for e in top if e.get("numberKey")]
    chapter_entries = [e for e in (numbered or top) if e.get("sectionKey")]

    blocks = list(
        db.aql.execute(
            "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
            bind_vars={"d": doc_id},
        )
    )
    level_of = _section_level_fn(doc_id)
    jobs_by = {
        (j["scope"], j.get("kind") or "build"): j
        for j in list_builds(doc_id, kind=None).get("builds", [])
    }

    def job_state(scope: str, kind: str) -> dict[str, Any] | None:
        j = jobs_by.get((scope, kind))
        if not j:
            return None
        return {k: j.get(k) for k in ("status", "notBefore", "phase", "done", "total", "error")}

    block_keys = {b.get("sectionKey") for b in blocks if b.get("sectionKey")}

    chapters: list[dict[str, Any]] = []
    for e in chapter_entries:
        scope = e["sectionKey"]
        # Outline nesting first — it bridges mixed keyspaces (numbered chapter toc:2 whose
        # sub-sections carry slug keys); reading-order span is the fallback. Same resolution
        # order as fetch_section_content, so the grid can't disagree with the reader.
        okeys = _scope_keys_from_outline(doc_id, scope)
        keys = sorted((okeys & block_keys) if okeys else set())
        if not keys:
            keys = sorted({b.get("sectionKey") for b in _blocks_in_scope(blocks, scope, level_of) if b.get("sectionKey")})
        skel_row = db.collection(SKELETONS).get(chapter_cache_key(doc_id, scope))
        skeleton = (
            "missing" if not (skel_row and skel_row.get("sections"))
            else ("fresh" if skel_row.get("promptVersion") == SKELETON_PROMPT_VERSION else "stale")
        )
        orient_row = db.collection(ORIENT).get(chapter_cache_key(doc_id, scope))
        quiz = scope_question_status(db, doc_id, set(keys)) if keys else {"total": 0, "authored": 0, "running": False}
        chapters.append(
            {
                "scope": scope,
                "title": e.get("title") or scope,
                "sections": len(keys),
                "concepts": concept_count(doc_id, keys),
                "quizzes": {"authored": quiz["authored"], "total": quiz["total"]},
                "skeleton": skeleton,
                "orient": bool(orient_row and (orient_row.get("objectives") or orient_row.get("watchFor"))),
                "briefing": db.collection(BRIEFING).get(briefing_key(doc_id, scope)) is not None,
                "guides": {k: v for k, v in guide_status(db, doc_id, scope).items() if k != "running"},
                "audiobooks": [
                    src for src in ("text", "guided", "concepts")
                    if os.path.exists(audiobook_path(doc_id, scope, src))
                ],
                "readAlong": os.path.exists(timeline_path(doc_id, scope, "text")),
                "jobs": {k: js for k in KINDS if (js := job_state(scope, k))},
            }
        )
    return {"docId": doc_id, "chapters": chapters}
