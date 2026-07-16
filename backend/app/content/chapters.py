"""Canonical chapter units — THE single source for "what are this book's chapters".

The course dashboard's syllabus tree (get_toc_tree) is the outline of record.
Every other surface — the guided-reading picker, the book reader's chapter list,
the Today plan — must derive its chapter list from here, so they cannot drift.

A unit is a tree node that actually spans section content; content-less
containers (e.g. DDIA's "Part I", which exists only in the outline) are
descended into rather than listed, so their chapters surface individually.
"""

from __future__ import annotations

import re
from typing import Any

from app.content.documents import resolve_doc_id
from app.content.toc_tree import get_toc_tree
from app.platform import db


def chapter_units(doc_id: str | None) -> dict[str, Any]:
    try:
        doc_id = resolve_doc_id(doc_id)
        if not doc_id:
            return {"error": "no document found"}

        forest, _sections, err = get_toc_tree(doc_id)
        if err:
            return {"docId": doc_id, "chapters": [], "error": err}

        from app.content.scope import scope_blocks

        with db() as conn:
            rows = conn.execute(
                'SELECT section_key AS "sectionKey", "order", heading, level '
                'FROM section_content WHERE doc_id = %(d)s ORDER BY "order"',
                {"d": doc_id},
            ).fetchall()
        def has_content(key: str) -> bool:
            # Same outline-first rule as fetch_section_content (one shared resolver).
            try:
                return bool(scope_blocks(doc_id, key, rows=rows))
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
