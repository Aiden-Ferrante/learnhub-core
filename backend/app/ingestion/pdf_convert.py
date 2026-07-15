"""PDF to Markdown conversion for Learn Hub ingestion (digital/text PDFs)."""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

from app.content import persist_document
from app.content import normalize_math_in_markdown
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
    "source_hash_of",
]


def source_hash_of(data: bytes) -> str:
    """Content identity for dedup — sha256 of the raw PDF bytes."""
    return hashlib.sha256(data).hexdigest()


@dataclass
class ConvertResult:
    """What the convert job patches onto its ledger row. The converted markdown itself
    is NOT here — it lives in ``documents`` (the status route re-reads it from there)."""

    source_filename: str
    output_filename: str
    page_count: int
    doc_id: str


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


def convert_pdf_bytes(data: bytes, filename: str, *, doc_id: str | None = None) -> ConvertResult:
    """Convert a PDF's bytes to markdown and persist the structured content.

    ``doc_id`` lets the caller pre-assign the document id — the pipeline mints it at upload
    so a queued ``convert`` job is addressable before the document exists. Omitted → a fresh
    uuid. The uploaded PDF itself already lives at ``/shared/ingest/<docId>/original.pdf``
    (written once, by ``prepare_upload``); the canonical markdown lives in ``documents``.

    Raises ``PdfConvertError`` for user-facing input problems; a persistence failure raises
    whatever went wrong so the job ledger records an honest error (never a silent "done")."""
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

    return ConvertResult(
        source_filename=filename or "document.pdf",
        output_filename=output_filename,
        page_count=page_count,
        doc_id=doc_id,
    )
