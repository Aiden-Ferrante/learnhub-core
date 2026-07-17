"""The documents collection — metadata reads shared across content/tree/extraction.

First slice of the arango_content split: the low-level "which document / what is it"
lookup that nearly every module needs, kept dependency-free so nothing has to import
the big section/element machinery just to resolve a doc id.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any

from app.gateways import db

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


def list_documents() -> list[dict[str, Any]]:
    """Every processed course (one per converted document), newest first — metadata only.
    Concept counts are the extraction domain's to add; the route composes the two."""
    with db() as conn:
        return conn.execute(
            'SELECT key AS "docId", title, source_filename AS "sourceFilename", '
            'page_count AS "pageCount", section_count AS "sectionCount", '
            "(extract(epoch from created_at) * 1000)::bigint AS \"createdAt\" "
            "FROM documents ORDER BY created_at DESC NULLS LAST"
        ).fetchall()


def document_overview(doc_id: str) -> dict[str, Any] | None:
    """The one documents-row read behind course-status: title, sizes, outline. None = no doc."""
    with db() as conn:
        return conn.execute(
            'SELECT title, outline, page_count AS "pageCount", '
            'section_count AS "sectionCount" FROM documents WHERE key = %(d)s',
            {"d": doc_id},
        ).fetchone()


# Learn-content tables that carry a per-document field — the delete cascade. Table names
# only; missing tables (older tenant schemas) are skipped at delete time.
_DOC_CASCADE: tuple[tuple[str, str], ...] = (
    ("section_content", "doc_id"),
    ("page_content", "doc_id"),
    ("elements", "doc_id"),
    ("concepts", "doc_id"),
    ("concept_reviews", "doc_id"),
    ("study_events", "doc"),
    ("chapter_builds", "doc_id"),
    ("chapter_skeletons", "doc_id"),
    ("chapter_orient", "doc_id"),
    ("chapter_progress", "doc_id"),
    ("deep_chapter_briefing", "doc_id"),
    ("reading_guides", "doc_id"),
)


def delete_document(doc_id: str) -> dict[str, Any]:
    """Delete a course outright: the document row, every learn table keyed by it, and its
    on-disk artifacts (original PDF + figures). Irreversible. Returns ``{error}`` on an
    invalid id or unknown document, else ``{deleted, removed}``."""
    if not re.fullmatch(r"[0-9a-fA-F-]{8,64}", doc_id or ""):
        return {"error": "invalid doc id", "status": 400}
    with db() as conn:
        existed = conn.execute(
            f"SELECT 1 FROM {DOCUMENTS} WHERE key = %(d)s", {"d": doc_id}
        ).fetchone() is not None
        removed: dict[str, int] = {}
        for coll, field in _DOC_CASCADE:
            try:
                n = conn.execute(
                    f"DELETE FROM {coll} WHERE {field} = %(d)s", {"d": doc_id}
                ).rowcount
            except Exception:  # noqa: BLE001 — table may not exist in this schema
                continue
            if n:
                removed[coll] = n
        if existed:
            conn.execute(f"DELETE FROM {DOCUMENTS} WHERE key = %(d)s", {"d": doc_id})
    shared = Path(os.environ.get("SHARED_DIR", "/shared"))
    for sub in ("ingest", "figures"):
        target = shared / sub / doc_id
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
    if not existed and not removed:
        return {"error": f"document {doc_id} not found", "status": 404}
    return {"deleted": doc_id, "removed": removed}


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
