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
import threading
import time
from typing import Any

from app.content.documents import fetch_latest_document
from app.platform.arango import connect_arango
from app.extraction.extract import _load_section_blocks
from app.platform.llm import ollama_structured_completion
from app.platform.llm_schemas import ReadingGuide

GUIDE_COL = "reading_guides"
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

_inflight: set[str] = set()
_inflight_lock = threading.Lock()


def _key(doc: str | None, sk: str) -> str:
    return hashlib.sha256(f"{doc}|{sk}".encode()).hexdigest()[:16]


def _ensure_col(db) -> None:
    if not db.has_collection(GUIDE_COL):
        col = db.create_collection(GUIDE_COL)
        col.add_persistent_index(fields=["docId"])


def _blocks(db, doc: str, scope: str | None) -> list[dict[str, Any]]:
    """The chapter's section blocks (heading + its own text), in reading order."""
    try:
        secs = _load_section_blocks(db, doc, scope=scope)
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


def author_guides_sync(db, doc: str | None, scope: str | None, on_progress=None) -> dict:
    """Author guides for every un-guided section in scope, sequentially. Synchronous so the
    build queue can run it as a ledgered job; returns an {authored, total} receipt."""
    _ensure_col(db)
    col = db.collection(GUIDE_COL)
    blocks = _blocks(db, doc, scope)
    authored = 0
    for i, b in enumerate(blocks):
        k = _key(doc, b["sectionKey"])
        if not col.has(k):
            g = author_reading_guide(b, model=_AUTHOR_MODEL)
            if g:
                col.insert(
                    {"_key": k, "docId": doc, "sectionKey": b["sectionKey"], **g, "createdAt": int(time.time())},
                    overwrite=True,
                )
                authored += 1
        if on_progress:
            on_progress(i + 1, len(blocks), b.get("heading"))
    return {"authored": authored, "total": len(blocks)}


def _ensure_worker(doc: str | None, scope: str | None, sig: str) -> None:
    try:
        db = connect_arango()
        author_guides_sync(db, doc, scope)
    except Exception:  # noqa: BLE001 — best-effort backfill
        pass
    finally:
        with _inflight_lock:
            _inflight.discard(sig)


def ensure_guides_async(doc: str | None, scope: str | None) -> bool:
    """Fire-and-forget: author guidance for un-guided sections of a chapter. Guarded per scope."""
    if not scope:
        return False
    sig = f"{doc}|{scope}"
    with _inflight_lock:
        if sig in _inflight:
            return False
        _inflight.add(sig)
    threading.Thread(target=_ensure_worker, args=(doc, scope, sig), daemon=True).start()
    return True


def guide_status(db, doc: str | None, scope: str | None) -> dict[str, Any]:
    blocks = _blocks(db, doc, scope)
    total = len(blocks)
    col = db.collection(GUIDE_COL) if db.has_collection(GUIDE_COL) else None
    authored = sum(1 for b in blocks if col and col.has(_key(doc, b["sectionKey"]))) if col else 0
    with _inflight_lock:
        running = f"{doc}|{scope}" in _inflight
    return {"total": total, "authored": authored, "running": running}


def prepare_guides(db, doc: str | None, scope: str | None) -> dict[str, Any]:
    ensure_guides_async(doc, scope)
    return guide_status(db, doc, scope)


def fetch_reading_guide(doc: str | None, scope: str | None) -> dict[str, Any]:
    """The guided read for a chapter: each section's text + skeleton position (depth/essence) +
    cached focus note + checks. Triggers background authoring for any section not guided yet."""
    try:
        db = connect_arango()
        if doc is None:
            d = (fetch_latest_document() or {}).get("document")
            doc = d.get("id") if d else None
        if not doc:
            return {"error": "no document found", "sections": []}
        blocks = _blocks(db, doc, scope)
        if not blocks:
            return {"docId": doc, "scope": scope, "sections": []}

        depth_by: dict[str, int] = {}
        ess_by: dict[str, str] = {}
        try:
            from app.extraction.skeleton import SKELETONS, _attach_depths, _key as _skel_key

            secs = [{"sectionKey": b["sectionKey"], "heading": b["heading"]} for b in blocks]
            _attach_depths(db, doc, secs)
            depth_by = {s["sectionKey"]: s.get("depth", 0) for s in secs}
            if db.has_collection(SKELETONS):
                skel = db.collection(SKELETONS).get(_skel_key(doc, scope))
                if skel:
                    ess_by = {
                        s.get("sectionKey"): s.get("essence") or ""
                        for s in (skel.get("sections") or [])
                    }
        except Exception:  # noqa: BLE001 — position is supplementary
            pass

        gcol = db.collection(GUIDE_COL) if db.has_collection(GUIDE_COL) else None
        sections = []
        for b in blocks:
            sk = b["sectionKey"]
            g = gcol.get(_key(doc, sk)) if gcol else None
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
        ensure_guides_async(doc, scope)  # lazy backfill
        return {"docId": doc, "scope": scope, "sections": sections}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "sections": []}
