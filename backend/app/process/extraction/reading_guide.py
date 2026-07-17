"""LLM-authored GUIDED READING — a focus note + comprehension Q&A per chapter sub-section.

The reader sees the book's OWN text (never a rewrite), scaffolded: a brief "what to focus on"
before each section and a couple of check-yourself questions (with revealable answers) after it,
with the section's place in the skeleton highlighted. Guidance is grounded in each section's
passage, cached per section, and authored lazily in the background — keyless/local, same infra
as the concept quiz.
"""

from __future__ import annotations

import hashlib
import os
from typing import Any

from app.process.content import resolve_doc_id
from psycopg.types.json import Json

from app.gateways import db
from app.process.content import load_section_blocks
from app.gateways import ollama_structured_completion
from app.gateways import ReadingGuide

# Reuse the quiz authoring model override unless a reading-specific one is set.
_AUTHOR_MODEL = (
    os.environ.get("LEARN_READING_AUTHOR_MODEL") or os.environ.get("LEARN_QUIZ_AUTHOR_MODEL") or None
)
_MAX_PASSAGE = 3500

AUTHOR_SYSTEM = (
    "You are a reading tutor guiding a learner through ONE section of a textbook. You are given the "
    "section heading and its text. Ground everything ONLY in that text — never invent facts.\n"
    "Produce:\n"
    "- focus: ONE or TWO sentences naming what to pay attention to while reading this section — the "
    "key idea, a distinction to watch for, or why it matters. Directive and specific (\"Notice how X "
    "differs from Y\"), not a summary of the section.\n"
    "- checks: TWO short comprehension questions a reader should be able to answer after reading this "
    "section, each with a concise model answer (1-2 sentences). Test understanding, not trivia.\n"
    "No markdown, no preamble."
)

def _key(doc: str | None, sk: str) -> str:
    return hashlib.sha256(f"{doc}|{sk}".encode()).hexdigest()[:16]


def _blocks(doc: str, scope: str | None) -> list[dict[str, Any]]:
    """The chapter's section blocks (heading + its own text), in reading order."""
    try:
        secs = load_section_blocks(doc, scope=scope)
        return [
            {
                "sectionKey": s.section_key,
                "heading": s.heading,
                "markdown": s.markdown,
                "pageStart": s.page_start,
                "pageEnd": s.page_end,
            }
            for s in secs
        ]
    except Exception:  # noqa: BLE001
        return []


def author_reading_guide(section: dict[str, Any], model: str | None = None) -> dict[str, Any] | None:
    """Author + validate the focus note and checks for one section. None on failure."""
    heading = (section.get("heading") or "").strip()
    text = (section.get("markdown") or "").strip()
    if len(text) < 80:
        return None
    user = f"Section: {heading}\n\nText:\n{text[:_MAX_PASSAGE]}"
    obj, err = ollama_structured_completion(
        [{"role": "system", "content": AUTHOR_SYSTEM}, {"role": "user", "content": user}],
        ReadingGuide,
        temperature=0.3,
        model=model,
    )
    if err or not obj:
        return None
    focus = (obj.get("focus") or "").strip()
    checks = []
    for c in obj.get("checks") or []:
        q, a = (c.get("q") or "").strip(), (c.get("a") or "").strip()
        if q and a:
            checks.append({"q": q, "a": a})
    if not focus and not checks:
        return None
    return {"focus": focus, "checks": checks[:3]}


def author_guides_sync(doc: str | None, scope: str | None, on_progress=None) -> dict:
    """Author guides for every un-guided section in scope, sequentially. Synchronous so the
    build queue can run it as a ledgered job; returns an {authored, total} receipt."""
    blocks = _blocks(doc, scope)
    with db() as conn:
        existing = {
            r["key"] for r in conn.execute(
                "SELECT key FROM ext_guides WHERE doc_id = %(d)s", {"d": doc}
            ).fetchall()
        }
    authored = 0
    for i, b in enumerate(blocks):
        k = _key(doc, b["sectionKey"])
        if k not in existing:
            g = author_reading_guide(b, model=_AUTHOR_MODEL)
            if g:
                with db() as conn:
                    conn.execute(
                        "INSERT INTO ext_guides (key, doc_id, structure_id, section_key, focus, checks, created_at) "
                        "VALUES (%(k)s,%(d)s,(SELECT id FROM raw_structure WHERE id = %(sid)s),%(sk)s,%(focus)s,%(checks)s, now()) "
                        "ON CONFLICT (key) DO UPDATE SET structure_id=EXCLUDED.structure_id, focus=EXCLUDED.focus, checks=EXCLUDED.checks",
                        {"k": k, "d": doc, "sid": f"{doc}::{b['sectionKey']}", "sk": b["sectionKey"],
                         "focus": g.get("focus"), "checks": Json(g.get("checks"))},
                    )
                authored += 1
        if on_progress:
            on_progress(i + 1, len(blocks), b.get("heading"))
    return {"authored": authored, "total": len(blocks)}


