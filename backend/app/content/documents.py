"""The documents collection — metadata reads shared across content/tree/extraction.

First slice of the arango_content split: the low-level "which document / what is it"
lookup that nearly every module needs, kept dependency-free so nothing has to import
the big section/element machinery just to resolve a doc id.
"""

from __future__ import annotations

import logging

from app.platform import db

DOCUMENTS = "documents"

# Column aliases so the row dict reads with the same keys the AQL doc used.
_DOC_COLS = (
    'key AS "_key", title, source_filename AS "sourceFilename", markdown, '
    'page_count AS "pageCount", char_count AS "charCount", section_count AS "sectionCount", '
    'page_block_count AS "pageBlockCount", has_page_provenance AS "hasPageProvenance", outline, '
    "(extract(epoch from created_at) * 1000)::bigint AS \"createdAt\""
)


def resolve_doc_id(doc_id: str | None) -> str | None:
    """The app-wide "default to the latest document" rule, as ONE cheap lookup.

    Every surface accepts an optional doc id; absent means "the most recently ingested
    book". This resolver reads just the key — the old per-module copies went through
    ``fetch_latest_document()``, which drags the full book markdown along for one id."""
    if doc_id:
        return doc_id
    try:
        with db() as conn:
            row = conn.execute(
                "SELECT key FROM documents ORDER BY created_at DESC NULLS LAST LIMIT 1"
            ).fetchone()
        return row["key"] if row else None
    except Exception:  # noqa: BLE001 — resolution failure reads as "no document"
        logging.getLogger(__name__).warning("resolve_doc_id failed", exc_info=True)
        return None


def fetch_latest_document(doc_id: str | None = None) -> dict:
    """Latest stored document metadata + full markdown (or a specific id)."""
    try:
        with db() as conn:
            if doc_id:
                sql = f"SELECT {_DOC_COLS} FROM documents WHERE key = %(id)s LIMIT 1"
                binds = {"id": doc_id}
            else:
                sql = f"SELECT {_DOC_COLS} FROM documents ORDER BY created_at DESC NULLS LAST LIMIT 1"
                binds = {}
            rows = conn.execute(sql, binds).fetchall()
        if not rows:
            return {"document": None}
        d = rows[0]
        return {
            "document": {
                "id": d.get("_key"),
                "title": d.get("title"),
                "sourceFilename": d.get("sourceFilename"),
                "markdown": d.get("markdown", ""),
                "pageCount": d.get("pageCount", 0),
                "charCount": d.get("charCount", 0),
                "sectionCount": d.get("sectionCount", 0),
                "pageBlockCount": d.get("pageBlockCount", 0),
                "hasPageProvenance": d.get("hasPageProvenance", False),
                "outline": d.get("outline", []),
                "createdAt": d.get("createdAt", 0),
            }
        }
    except Exception as exc:
        return {"document": None, "error": str(exc)}


def find_by_source_hash(source_hash: str) -> dict | None:
    """The already-ingested document with this exact content hash, or None. Best-effort:
    DB trouble reads as "no duplicate" (logged) so ingestion never breaks on the check."""
    try:
        with db() as conn:
            row = conn.execute(
                'SELECT key AS "docId", title, source_filename AS "sourceFilename" '
                "FROM documents WHERE source_hash = %(h)s LIMIT 1",
                {"h": source_hash},
            ).fetchone()
        return row or None
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning("duplicate-check failed; treating as no duplicate", exc_info=True)
        return None
