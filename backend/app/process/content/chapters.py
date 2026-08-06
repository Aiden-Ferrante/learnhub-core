"""Canonical chapter units — THE single source for "what are this book's chapters".

The course dashboard's syllabus tree (get_toc_tree) is the outline of record, and
a unit is EXACTLY one of its top-level nodes — same keys, titles, and order — so
the Process build list, the chapter pickers, and the course page can never
disagree. Content-less units (e.g. a curated-but-visible "Back Cover") are still
listed, flagged ``hasContent: false``; consumers style or disable, never filter
silently. (Part containers don't need special-casing here: the convert-time parts
stage already demotes them out of the top level.)
"""

from __future__ import annotations

import re
from typing import Any

from app.process.content.documents import resolve_doc_id
from app.process.content.toc_tree import get_toc_tree
from app.gateways import db
from app.process.content.blocks import fetch_blocks


def chapter_units(doc_id: str | None) -> dict[str, Any]:
    try:
        doc_id = resolve_doc_id(doc_id)
        if not doc_id:
            return {"error": "no document found"}

        forest, _sections, err = get_toc_tree(doc_id)
        if err:
            return {"docId": doc_id, "chapters": [], "error": err}

        from app.process.content.scope import scope_blocks

        rows = fetch_blocks(doc_id)
        def has_content(key: str) -> bool:
            # Same outline-first rule as fetch_section_content (one shared resolver).
            try:
                return bool(scope_blocks(doc_id, key, rows=rows))
            except Exception:  # noqa: BLE001
                return False

        # One unit per visible top-level tree node — the tree IS the list. `label`
        # rides along so consumers can render the SAME numbered title the syllabus
        # tree shows (numberSections/numberedSectionTitle need it).
        units = [
            {
                "key": n["sectionKey"],
                "title": n.get("title") or n.get("label") or n["sectionKey"],
                "label": n.get("label") or "",
                "hasContent": has_content(n["sectionKey"]),
            }
            for n in forest
            if n.get("isSection") and n.get("sectionKey")
        ]
        return {"docId": doc_id, "chapters": units}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


# Sections map to their chapter by number prefix ("toc:2.1" -> "toc:2"); slug keys are
# their own chapter. Mirrors the outline's listDepth-0 topology.
_CHAPTER_OF = re.compile(r"^toc:(\d+)(?:\.\d+)*(?:~\d+)?$")


def chapter_key_of(section_key: str) -> str:
    m = _CHAPTER_OF.match(section_key or "")
    return f"toc:{m.group(1)}" if m else (section_key or "")


def _resolve_chapter(tops: list[dict], ref: str) -> dict | None:
    """Resolve a chapter reference to its top-level outline entry. `ref` may be a chapter NUMBER
    ('3' → numberKey '3'), an exact sectionKey ('toc:3' / 'toc:preface'), or a title substring."""
    ref = (ref or "").strip()
    if not ref:
        return None
    low = ref.lower()
    # 1) exact numberKey (chapter number)
    for e in tops:
        if str(e.get("numberKey") or "").strip() == ref:
            return e
    # 2) exact sectionKey
    for e in tops:
        if (e.get("sectionKey") or "") == ref:
            return e
    # 3) title substring (first match in reading order)
    for e in tops:
        if low in (e.get("title") or "").lower():
            return e
    return None


def fetch_chapter(doc_id: str | None, ref: str, max_chars: int = 0) -> dict[str, Any]:
    """Pull an ENTIRE chapter's text. Resolves `ref` against the document outline, then gathers
    every content block in that chapter's PAGE SPAN (start page → the next top-level entry's
    page) — robust to the outline/section_content key mismatch — and returns the concatenated
    markdown plus the chapter's sub-section list and an approximate token count.
    Errors return ``{error, status}`` (404s carry the available chapter list)."""
    from app.process.content.store import fetch_outline

    data = fetch_outline(doc_id)
    if data.get("error"):
        return {"error": data["error"], "status": 503}
    outline = data.get("outline") or []
    resolved_doc = data.get("docId") or doc_id
    # Top-level entries sorted by page define the chapter boundaries.
    tops = sorted(
        [e for e in outline if (e.get("listDepth") or 0) == 0 and e.get("page") is not None],
        key=lambda e: e["page"],
    )
    if not tops:
        return {"error": "document has no paged outline", "status": 404}
    target = _resolve_chapter(tops, ref)
    if not target:
        return {
            "error": f"chapter '{ref}' not found",
            "status": 404,
            "available": [
                {"number": e.get("numberKey"), "title": e.get("title"),
                 "sectionKey": e.get("sectionKey"), "page": e.get("page")}
                for e in tops
            ],
        }
    start = target["page"]
    # End = the page of the next top-level entry that starts strictly later (handles ties).
    later = [e["page"] for e in tops if e["page"] > start]
    end = min(later) if later else 10**9

    blocks = fetch_blocks(
        resolved_doc,
        markdown=True,
        where="AND c.page_start IS NOT NULL AND c.page_start >= %(s)s AND c.page_start < %(e)s",
        params={"s": start, "e": end},
        order='c.page_start ASC, vb."order" ASC',
    )
    markdown = "\n\n".join(b.get("markdown") or "" for b in blocks if b.get("markdown")).strip()
    truncated = False
    if max_chars and len(markdown) > max_chars:
        markdown = markdown[:max_chars].rstrip()
        truncated = True
    subsections = [
        {"title": e.get("title"), "sectionKey": e.get("sectionKey"), "page": e.get("page")}
        for e in outline
        if (e.get("listDepth") or 0) > 0 and e.get("page") is not None and start <= e["page"] < end
    ]
    return {
        "docId": resolved_doc,
        "ref": ref,
        "chapter": {
            "number": target.get("numberKey"),
            "title": target.get("title"),
            "sectionKey": target.get("sectionKey"),
            "pageStart": start,
            "pageEnd": (end - 1) if end < 10**9 else (blocks[-1]["pageEnd"] if blocks else start),
        },
        "subsections": subsections,
        "blockCount": len(blocks),
        "charCount": len(markdown),
        "approxTokens": len(markdown) // 4,
        "truncated": truncated,
        "markdown": markdown,
    }
