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
SOURCES = "sources"


def structure_id(doc_id: str, section_key: str | None) -> str | None:
    """A structure node's deterministic id: ``doc_id::section_key`` (matches raw_structure.id).
    None when there's no section key. Callers guard against dangling refs with a valid-id set."""
    return f"{doc_id}::{section_key}" if section_key else None


def source_id_of(doc_id: str | None) -> str | None:
    """The source (book) a course version belongs to. The PDF, its figures, and every
    file-level fact are keyed by this — never by the version — so anything reaching for
    the uploaded material must resolve through here first.

    For every book ingested before versions existed the answer is the doc id itself
    (the identity backfill), so this is a no-op for them rather than a behaviour change.
    Falls back to the doc id if the row is missing, which keeps a mid-upload stub and a
    unit test with a bare id working."""
    if not doc_id:
        return None
    try:
        with db() as conn:
            row = conn.execute(
                f"SELECT source_id FROM {DOCUMENTS} WHERE key = %(d)s", {"d": doc_id}
            ).fetchone()
        return (row or {}).get("source_id") or doc_id
    except Exception:  # noqa: BLE001 — resolution failure reads as "it is its own source"
        logging.getLogger(__name__).warning("source_id_of failed", exc_info=True)
        return doc_id


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
                'depth AS "listDepth", page_start AS page, hidden_reason AS "hiddenReason" '
                'FROM raw_structure WHERE doc_id = %(d)s ORDER BY "order"',
                {"d": doc_id},
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning("fetch_structure_entries failed", exc_info=True)
        return []


def assemble_markdown(doc_id: str) -> str:
    """The full-document markdown, reassembled from raw_content in reading order (was the
    stored ``documents.markdown`` blob). Used only where a whole-book blob is served."""
    # Local import: blocks.py depends on this module (source_id_of), so a top-level
    # import here would close a cycle.
    from app.process.content.blocks import fetch_blocks

    try:
        rows = fetch_blocks(doc_id, markdown=True)
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
                'd.key AS "_key", s.title, s.source_filename AS "sourceFilename", '
                's.page_count AS "pageCount", d.char_count AS "charCount", '
                'd.section_count AS "sectionCount", '
                's.has_page_provenance AS "hasPageProvenance", '
                "(extract(epoch from d.created_at) * 1000)::bigint AS \"createdAt\""
            )
            frm = "raw_documents d JOIN sources s ON s.key = d.source_id"
            if doc_id:
                sql = f"SELECT {cols} FROM {frm} WHERE d.key = %(id)s LIMIT 1"
                binds = {"id": doc_id}
            else:
                sql = (
                    f"SELECT {cols} FROM {frm} WHERE d.status = 'ready' "
                    "ORDER BY d.created_at DESC NULLS LAST LIMIT 1"
                )
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
    """Every processed course — ONE row per book, newest first, metadata only. The row is
    the source's *main* version (unique per source), which is the version a course card
    opens; the other versions of a book are listed from inside the course, not the shelf.
    Concept counts are the extraction domain's to add; the route composes the two."""
    with db() as conn:
        return conn.execute(
            'SELECT d.key AS "docId", s.title, s.source_filename AS "sourceFilename", '
            's.page_count AS "pageCount", d.section_count AS "sectionCount", '
            "(extract(epoch from d.created_at) * 1000)::bigint AS \"createdAt\" "
            "FROM raw_documents d JOIN sources s ON s.key = d.source_id "
            "WHERE d.status = 'ready' AND d.is_main "
            "ORDER BY d.created_at DESC NULLS LAST"
        ).fetchall()


