"""Editing the material — the book's text, or one course's rewrite of it.

Two targets, chosen per edit, because they answer different needs:

``book``     writes ``raw_content.markdown``. Every course cut from that book sees it.
             This is for fixing the source: conversion junk, OCR damage, a mangled table.
``version``  writes ``version_blocks.markdown_override`` for the course you are in.
             Copy-on-write — the book and every other version keep the original, and a
             later fix to the book does not overwrite your rewrite.

A block keeps its key through an edit, and that is the whole point. Keys are minted at
conversion as ``{doc}__{order}``; ``version_blocks`` and every concept anchor point at
them, so re-splitting the document on save (the obvious way to "edit the markdown file")
would cascade away every version's material and orphan every concept. Editing is therefore
always per block, never a whole-document rewrite.

Staleness is derived, not stored: ``stale_sections`` compares when material last changed
against when its concepts were built. Nothing has to remember to set a flag, and a rebuild
clears it by construction.
"""

from __future__ import annotations

from typing import Any

from app.gateways import db
from app.process.content.documents import source_id_of

BOOK = "book"
VERSION = "version"


def section_material(doc_id: str, scope: str) -> dict[str, Any]:
    """The editable blocks of one section of this course, in reading order.

    Deliberately not ``fetch_section_content``: that serves the reader an assembled blob
    and a summary of its blocks, which is the right shape for reading and the wrong one for
    editing. An editor needs each block's key (what an edit addresses), its own markdown,
    and whether this course has already rewritten it.
    """
    from app.process.content.blocks import fetch_blocks
    from app.process.content.scope import scope_blocks

    rows = fetch_blocks(doc_id, markdown=True)
    rows = scope_blocks(doc_id, scope, rows=rows) if scope else rows
    return {
        "docId": doc_id,
        "scope": scope,
        "blocks": [
            {
                "blockKey": r.get("_key"),
                "sectionKey": r.get("sectionKey"),
                "heading": r.get("heading"),
                "markdown": r.get("markdown") or "",
                "charCount": r.get("charCount") or 0,
                "isRewritten": bool(r.get("isRewritten")),
                "editedAt": r.get("editedAt"),
            }
            for r in rows
        ],
    }


def edit_block(doc_id: str, block_key: str, markdown: str, target: str = VERSION) -> dict[str, Any]:
    """Rewrite one block's markdown. ``target='book'`` edits the source for every course;
    ``target='version'`` stores an override for this one. Returns ``{blockKey, target,
    charCount}``, or ``{error, status}``."""
    if target not in (BOOK, VERSION):
        return {"error": f"target must be '{BOOK}' or '{VERSION}'", "status": 400}
    if markdown is None:
        return {"error": "markdown is required", "status": 400}

    if target == BOOK:
        src = source_id_of(doc_id)
        with db() as conn:
            n = conn.execute(
                "UPDATE raw_content SET markdown = %(m)s, char_count = length(%(m)s), "
                "edited_at = now() WHERE key = %(k)s AND doc_id = %(d)s",
                {"m": markdown, "k": block_key, "d": src},
            ).rowcount
        if not n:
            return {"error": f"block {block_key} is not part of this book", "status": 404}
    else:
        with db() as conn:
            n = conn.execute(
                "UPDATE version_blocks SET markdown_override = %(m)s, edited_at = now() "
                "WHERE version_id = %(d)s AND content_key = %(k)s",
                {"m": markdown, "d": doc_id, "k": block_key},
            ).rowcount
        if not n:
            return {"error": f"block {block_key} is not in this course", "status": 404}

    return {"blockKey": block_key, "target": target, "charCount": len(markdown)}


def revert_block(doc_id: str, block_key: str) -> dict[str, Any]:
    """Drop this course's rewrite of a block and read the book again. A no-op on a block
    that was never rewritten, which keeps the button safe to press twice."""
    with db() as conn:
        n = conn.execute(
            "UPDATE version_blocks SET markdown_override = NULL, edited_at = now() "
            "WHERE version_id = %(d)s AND content_key = %(k)s AND markdown_override IS NOT NULL",
            {"d": doc_id, "k": block_key},
        ).rowcount
    return {"blockKey": block_key, "reverted": bool(n)}


def stale_sections(doc_id: str) -> dict[str, Any]:
    """Sections of this course whose material changed after their concepts were built —
    what the UI marks for a rebuild.

    Derived from timestamps, so it is always true and a rebuild clears it for free. A
    section with no concepts is not stale, it is unbuilt; the two read differently to the
    learner and the distinction is worth keeping. Concepts are the book's, so the join runs
    on the block's source section while the answer is keyed by this version's section.
    """
    src = source_id_of(doc_id)
    with db() as conn:
        rows = conn.execute(
            "SELECT COALESCE(vs.section_key, c.section_key) AS ver_key, "
            "  max(extract(epoch from COALESCE(vb.edited_at, c.edited_at))) AS edited, "
            "  min(extract(epoch from ec.created_at)) AS built "
            "FROM version_blocks vb "
            "JOIN raw_content c ON c.key = vb.content_key "
            "LEFT JOIN raw_structure vs ON vs.id = vb.structure_id "
            "JOIN ext_concepts ec ON ec.doc_id = %(src)s AND ec.section_key = c.section_key "
            "WHERE vb.version_id = %(d)s "
            "  AND COALESCE(vb.edited_at, c.edited_at) IS NOT NULL "
            "GROUP BY 1",
            {"d": doc_id, "src": src},
        ).fetchall()
    stale = [r["ver_key"] for r in rows if r.get("edited") and r.get("built") and r["edited"] > r["built"]]
    return {"docId": doc_id, "staleSections": sorted(stale)}
