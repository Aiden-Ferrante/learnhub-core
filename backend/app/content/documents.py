"""The documents collection — metadata reads shared across content/tree/extraction.

First slice of the arango_content split: the low-level "which document / what is it"
lookup that nearly every module needs, kept dependency-free so nothing has to import
the big section/element machinery just to resolve a doc id.
"""

from __future__ import annotations

from app.platform.db import db

DOCUMENTS = "documents"

# Column aliases so the row dict reads with the same keys the AQL doc used.
_DOC_COLS = (
    'key AS "_key", title, source_filename AS "sourceFilename", markdown, '
    'page_count AS "pageCount", char_count AS "charCount", section_count AS "sectionCount", '
    'page_block_count AS "pageBlockCount", has_page_provenance AS "hasPageProvenance", outline, '
    "(extract(epoch from created_at) * 1000)::bigint AS \"createdAt\""
)


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
