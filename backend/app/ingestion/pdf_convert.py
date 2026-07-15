"""PDF to Markdown conversion for Learn Hub ingestion (digital/text PDFs)."""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

from app.content.store import persist_document
from app.content.math_markdown import normalize_math_in_markdown
from app.ingestion.reader import PdfConvertError, convert_document

# Limits are env-tunable; 0 disables a limit. Conversion runs as a background job, so there's
# no request-timeout reason to cap page count — default it OFF (unlimited). The byte limit is a
# memory safety valve (the whole PDF is read into RAM), defaulting generously to 500 MB.
MAX_PDF_PAGES = int(os.environ.get("LEARN_MAX_PDF_PAGES", "0"))  # 0 = unlimited
MAX_PDF_BYTES = int(os.environ.get("LEARN_MAX_PDF_MB", "500")) * 1024 * 1024  # 0 = unlimited
PDF_MAGIC = b"%PDF"

__all__ = [
    "ConvertResult",
    "PdfConvertError",
    "convert_pdf_bytes",
    "find_existing_ingest",
    "pdf_convert_health",
    "source_hash_of",
]


def source_hash_of(data: bytes) -> str:
    """Content identity for dedup — sha256 of the raw PDF bytes."""
    return hashlib.sha256(data).hexdigest()


def find_existing_ingest(data: bytes) -> dict | None:
    """The already-ingested document with this exact content, or None. Best-effort:
    any DB trouble reads as "no duplicate" so ingestion never breaks on the check."""
    try:
        from app.platform.db import db

        with db() as conn:
            row = conn.execute(
                'SELECT key AS "docId", title, source_filename AS "sourceFilename" '
                "FROM documents WHERE source_hash = %(h)s LIMIT 1",
                {"h": source_hash_of(data)},
            ).fetchone()
        return row or None
    except Exception:  # noqa: BLE001
        return None


@dataclass
class ConvertResult:
    markdown: str
    source_filename: str
    output_filename: str
    page_count: int
    saved_path: str | None
    doc_id: str | None
    engine: str
    has_page_provenance: bool = False
    element_count: int = 0


def _normalize_markdown(text: str, engine: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    # Docling output is clean; the heavy heuristics are only for messy pymupdf text.
    profile = "light" if engine == "docling" else "full"
    text = normalize_math_in_markdown(text, profile=profile)
    return text.strip()


def _output_name(source_filename: str) -> str:
    base = Path(source_filename).name
    if base.lower().endswith(".pdf"):
        return base[:-4] + ".md"
    return base + ".md"


def _save_artifacts(data: bytes, markdown: str, source_filename: str, job_id: str) -> str | None:
    shared = os.environ.get("SHARED_DIR", "/shared")
    ingest_root = Path(shared) / "ingest"
    job_dir = ingest_root / job_id
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "original.pdf").write_bytes(data)
        md_path = job_dir / "converted.md"
        md_path.write_text(markdown, encoding="utf-8")
        return str(md_path)
    except OSError:
        return None


def convert_pdf_bytes(data: bytes, filename: str, *, save: bool = True,
                      doc_id: str | None = None) -> ConvertResult:
    """Convert a PDF's bytes to markdown and (when ``save``) persist the structured content.

    ``doc_id`` lets the caller pre-assign the document id — the pipeline mints it at upload
    so a queued ``convert`` job is addressable before the document exists. Omitted → a fresh
    uuid (the legacy behavior)."""
    if not data.startswith(PDF_MAGIC):
        raise PdfConvertError("File does not look like a PDF (%PDF header missing).", 400)
    if MAX_PDF_BYTES and len(data) > MAX_PDF_BYTES:
        raise PdfConvertError(f"PDF exceeds maximum size ({MAX_PDF_BYTES // (1024 * 1024)} MB).", 413)

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:
        raise PdfConvertError(f"Could not open PDF: {e}", 400) from e

    page_count = doc.page_count
    doc.close()
    if page_count == 0:
        raise PdfConvertError("PDF has no pages.", 400)
    if MAX_PDF_PAGES and page_count > MAX_PDF_PAGES:
        raise PdfConvertError(f"PDF exceeds maximum page count ({MAX_PDF_PAGES}).", 413)

    converted = convert_document(data, filename or "document.pdf")
    engine = converted.engine

    markdown = _normalize_markdown(converted.markdown or "", engine)
    if not markdown:
        raise PdfConvertError(
            "No extractable text found. This may be a scanned PDF; OCR is not enabled in v1.",
            400,
        )

    # Page-provenance side channels: ordered (heading text, page) and per-page markdown.
    # Page markdown is stored as-is (pymupdf source view); the high-fidelity reader uses
    # the Docling section markdown above.
    heading_pages = [(hp.text, hp.page_no) for hp in converted.heading_pages]
    pages = [(pt.page_no, pt.markdown) for pt in converted.pages]
    has_page_provenance = bool(pages) and bool(heading_pages)

    # Flatten the typed elements to plain dicts so persist_document stays decoupled from the
    # reader types (mirrors how heading_pages/pages are passed). Image bytes ride along as
    # ``imagePng`` and are written to /shared by the store, never kept in the DB row.
    elements = [
        {
            "type": e.type,
            "page": e.page,
            "bbox": e.bbox,
            "bboxOrigin": e.bbox_origin,
            "caption": e.caption,
            "latex": e.latex,
            "tableMarkdown": e.table_markdown,
            "tableData": e.table_data,
            "code": e.code,
            "language": e.language,
            "imagePng": e.image_png,
        }
        for e in converted.elements
    ]

    output_filename = _output_name(filename or "document.pdf")
    doc_id = doc_id or str(uuid.uuid4())
    saved_path = _save_artifacts(data, markdown, filename, doc_id) if save else None
    persisted_id = (
        persist_document(
            doc_id=doc_id,
            title=Path(filename or "document.pdf").stem,
            source_filename=filename or "document.pdf",
            markdown=markdown,
            page_count=page_count,
            heading_pages=heading_pages,
            pages=pages,
            outline=converted.outline,
            elements=elements,
            source_hash=source_hash_of(data),
        )
        if save
        else None
    )

    return ConvertResult(
        markdown=markdown,
        source_filename=filename or "document.pdf",
        output_filename=output_filename,
        page_count=page_count,
        saved_path=saved_path,
        doc_id=persisted_id,
        engine=engine,
        has_page_provenance=has_page_provenance,
        element_count=len(elements),
    )


def pdf_convert_health() -> dict[str, str]:
    """Report converter availability (selected engine + fallback)."""
    from app.ingestion.reader import converter_health

    return converter_health()
