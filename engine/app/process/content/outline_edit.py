"""Editing a course's outline — its chapters, their nesting, and what sits in each.

The outline is `raw_structure`, and it is owned by the VERSION, so re-cutting it is the
act that makes a course yours rather than the book's.

Saves are whole-outline, not per-move. The client sends the tree it wants and this
reconciles: existing nodes are UPDATED in place, new ones inserted, missing ones deleted.
Updating in place is not an optimisation — a node's id is ``doc_id::section_key`` and
``version_blocks.structure_id`` points at it, so delete-and-recreate would unplace every
block in the course on every reorder.

**Deleting outline nodes is refused on a Default version.** Concepts anchor to the book's
canonical tree — which *is* the Default's, since a book and its Default share a key — with
``ON DELETE CASCADE``. Dropping a Default section would silently delete the concepts every
other version inherits from it. Custom versions carry no such anchors, so they may cut
freely. Renaming, reordering and nesting are safe everywhere.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from app.gateways import db
from app.process.content.documents import structure_id

_SAFE_KEY = re.compile(r"^toc:[A-Za-z0-9._~-]{1,80}$")


def _mint_key() -> str:
    """A section key for a node the user just added. Slug-shaped on purpose: scope
    resolution reads nesting from the outline first and only falls back to numeric-key
    ancestry, so a non-numeric key nests correctly without pretending to be chapter 4.2."""
    return f"toc:new-{uuid.uuid4().hex[:8]}"


def save_outline(doc_id: str, nodes: list[dict[str, Any]]) -> dict[str, Any]:
    """Reconcile this course's outline to ``nodes`` — an ordered flat list, each
    ``{sectionKey?, title, depth}``, exactly the shape the reader consumes. ``sectionKey``
    absent means a new section and one is minted. Returns the saved outline."""
    if not isinstance(nodes, list) or not nodes:
        return {"error": "an outline needs at least one section", "status": 400}

    prepared: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, n in enumerate(nodes):
        key = (n.get("sectionKey") or "").strip() or _mint_key()
        if not _SAFE_KEY.match(key):
            return {"error": f"invalid section key {key!r}", "status": 400}
        if key in seen:
            return {"error": f"duplicate section key {key!r}", "status": 400}
        seen.add(key)
        try:
            depth = max(0, int(n.get("depth") or 0))
        except (TypeError, ValueError):
            return {"error": f"section {key!r} has a non-numeric depth", "status": 400}
        # A tree cannot start below the root or jump a level; clamping keeps a malformed
        # payload from producing a node whose parent is itself further down the list.
        if i == 0:
            depth = 0
        else:
            depth = min(depth, prepared[-1]["depth"] + 1)
        prepared.append({"key": key, "title": (n.get("title") or "").strip(), "depth": depth})

    # parent_id from the depth stack — the same rule the converter uses, so a hand-edited
    # outline and a converted one are the same kind of object.
    stack: list[tuple[int, str]] = []
    for i, p in enumerate(prepared):
        node_id = structure_id(doc_id, p["key"])
        while stack and stack[-1][0] >= p["depth"]:
            stack.pop()
        p["id"] = node_id
        p["parent_id"] = stack[-1][1] if stack else None
        p["order"] = i
        p["kind"] = "chapter" if p["depth"] == 0 else "section"
        stack.append((p["depth"], node_id))

    with db() as conn, conn.transaction():
        row = conn.execute(
            "SELECT origin FROM raw_documents WHERE key = %(d)s", {"d": doc_id}
        ).fetchone()
        if not row:
            return {"error": f"course {doc_id} not found", "status": 404}
        existing = {
            r["section_key"]
            for r in conn.execute(
                "SELECT section_key FROM raw_structure WHERE doc_id = %(d)s", {"d": doc_id}
            ).fetchall()
        }
        removed = existing - seen
        if removed and row["origin"] == "default":
            return {
                "error": (
                    "sections cannot be removed from the Default course — its outline is the "
                    "book's own, and the concepts every other course inherits are anchored to "
                    "it. Make a course from this book and cut that one instead."
                ),
                "status": 409,
            }

        for p in prepared:
            conn.execute(
                'INSERT INTO raw_structure (id, doc_id, parent_id, section_key, kind, title, '
                'depth, "order") '
                "VALUES (%(id)s,%(d)s,%(p)s,%(k)s,%(kind)s,%(t)s,%(depth)s,%(o)s) "
                "ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, "
                # Identity columns the converter owns (number_label, pages, hidden_reason)
                # are deliberately left alone — this edits shape and naming, not provenance.
                'kind = EXCLUDED.kind, title = EXCLUDED.title, depth = EXCLUDED.depth, '
                '"order" = EXCLUDED."order"',
                {"id": p["id"], "d": doc_id, "p": p["parent_id"], "k": p["key"],
                 "kind": p["kind"], "t": p["title"], "depth": p["depth"], "o": p["order"]},
            )
        if removed:
            # version_blocks.structure_id is ON DELETE SET NULL, so the blocks survive as
            # unplaced material rather than vanishing with the section that held them.
            conn.execute(
                "DELETE FROM raw_structure WHERE doc_id = %(d)s AND section_key = ANY(%(ks)s::text[])",
                {"d": doc_id, "ks": list(removed)},
            )
        conn.execute(
            "UPDATE raw_documents SET section_count = %(n)s, last_updated = now() "
            "WHERE key = %(d)s",
            {"n": len(prepared), "d": doc_id},
        )

    return {
        "docId": doc_id,
        "sections": [
            {"sectionKey": p["key"], "title": p["title"], "depth": p["depth"]} for p in prepared
        ],
        "removed": sorted(removed),
    }


def move_blocks(doc_id: str, block_keys: list[str], section_key: str) -> dict[str, Any]:
    """Place blocks under a different section of this course. The blocks themselves do not
    move — only where this course files them, which is why it costs one column."""
    if not block_keys:
        return {"error": "no blocks given", "status": 400}
    target = structure_id(doc_id, section_key)
    with db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM raw_structure WHERE id = %(id)s", {"id": target}
        ).fetchone()
        if not exists:
            return {"error": f"section {section_key} is not in this course", "status": 404}
        n = conn.execute(
            "UPDATE version_blocks SET structure_id = %(s)s "
            "WHERE version_id = %(d)s AND content_key = ANY(%(ks)s::text[])",
            {"s": target, "d": doc_id, "ks": list(block_keys)},
        ).rowcount
    return {"moved": n, "sectionKey": section_key}


def remove_blocks(doc_id: str, block_keys: list[str]) -> dict[str, Any]:
    """Drop material from THIS course — the actual act of distilling. The book keeps every
    word and the other courses are untouched; this course simply stops teaching it."""
    if not block_keys:
        return {"error": "no blocks given", "status": 400}
    with db() as conn:
        n = conn.execute(
            "DELETE FROM version_blocks WHERE version_id = %(d)s "
            "AND content_key = ANY(%(ks)s::text[])",
            {"d": doc_id, "ks": list(block_keys)},
        ).rowcount
    return {"removed": n}


def unplaced_blocks(doc_id: str) -> dict[str, Any]:
    """Material this course keeps but files under no section — what a delete leaves behind,
    and what would otherwise be invisible. Surfacing it is how the editor keeps a cut
    honest: nothing disappears silently, it just becomes unplaced."""
    with db() as conn:
        rows = conn.execute(
            'SELECT c.key AS "blockKey", c.section_key AS "sourceSectionKey", c.heading, '
            'length(COALESCE(vb.markdown_override, c.markdown)) AS "charCount" '
            "FROM version_blocks vb JOIN raw_content c ON c.key = vb.content_key "
            'WHERE vb.version_id = %(d)s AND vb.structure_id IS NULL ORDER BY vb."order"',
            {"d": doc_id},
        ).fetchall()
    return {"docId": doc_id, "blocks": rows}
