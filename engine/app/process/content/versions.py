"""Course versions — the lifecycle of the named paths through a book.

A source always has exactly one Default version (minted at upload) and exactly one main
version (the one a course card opens); the database enforces the second with a partial
unique index, so "set main" is a swap inside one transaction rather than a rule the
application hopes it remembered.

Creating a version SEEDS it from the source's Default: the same outline, and every block
placed exactly where the book puts it. You start from the whole book and cut down, which
is what distilling actually is — an empty course would be a worse starting point than the
real thing. Seeding copies structure rows and mapping rows only; the markdown is never
duplicated (see blocks.py).

The Default version cannot be deleted. Two reasons, and the second is the load-bearing
one: it is the book's canonical structure, and `ext_concepts.structure_id` anchors into
its tree, so dropping it would cascade away the concepts every other version inherits.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from app.gateways import db
from app.process.content.documents import _existing_tables, source_id_of

_SAFE_ID = re.compile(r"[0-9a-fA-F-]{8,64}")


def _name_or_error(name: str | None) -> tuple[str | None, dict | None]:
    cleaned = (name or "").strip()
    if not cleaned:
        return None, {"error": "a version needs a name", "status": 400}
    if len(cleaned) > 120:
        return None, {"error": "name is too long (120 characters max)", "status": 400}
    return cleaned, None


def list_versions(doc_id: str) -> dict[str, Any]:
    """Every version of the book this doc belongs to, oldest first. ``versions`` carries
    the shape a switcher needs; ``docId`` echoes what was asked for."""
    src = source_id_of(doc_id)
    if not src:
        return {"docId": doc_id, "versions": []}
    with db() as conn:
        rows = conn.execute(
            'SELECT d.key AS "docId", d.name, d.origin, d.is_main AS "isMain", d.status, '
            'd.section_count AS "sectionCount", '
            "(SELECT count(*) FROM version_blocks vb WHERE vb.version_id = d.key) AS \"blockCount\", "
            "(extract(epoch from d.created_at) * 1000)::bigint AS \"createdAt\" "
            "FROM raw_documents d WHERE d.source_id = %(s)s ORDER BY d.created_at",
            {"s": src},
        ).fetchall()
    return {"docId": doc_id, "sourceId": src, "versions": rows}


def create_version(doc_id: str, name: str) -> dict[str, Any]:
    """A new version of this book, seeded from its Default: same outline, all material.
    Never main — switching is a separate, deliberate act. Returns the new ``docId``."""
    cleaned, err = _name_or_error(name)
    if err:
        return err
    src = source_id_of(doc_id)
    if not src:
        return {"error": f"document {doc_id} not found", "status": 404}
    new_id = str(uuid.uuid4())
    with db() as conn, conn.transaction():
        default = conn.execute(
            "SELECT key FROM raw_documents WHERE source_id = %(s)s AND origin = 'default' "
            "ORDER BY created_at LIMIT 1",
            {"s": src},
        ).fetchone()
        if not default:
            return {"error": f"book {src} has no default version to seed from", "status": 409}
        seed = default["key"]
        conn.execute(
            "INSERT INTO raw_documents (key, source_id, name, origin, is_main, status, "
            "toc_route, section_count, char_count, created_at, last_updated) "
            "SELECT %(new)s, source_id, %(n)s, 'custom', false, status, toc_route, "
            "section_count, char_count, now(), now() "
            "FROM raw_documents WHERE key = %(seed)s",
            {"new": new_id, "n": cleaned, "seed": seed},
        )
        # Its own copy of the outline, re-keyed onto the new version. Section keys are
        # kept as-is so the seeded tree and the book's blocks line up.
        conn.execute(
            'INSERT INTO raw_structure (id, doc_id, parent_id, section_key, kind, '
            'number_label, title, depth, hidden_reason, "order", page_start, page_end) '
            "SELECT %(new)s || '::' || section_key, %(new)s, "
            "CASE WHEN parent_id IS NULL THEN NULL "
            "     ELSE %(new)s || '::' || split_part(parent_id, '::', 2) END, "
            'section_key, kind, number_label, title, depth, hidden_reason, "order", '
            "page_start, page_end "
            "FROM raw_structure WHERE doc_id = %(seed)s",
            {"new": new_id, "seed": seed},
        )
        # …and keeps all of the book's material, placed exactly as the Default places it.
        # Mapping rows only — no markdown is copied.
        conn.execute(
            'INSERT INTO version_blocks (version_id, content_key, structure_id, "order") '
            "SELECT %(new)s, vb.content_key, "
            "CASE WHEN vb.structure_id IS NULL THEN NULL "
            "     ELSE %(new)s || '::' || split_part(vb.structure_id, '::', 2) END, "
            'vb."order" '
            "FROM version_blocks vb WHERE vb.version_id = %(seed)s",
            {"new": new_id, "seed": seed},
        )
    return {"docId": new_id, "name": cleaned, "origin": "custom", "isMain": False}


def rename_version(doc_id: str, name: str) -> dict[str, Any]:
    """Rename a version. The Default may be renamed — it is only undeletable, not frozen."""
    cleaned, err = _name_or_error(name)
    if err:
        return err
    with db() as conn:
        n = conn.execute(
            "UPDATE raw_documents SET name = %(n)s, last_updated = now() WHERE key = %(d)s",
            {"n": cleaned, "d": doc_id},
        ).rowcount
    if not n:
        return {"error": f"version {doc_id} not found", "status": 404}
    return {"docId": doc_id, "name": cleaned}


def set_main_version(doc_id: str) -> dict[str, Any]:
    """Make this the version its course card opens. One statement clears the book's other
    versions first — the partial unique index would reject any moment where two are main,
    so both writes share a transaction."""
    with db() as conn, conn.transaction():
        row = conn.execute(
            "SELECT source_id FROM raw_documents WHERE key = %(d)s", {"d": doc_id}
        ).fetchone()
        if not row:
            return {"error": f"version {doc_id} not found", "status": 404}
        conn.execute(
            "UPDATE raw_documents SET is_main = false WHERE source_id = %(s)s AND key <> %(d)s",
            {"s": row["source_id"], "d": doc_id},
        )
        conn.execute(
            "UPDATE raw_documents SET is_main = true, last_updated = now() WHERE key = %(d)s",
            {"d": doc_id},
        )
    return {"docId": doc_id, "isMain": True}


def delete_version(doc_id: str) -> dict[str, Any]:
    """Delete ONE version of a book: its outline, its material mapping, its study state.
    The book, its text and its concepts are untouched — deleting the whole course is
    ``delete_document``. Refuses the Default, and refuses to leave a book with no main."""
    if not _SAFE_ID.fullmatch(doc_id or ""):
        return {"error": "invalid doc id", "status": 400}
    with db() as conn, conn.transaction():
        row = conn.execute(
            "SELECT source_id, origin, is_main FROM raw_documents WHERE key = %(d)s",
            {"d": doc_id},
        ).fetchone()
        if not row:
            return {"error": f"version {doc_id} not found", "status": 404}
        if row["origin"] == "default":
            return {
                "error": "the Default version cannot be deleted — delete the course instead",
                "status": 409,
            }
        removed: dict[str, int] = {}
        # Study rows are keyed by version and carry no FK yet, so prune them explicitly —
        # same contract as delete_document.
        #
        # ⚠ This block used to be `except Exception: continue`, and this function runs
        # INSIDE a transaction: the first failure poisons it, so every later statement fails
        # too and the `continue` swallows all of them. A version delete that removed nothing
        # would have reported success. Ask the catalogue up front instead (B8).
        tables = (("concept_reviews", "doc_id"), ("study_events", "doc"),
                  ("chapter_progress", "doc_id"))
        present = _existing_tables(conn, tuple(t for t, _ in tables))
        for table, field in tables:
            if table not in present:
                continue
            n = conn.execute(
                f"DELETE FROM {table} WHERE {field} = %(d)s", {"d": doc_id}
            ).rowcount
            if n:
                removed[table] = n
        conn.execute("DELETE FROM raw_documents WHERE key = %(d)s", {"d": doc_id})
        removed["raw_documents"] = 1
        if row["is_main"]:
            # Never leave a book with no main version — hand it back to the Default.
            conn.execute(
                "UPDATE raw_documents SET is_main = true WHERE key = ("
                "  SELECT key FROM raw_documents WHERE source_id = %(s)s "
                "  ORDER BY (origin = 'default') DESC, created_at LIMIT 1)",
                {"s": row["source_id"]},
            )
    return {"deleted": doc_id, "removed": removed}