def _enqueue_backfill(doc: str | None, scope: str | None) -> None:
    """Queue guide authoring on the processing ledger (visible, restart-safe) —
    replaces the old fire-and-forget daemon thread. Best-effort."""
    try:
        from app.gateways import enqueue_build

        enqueue_build(doc, scope or "", kind="guides")
    except Exception:  # noqa: BLE001 — the read path must not break on a queue hiccup
        pass


def guide_status(doc: str | None, scope: str | None) -> dict[str, Any]:
    blocks = _blocks(doc, scope)
    total = len(blocks)
    with db() as conn:
        existing = {
            r["key"] for r in conn.execute(
                "SELECT key FROM ext_guides WHERE doc_id = %(d)s", {"d": doc}
            ).fetchall()
        }
    authored = sum(1 for b in blocks if _key(doc, b["sectionKey"]) in existing)
    # Running = a guides job for this scope is live on the ledger (was an in-process flag).
    running = False
    try:
        from app.gateways import list_builds

        running = any(
            j.get("scope") == (scope or "") and j.get("status") in ("queued", "running")
            for j in list_builds(doc, kind="guides").get("builds", [])
        )
    except Exception:  # noqa: BLE001
        pass
    return {"total": total, "authored": authored, "running": running}


def fetch_reading_guide(doc: str | None, scope: str | None) -> dict[str, Any]:
    """The guided read for a chapter: each section's text + skeleton position (depth/essence) +
    cached focus note + checks. Triggers background authoring for any section not guided yet."""
    try:
        doc = resolve_doc_id(doc)
        if not doc:
            return {"error": "no document found", "sections": []}
        blocks = _blocks(doc, scope)
        if not blocks:
            return {"docId": doc, "scope": scope, "sections": []}

        depth_by: dict[str, int] = {}
        ess_by: dict[str, str] = {}
        try:
            from app.process.extraction.skeleton import _attach_depths, chapter_cache_key as _skel_key

            secs = [{"sectionKey": b["sectionKey"], "heading": b["heading"]} for b in blocks]
            _attach_depths(doc, secs)
            depth_by = {s["sectionKey"]: s.get("depth", 0) for s in secs}
            with db() as conn:
                skel = conn.execute(
                    "SELECT sections FROM ext_skeleton WHERE key = %(k)s",
                    {"k": _skel_key(doc, scope)},
                ).fetchone()
            if skel:
                ess_by = {
                    s.get("sectionKey"): s.get("essence") or ""
                    for s in (skel.get("sections") or [])
                }
        except Exception:  # noqa: BLE001 — position is supplementary
            pass

        with db() as conn:
            guides = {
                r["key"]: r for r in conn.execute(
                    "SELECT key, focus, checks FROM ext_guides WHERE doc_id = %(d)s", {"d": doc}
                ).fetchall()
            }
        sections = []
        for b in blocks:
            sk = b["sectionKey"]
            g = guides.get(_key(doc, sk))
            sections.append(
                {
                    "sectionKey": sk,
                    "heading": b["heading"],
                    "markdown": b["markdown"],
                    "depth": depth_by.get(sk, 0),
                    "essence": ess_by.get(sk, ""),
                    "focus": (g or {}).get("focus") or "",
                    "checks": (g or {}).get("checks") or [],
                    "pageStart": b.get("pageStart"),
                    "pageEnd": b.get("pageEnd"),
                }
            )
        if scope and any(not sec["focus"] and not sec["checks"] for sec in sections):
            _enqueue_backfill(doc, scope)  # lazy backfill, on the ledger
        return {"docId": doc, "scope": scope, "sections": sections}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "sections": []}
