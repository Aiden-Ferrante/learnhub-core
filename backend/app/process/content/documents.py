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

DOCUMENTS = "raw_documents"


def structure_id(doc_id: str, section_key: str | None) -> str | None:
    """A structure node's deterministic id: ``doc_id::section_key`` (matches raw_structure.id).
    None when there's no section key. Callers guard against dangling refs with a valid-id set."""
    return f"{doc_id}::{section_key}" if section_key else None


def fetch_structure_entries(doc_id: str | None) -> list[dict[str, Any]]:
    """The document's TOC as outline entries reassembled from raw_structure — the
    ``{numberKey, title, sectionKey, listDepth, page}`` shape the reader, scope resolver,
    and syllabus tree consume (was ``documents.outline`` jsonb). Empty when absent."""
    if not doc_id:
        return []
    try:
        with db() as conn:
            rows = conn.execute(
                'SELECT section_key AS "sectionKey", number_label AS "numberKey", title, '
                'depth AS "listDepth", page_start AS page FROM raw_structure '
                'WHERE doc_id = %(d)s ORDER BY "order"',
                {"d": doc_id},
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning("fetch_structure_entries failed", exc_info=True)
        return []


def assemble_markdown(doc_id: str) -> str:
    """The full-document markdown, reassembled from raw_content in reading order (was the
    stored ``documents.markdown`` blob). Used only where a whole-book blob is served."""
    try:
        with db() as conn:
            rows = conn.execute(
                'SELECT markdown FROM raw_content WHERE doc_id = %(d)s ORDER BY "order"',
                {"d": doc_id},
            ).fetchall()
        return "\n\n".join(r["markdown"] for r in rows if r.get("markdown"))
    except Exception:  # noqa: BLE001
        return ""


def resolve_doc_id(doc_id: str | None) -> str | None:
    """The app-wide "default to the latest document" rule, as ONE cheap lookup. Absent id
    means "the most recently ingested READY book" — a mid-conversion stub is skipped so
    doc-less calls never land on an empty course."""
    if doc_id:
        return doc_id
    try:
        with db() as conn:
            row = conn.execute(
                "SELECT key FROM raw_documents WHERE status = 'ready' "
                "ORDER BY created_at DESC NULLS LAST LIMIT 1"
            ).fetchone()
        return row["key"] if row else None
    except Exception:  # noqa: BLE001 — resolution failure reads as "no document"
        logging.getLogger(__name__).warning("resolve_doc_id failed", exc_info=True)
        return None


def fetch_latest_document(doc_id: str | None = None) -> dict:
    """Latest stored document metadata + full markdown (or a specific id). The markdown is
    reassembled from raw_content; the outline from raw_structure."""
    try:
        with db() as conn:
            cols = (
                'key AS "_key", title, source_filename AS "sourceFilename", '
                'page_count AS "pageCount", char_count AS "charCount", section_count AS "sectionCount", '
                'has_page_provenance AS "hasPageProvenance", '
                "(extract(epoch from created_at) * 1000)::bigint AS \"createdAt\""
            )
            if doc_id:
                sql = f"SELECT {cols} FROM raw_documents WHERE key = %(id)s LIMIT 1"
                binds = {"id": doc_id}
            else:
                sql = f"SELECT {cols} FROM raw_documents WHERE status = 'ready' ORDER BY created_at DESC NULLS LAST LIMIT 1"
                binds = {}
            rows = conn.execute(sql, binds).fetchall()
        if not rows:
            return {"document": None}
        d = rows[0]
        key = d.get("_key")
        return {
            "document": {
                "id": key,
                "title": d.get("title"),
                "sourceFilename": d.get("sourceFilename"),
                "markdown": assemble_markdown(key),
                "pageCount": d.get("pageCount", 0),
                "charCount": d.get("charCount", 0),
                "sectionCount": d.get("sectionCount", 0),
                "hasPageProvenance": d.get("hasPageProvenance", False),
                "outline": fetch_structure_entries(key),
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
            "FROM raw_documents WHERE status = 'ready' ORDER BY created_at DESC NULLS LAST"
        ).fetchall()


def document_overview(doc_id: str) -> dict[str, Any] | None:
    """The one documents-row read behind course-status: title, sizes, outline. None = no doc."""
    with db() as conn:
        row = conn.execute(
            'SELECT title, page_count AS "pageCount", section_count AS "sectionCount" '
            "FROM raw_documents WHERE key = %(d)s",
            {"d": doc_id},
        ).fetchone()
    if row is None:
        return None
    return {**row, "outline": fetch_structure_entries(doc_id)}


# Study tables carry a per-document field but have no doc FK yet (study layer is a later
# pass), so delete_document prunes them explicitly. Everything raw_/ext_ + the job ledger
# cascades from the single DELETE FROM raw_documents.
_STUDY_CASCADE: tuple[tuple[str, str], ...] = (
    ("concept_reviews", "doc_id"),
    ("study_events", "doc"),
    ("chapter_progress", "doc_id"),
)


def delete_document(doc_id: str) -> dict[str, Any]:
    """Delete a course outright: the document row (cascading every raw_/ext_ table + the job
    ledger via FK), the un-FK'd study tables explicitly, and its on-disk artifacts (original
    PDF + figures). Irreversible. ``{error}`` on invalid/unknown id, else ``{deleted, removed}``."""
    if not re.fullmatch(r"[0-9a-fA-F-]{8,64}", doc_id or ""):
        return {"error": "invalid doc id", "status": 400}
    with db() as conn:
        existed = conn.execute(
            f"SELECT 1 FROM {DOCUMENTS} WHERE key = %(d)s", {"d": doc_id}
        ).fetchone() is not None
        removed: dict[str, int] = {}
        for coll, field in _STUDY_CASCADE:
            try:
                n = conn.execute(
                    f"DELETE FROM {coll} WHERE {field} = %(d)s", {"d": doc_id}
                ).rowcount
            except Exception:  # noqa: BLE001 — table may not exist in this schema
                continue
            if n:
                removed[coll] = n
        if existed:
            # One statement removes raw_documents + everything FK'd to it (raw_*, ext_*,
            # chapter_builds) via ON DELETE CASCADE.
            conn.execute(f"DELETE FROM {DOCUMENTS} WHERE key = %(d)s", {"d": doc_id})
            removed["raw_documents"] = 1
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
                "FROM raw_documents WHERE source_hash = %(h)s LIMIT 1",
                {"h": source_hash},
            ).fetchone()
        return row or None
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning("duplicate-check failed; treating as no duplicate", exc_info=True)
        return None


def create_stub(doc_id: str, title: str, source_hash: str | None = None) -> None:
    """Insert the identity row for a freshly-uploaded document, before conversion runs, so
    the convert job (and any content the converter writes) has a parent to FK against.
    Idempotent: a re-upload of the same id refreshes the stub back to 'converting'."""
    with db() as conn:
        conn.execute(
            "INSERT INTO raw_documents (key, title, source_hash, status, created_at, last_updated) "
            "VALUES (%(k)s, %(t)s, %(h)s, 'converting', now(), now()) "
            "ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, "
            "source_hash = EXCLUDED.source_hash, status = 'converting', last_updated = now()",
            {"k": doc_id, "t": title, "h": source_hash},
        )


def mark_document_status(doc_id: str, status: str, status_code: int | None = None) -> None:
    """Flip a document's lifecycle status (converting → ready | error). Best-effort."""
    try:
        with db() as conn:
            conn.execute(
                "UPDATE raw_documents SET status = %(s)s, status_code = %(c)s, last_updated = now() "
                "WHERE key = %(k)s",
                {"s": status, "c": status_code, "k": doc_id},
            )
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning("mark_document_status failed", exc_info=True)
