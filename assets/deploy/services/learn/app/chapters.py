"""Canonical chapter units — THE single source for "what are this book's chapters".

The course dashboard's syllabus tree (get_toc_tree) is the outline of record.
Every other surface — the deep-chapter picker, the book reader's chapter list,
the Today plan — must derive its chapter list from here, so they cannot drift.

A unit is a tree node that actually spans section content; content-less
containers (e.g. DDIA's "Part I", which exists only in the outline) are
descended into rather than listed, so their chapters surface individually.
"""

from __future__ import annotations

import re
from typing import Any

from app.arango_content import fetch_latest_document
from app.arango_tree import connect_arango, get_toc_tree


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


def chapter_units(doc_id: str | None) -> dict[str, Any]:
    try:
        db = connect_arango()
        doc_id = _resolve_doc_id(doc_id)
        if not doc_id:
            return {"error": "no document found"}

        forest, _sections, err, _mentions = get_toc_tree(doc_id)
        if err:
            return {"docId": doc_id, "chapters": [], "error": err}

        from app.extract import _blocks_in_scope, _scope_keys_from_outline, _section_level_fn

        rows = list(
            db.aql.execute(
                "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
                bind_vars={"d": doc_id},
            )
        )
        block_keys = {r.get("sectionKey") for r in rows}
        level_of = _section_level_fn(db, doc_id)

        def has_content(key: str) -> bool:
            # Same outline-first rule as fetch_section_content/_load_section_blocks.
            try:
                okeys = _scope_keys_from_outline(db, doc_id, key)
                if okeys and okeys & block_keys:
                    return True
                return bool(_blocks_in_scope(rows, key, level_of))
            except Exception:  # noqa: BLE001
                return False

        units: list[dict[str, str]] = []

        def has_numbered_descendant(n: dict[str, Any]) -> bool:
            for c in n.get("children") or []:
                if re.match(r"^toc:\d+$", c.get("sectionKey") or "") or has_numbered_descendant(c):
                    return True
            return False

        def visit(nodes: list[dict[str, Any]] | None) -> None:
            for n in nodes or []:
                key = n.get("sectionKey")
                if not (n.get("isSection") and key):
                    continue
                # A container holding numbered chapters (e.g. DDIA's "Part I") is never
                # itself a unit — its chapters are.
                if not re.match(r"^toc:\d+$", key) and has_numbered_descendant(n):
                    visit(n.get("children"))
                    continue
                if has_content(key):
                    units.append({"key": key, "title": n.get("title") or n.get("label") or key})
                else:
                    visit(n.get("children"))

        visit(forest)
        return {"docId": doc_id, "chapters": units}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