def document_overview(doc_id: str) -> dict[str, Any] | None:
    """The one documents-row read behind course-status: title, sizes, outline. None = no doc."""
    with db() as conn:
        row = conn.execute(
            'SELECT s.title, s.page_count AS "pageCount", d.section_count AS "sectionCount" '
            "FROM raw_documents d JOIN sources s ON s.key = d.source_id "
            "WHERE d.key = %(d)s",
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
    """Delete a course outright — the whole book, meaning the source row and EVERY version
    of it: raw_/ext_ tables + the job ledger cascade from the FK, the un-FK'd study tables
    are pruned per version explicitly, and the on-disk artifacts (original PDF + figures,
    both keyed by the source) are removed. Deleting one version of a book without deleting
    the book is a different operation. Irreversible. ``{error}`` on invalid/unknown id,
    else ``{deleted, removed}``."""
    if not re.fullmatch(r"[0-9a-fA-F-]{8,64}", doc_id or ""):
        return {"error": "invalid doc id", "status": 400}
    with db() as conn:
        src = (conn.execute(
            f"SELECT source_id FROM {DOCUMENTS} WHERE key = %(d)s", {"d": doc_id}
        ).fetchone() or {}).get("source_id") or doc_id
        # Study rows are keyed per VERSION, so prune every version of this source.
        versions = [
            r["key"] for r in conn.execute(
                f"SELECT key FROM {DOCUMENTS} WHERE source_id = %(s)s", {"s": src}
            ).fetchall()
        ] or [doc_id]
        existed = conn.execute(
            f"SELECT 1 FROM {SOURCES} WHERE key = %(s)s", {"s": src}
        ).fetchone() is not None
        removed: dict[str, int] = {}
        for coll, field in _STUDY_CASCADE:
            try:
                n = conn.execute(
                    f"DELETE FROM {coll} WHERE {field} = ANY(%(v)s)", {"v": versions}
                ).rowcount
            except Exception:  # noqa: BLE001 — table may not exist in this schema
                continue
            if n:
                removed[coll] = n
        if existed:
            # One statement removes the source + every version + everything FK'd to those
            # (raw_*, ext_*, chapter_builds) via ON DELETE CASCADE.
            conn.execute(f"DELETE FROM {SOURCES} WHERE key = %(s)s", {"s": src})
            removed["sources"] = 1
            removed["raw_documents"] = len(versions)
    shared = Path(os.environ.get("SHARED_DIR", "/shared"))
    for sub in ("ingest", "figures"):
        target = shared / sub / src
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
    # ⚠ An absent document is SUCCESS, not 404. DELETE is idempotent: the caller asked for
    # this document to be gone, and it is gone. Returning an error here made an orphan card
    # permanently undeletable from the UI — the shelf card lives in `app_documents`, written
    # by the browser, and the client only prunes it after this call succeeds. So a card whose
    # document had already been removed failed its own delete with "document … not found",
    # forever, and the only way out was SQL. The card is the thing the user is pointing at;
    # whether its backing row still exists is an implementation detail they cannot see.
    return {"deleted": doc_id, "removed": removed, "alreadyGone": not existed and not removed}


def find_by_source_hash(source_hash: str) -> dict | None:
    """The already-ingested book with this exact content hash, or None — the upload
    duplicate check, which is a question about the *source* (same file) and answers with
    its main version's doc id. Best-effort: DB trouble reads as "no duplicate" (logged)
    so ingestion never breaks on the check."""
    try:
        with db() as conn:
            row = conn.execute(
                'SELECT d.key AS "docId", s.title, s.source_filename AS "sourceFilename" '
                "FROM sources s JOIN raw_documents d ON d.source_id = s.key AND d.is_main "
                "WHERE s.source_hash = %(h)s LIMIT 1",
                {"h": source_hash},
            ).fetchone()
        return row or None
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning("duplicate-check failed; treating as no duplicate", exc_info=True)
        return None


def create_stub(doc_id: str, title: str, source_hash: str | None = None) -> None:
    """Insert the identity rows for a freshly-uploaded book, before conversion runs, so the
    convert job (and any content the converter writes) has a parent to FK against: the
    ``sources`` row for the file, plus its Default version keyed identically.
    Idempotent: a re-upload of the same id refreshes the stub back to 'converting'."""
    with db() as conn, conn.transaction():
        conn.execute(
            "INSERT INTO sources (key, title, source_hash, created_at) "
            "VALUES (%(k)s, %(t)s, %(h)s, now()) "
            "ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, "
            "source_hash = EXCLUDED.source_hash",
            {"k": doc_id, "t": title, "h": source_hash},
        )
        # An upload always mints the Default version, keyed the same as its source —
        # the identity that lets every doc_id-keyed table stay untouched.
        conn.execute(
            "INSERT INTO raw_documents (key, source_id, name, origin, is_main, status, "
            "created_at, last_updated) "
            "VALUES (%(k)s, %(k)s, 'Default', 'default', true, 'converting', now(), now()) "
            "ON CONFLICT (key) DO UPDATE SET status = 'converting', last_updated = now()",
            {"k": doc_id},
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
