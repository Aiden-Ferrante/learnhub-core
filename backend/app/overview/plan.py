"""Course-level Today plan — the learning path promoted from chapter to course.

The chapter rail (frontend) executes a chapter; this assembler decides what
TODAY looks like across the course: where to resume (which chapter, which
stage), how many spaced reviews are due, and which chapter to build next
(feeding the chapter build queue's "queue tonight" flow).

Everything here is assembled from stores that already exist — chapter_progress,
concept_reviews, chapter_builds, concepts — no LLM, always fast.
"""

from __future__ import annotations

import re
import time
from typing import Any

from app.content.arango_content import fetch_latest_document
from app.content.arango_tree import connect_arango

# Mirrors lib/learn-path.ts PATH_STAGES — keep in sync (stage keys are the contract).
STAGE_ORDER: list[tuple[str, str]] = [
    ("orient", "Orient"),
    ("read", "Read"),
    ("skeleton", "Learn"),
    ("quizzes", "Quizzes"),
    ("exam", "Exam"),
    ("lockin", "Lock in"),
]


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


def build_plan(doc_id: str | None, hint_scope: str | None = None) -> dict[str, Any]:
    """Assemble the Today plan. ``hint_scope`` is the client's reading position
    (stored client-side), which wins over inferred recency when it maps to a chapter."""
    try:
        from app.platform.jobs import chapters_readiness
        from app.content.chapters import chapter_units

        db = connect_arango()
        doc_id = _resolve_doc_id(doc_id)
        if not doc_id:
            return {"error": "no document found"}

        # Canonical chapter list — same derivation as every other surface (app/chapters.py).
        chapters = chapter_units(doc_id).get("chapters", [])
        if not chapters:
            return {"docId": doc_id, "chapters": [], "resume": None, "reviewsDue": 0, "nextUnbuilt": None}
        chapter_keys = [c["key"] for c in chapters]
        readiness = chapters_readiness(doc_id, chapter_keys).get("chapters", {})

        progress: dict[str, dict[str, Any]] = {}
        if db.has_collection("chapter_progress"):
            for r in db.aql.execute(
                "FOR p IN chapter_progress FILTER p.docId == @d RETURN {scope: p.scope, stages: p.stages}",
                bind_vars={"d": doc_id},
            ):
                if r.get("scope"):
                    progress[r["scope"]] = r.get("stages") or {}

        def chapter_of(scope: str | None) -> str | None:
            if not scope:
                return None
            if scope in chapter_keys:
                return scope
            m = re.match(r"^toc:(\d+)", scope)
            if m and f"toc:{m.group(1)}" in chapter_keys:
                return f"toc:{m.group(1)}"
            return None

        # Resume: reading position → most recently touched chapter → first chapter.
        resume_key = chapter_of(hint_scope)
        if not resume_key:
            latest: tuple[str | None, int] = (None, 0)
            for scope, stages in progress.items():
                k = chapter_of(scope)
                if not k:
                    continue
                at = max((int(v.get("at") or 0) for v in stages.values() if isinstance(v, dict)), default=0)
                if at > latest[1]:
                    latest = (k, at)
            resume_key = latest[0] or chapters[0]["key"]

        stages = progress.get(resume_key, {})
        done = {k: bool(v.get("done")) for k, v in stages.items() if isinstance(v, dict)}
        next_stage = next(
            ({"key": k, "label": lbl} for k, lbl in STAGE_ORDER if not done.get(k)),
            {"key": STAGE_ORDER[-1][0], "label": STAGE_ORDER[-1][1]},
        )
        done_count = sum(1 for k, _ in STAGE_ORDER if done.get(k))

        due = 0
        if db.has_collection("concept_reviews"):
            due = db.aql.execute(
                "RETURN LENGTH(FOR r IN concept_reviews FILTER r.docId == @d "
                "AND r.due != null AND r.due <= @now RETURN 1)",
                bind_vars={"d": doc_id, "now": time.time()},
            ).next()

        # The next dark room: first chapter (reading order) with no concepts yet.
        next_unbuilt: dict[str, Any] | None = None
        for c in chapters:
            r = readiness.get(c["key"]) or {}
            if (r.get("concepts") or 0) == 0:
                next_unbuilt = {"key": c["key"], "title": c["title"], "build": r.get("build")}
                break

        resume_title = next((c["title"] for c in chapters if c["key"] == resume_key), resume_key)
        return {
            "docId": doc_id,
            "resume": {
                "scope": resume_key,
                "title": resume_title,
                "nextStage": next_stage,
                "stagesDone": done_count,
                "stagesTotal": len(STAGE_ORDER),
            },
            "reviewsDue": due,
            "nextUnbuilt": next_unbuilt,
            "chapters": [
                {
                    **c,
                    "concepts": (readiness.get(c["key"]) or {}).get("concepts", 0),
                    "explained": (readiness.get(c["key"]) or {}).get("explained", 0),
                }
                for c in chapters
            ],
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
