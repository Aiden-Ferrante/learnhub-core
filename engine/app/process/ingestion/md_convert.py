"""Markdown to persisted content — ingestion for books that were authored, not scanned.

The PDF path exists to *recover* structure from a rendered artifact: page provenance,
bookmarks, font-size clustering, figure extraction, math repair. Authored markdown has
none of that damage to undo, so this path does almost nothing — it validates, normalizes
line endings, and hands the text to ``persist_document``, which already treats
``markdown`` as its primary input and every PDF-derived argument as optional.

What is deliberately absent, and why it is not a gap:

* **No page provenance.** ``page_count=0``, no ``heading_pages``, no ``pages``. The
  schema calls this backward compatible and ``has_page_provenance`` records it. A page
  view for such a document has nothing to show, which is correct — there are no pages.
* **No PDF bytes.** Nothing to serve from ``/api/document/pdf``.
* **No figures.** Images in authored markdown are already links; there is no embedded
  binary to extract into ``raw_elements``.

Structure therefore comes entirely from the ATX headings, via the TOC controller's
derive stage. See ``toc_strategies/from_markdown_headings.py``.
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

from app.process.content import normalize_math_in_markdown, persist_document
from app.process.ingestion.pdf_convert import ConvertResult, source_hash_of
from app.process.ingestion.reader import PdfConvertError

# The byte cap is the same memory safety valve as the PDF path (the whole file is read
# into RAM), scaled down: markdown is text, and a 50 MB book is ~8 million words.
MAX_MD_BYTES = int(os.environ.get("LEARN_MAX_MD_MB", "50")) * 1024 * 1024  # 0 = unlimited

MARKDOWN_SUFFIXES = (".md", ".markdown")

__all__ = ["MARKDOWN_SUFFIXES", "convert_markdown_bytes", "is_markdown_filename"]


def is_markdown_filename(filename: str | None) -> bool:
    return bool(filename) and filename.lower().endswith(MARKDOWN_SUFFIXES)


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    # ``light`` only collapses stray empty $$ delimiters. The ``full`` heuristics exist to
    # repair pymupdf extraction damage, and would actively harm clean source: they rewrite
    # unicode like ≤ into \leq outside any wrapped equation, which then renders as a
    # literal backslash command.
    return normalize_math_in_markdown(text, profile="light").strip()


def _output_name(source_filename: str) -> str:
    return Path(source_filename).name


def convert_markdown_bytes(
    data: bytes, filename: str, *, doc_id: str | None = None
) -> ConvertResult:
    """Persist an authored markdown document. Mirrors ``convert_pdf_bytes``' contract:
    same ``ConvertResult``, same ``PdfConvertError`` for user-facing input problems, and a
    persistence failure raises so the job ledger records an honest error.

    ``doc_id`` lets the caller pre-assign the document id — the pipeline mints it at
    upload so a queued ``convert`` job is addressable before the document exists.
    """
    if MAX_MD_BYTES and len(data) > MAX_MD_BYTES:
        raise PdfConvertError(
            f"Markdown exceeds maximum size ({MAX_MD_BYTES // (1024 * 1024)} MB).", 413
        )
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise PdfConvertError("Markdown must be UTF-8 encoded.", 400) from e

    markdown = _normalize(text)
    if not markdown:
        raise PdfConvertError("The file is empty.", 400)

    # Content before the first heading is discarded by the splitter, so a document with no
    # ATX heading persists as nothing at all. Fail here instead, where the reason can be
    # stated — a book that silently ingests to zero blocks is the worst outcome available.
    if not re.search(r"^#{1,6}\s+\S", markdown, re.M):
        raise PdfConvertError(
            "No markdown headings found. Structure is derived from ATX headings "
            "(`# Title`), and content before the first heading is not stored.",
            400,
        )

    doc_id = doc_id or str(uuid.uuid4())
    persisted = persist_document(
        doc_id=doc_id,
        title=Path(filename or "document.md").stem,
        source_filename=filename or "document.md",
        markdown=markdown,
        page_count=0,
        source_hash=source_hash_of(data),
    )

    return ConvertResult(
        source_filename=filename or "document.md",
        output_filename=_output_name(filename or "document.md"),
        page_count=0,
        doc_id=doc_id,
        toc_route=persisted.get("tocRoute", ""),
        toc_decisions=persisted.get("tocDecisions"),
    )
