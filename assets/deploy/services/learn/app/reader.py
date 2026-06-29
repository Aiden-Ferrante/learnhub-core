"""Pluggable PDF -> Markdown converters behind a small ``Converter`` interface.

Docling is the higher-fidelity default (hierarchical headings, better tables/math);
``pymupdf4llm`` remains the always-available fallback. Selection is via the
``LEARN_CONVERTER`` env var ("docling" | "pymupdf"); if the chosen engine fails to
import or convert, we fall back to pymupdf so ingestion never hard-breaks.

Page provenance: alongside the full-document markdown we collect (a) per-heading page
numbers from Docling's structured document (``iterate_items`` → ``prov[0].page_no``) and
(b) per-page markdown via ``pymupdf4llm(page_chunks=True)``. ``arango_content`` joins
these into page-primary blocks tagged with their section coordinates. We deliberately do
NOT re-serialize Docling per item (that would risk the decoded ``$$`` formula markdown);
the per-page text for the "source page" view comes from pymupdf, which is fast and always
available, while the high-fidelity reader/section markdown stays Docling's.
"""

from __future__ import annotations

import io
import os
import re
import threading
from dataclasses import dataclass, field
from typing import Protocol

import fitz  # PyMuPDF
import pymupdf4llm

from app.math_markdown import replacement_char_ratio

# A single converter instance is reused across requests so Docling's heavy formula/layout
# models load ONCE, not per conversion (which was slow + churned GPU memory → "fetch
# failed" / restart crashes). The lock guards the first (model-loading) build.
_CONVERTER_CACHE: dict[str, "Converter"] = {}
_CONVERTER_LOCK = threading.Lock()

_ATX_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_HEADING_LABELS = {"section_header", "title"}


@dataclass
class HeadingPage:
    """A heading and the 1-based PDF page it starts on (reading order)."""

    text: str
    page_no: int


@dataclass
class PageText:
    """Per-page markdown for the page-primary store."""

    page_no: int  # 1-based
    markdown: str


@dataclass
class ConvertedDoc:
    """Full-document markdown plus page-provenance side channels."""

    markdown: str
    engine: str
    heading_pages: list[HeadingPage] = field(default_factory=list)
    pages: list[PageText] = field(default_factory=list)
    outline: list[dict] = field(default_factory=list)  # embedded PDF bookmarks (the real TOC)


class PdfConvertError(Exception):
    """User-facing conversion failure."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class Converter(Protocol):
    name: str

    def to_markdown(self, data: bytes, filename: str) -> str: ...


class PyMuPDFConverter:
    """Fast, dependency-light extraction via pymupdf4llm (the original engine)."""

    name = "pymupdf4llm"

    def to_markdown(self, data: bytes, filename: str) -> str:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            kwargs: dict = {"detect_bg_color": True, "force_text": True}
            primary = pymupdf4llm.to_markdown(doc, **kwargs) or ""
            if replacement_char_ratio(primary) > 0.002:
                try:
                    alt = pymupdf4llm.to_markdown(doc, use_glyphs=True, **kwargs) or ""
                    if replacement_char_ratio(alt) < replacement_char_ratio(primary):
                        return alt
                except TypeError:
                    pass
            return primary
        finally:
            doc.close()


class DoclingConverter:
    """Higher-fidelity conversion via Docling (lazy-imported so it's optional).

    Docling's neural models (layout + TableFormer) run on the GB10 GPU via the
    cu130 torch wheel when the container has device access; otherwise it degrades
    to CPU. OCR stays off — v1 targets digital/text PDFs, and skipping it keeps the
    GPU models the bottleneck instead of slow per-page OCR.
    """

    name = "docling"

    def __init__(self) -> None:
        self._converter = None
        # Captured from the most recent ``to_markdown`` call so ``convert_document``
        # can read per-heading page numbers without re-running Docling.
        self.last_heading_pages: list[HeadingPage] = []

    def _get_converter(self):
        if self._converter is not None:
            return self._converter
        with _CONVERTER_LOCK:
            if self._converter is not None:  # another thread built it while we waited
                return self._converter
            import torch
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import (
                AcceleratorDevice,
                AcceleratorOptions,
                PdfPipelineOptions,
            )
            from docling.document_converter import DocumentConverter, PdfFormatOption

            device = AcceleratorDevice.CUDA if torch.cuda.is_available() else AcceleratorDevice.AUTO
            pipeline_options = PdfPipelineOptions()
            pipeline_options.accelerator_options = AcceleratorOptions(device=device)
            pipeline_options.do_ocr = False
            # Decode formula regions into LaTeX (rendered as $$...$$) instead of
            # emitting Docling's "<!-- formula-not-decoded -->" placeholder, which
            # the reader shows as a blank gap. Runs the CodeFormula model on the GPU.
            # If the source is a scanned/image PDF and formulas still don't decode,
            # the next lever is enabling do_ocr above (slower).
            pipeline_options.do_formula_enrichment = True

            self._converter = DocumentConverter(
                format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
            )
        return self._converter

    def to_markdown(self, data: bytes, filename: str) -> str:
        from docling.datamodel.base_models import DocumentStream

        source = DocumentStream(name=filename or "document.pdf", stream=io.BytesIO(data))
        result = self._get_converter().convert(source)
        document = result.document
        self.last_heading_pages = _docling_heading_pages(document)
        return document.export_to_markdown() or ""


def _docling_heading_pages(document) -> list[HeadingPage]:
    """Per-heading (text, 1-based page) in reading order from a DoclingDocument.

    Reads ``label``/``text``/``prov[0].page_no`` off section-header and title items.
    Best-effort: returns ``[]`` on any structural surprise so ingestion never breaks.
    """
    out: list[HeadingPage] = []
    try:
        for item, _level in document.iterate_items():
            label = str(getattr(item, "label", "")).lower()
            text = getattr(item, "text", None)
            prov = getattr(item, "prov", None)
            if label in _HEADING_LABELS and text and prov:
                out.append(HeadingPage(text=str(text), page_no=int(prov[0].page_no)))
    except Exception:
        return []
    return out


def _heading_pages_from_pages(pages: list[PageText]) -> list[HeadingPage]:
    """Derive heading pages from per-page markdown (used when Docling isn't the engine)."""
    out: list[HeadingPage] = []
    for page in pages:
        for line in page.markdown.split("\n"):
            m = _ATX_RE.match(line)
            if m:
                out.append(HeadingPage(text=m.group(2).strip(), page_no=page.page_no))
    return out


def extract_pages(data: bytes) -> list[PageText]:
    """Per-page markdown via ``pymupdf4llm(page_chunks=True)`` (1-based ``metadata.page``)."""
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        chunks = (
            pymupdf4llm.to_markdown(
                doc, page_chunks=True, detect_bg_color=True, force_text=True
            )
            or []
        )
    except Exception:
        chunks = []
    finally:
        doc.close()

    out: list[PageText] = []
    for ch in chunks:
        if not isinstance(ch, dict):
            continue
        page_no = (ch.get("metadata") or {}).get("page")
        if page_no is None:
            continue
        out.append(PageText(page_no=int(page_no), markdown=(ch.get("text") or "").strip()))
    return out


def extract_pdf_outline(data: bytes) -> list[dict]:
    """The PDF's embedded outline / bookmarks — the author's real Table of Contents — via
    PyMuPDF. Returns ``[{level, title, page}]`` (1-based page, level>=1) in reading order, or
    ``[]`` when the PDF has no bookmarks (scanned/stripped PDFs fall back to TOC-page parsing)."""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            toc = doc.get_toc(simple=True) or []
        finally:
            doc.close()
    except Exception:
        return []
    out: list[dict] = []
    for row in toc:
        try:
            level, title, page = int(row[0]), str(row[1]).strip(), int(row[2])
        except Exception:
            continue
        if title and page > 0:
            out.append({"level": max(1, level), "title": title, "page": page})
    return out


def _make_converter(name: str) -> Converter:
    if name == "pymupdf":
        return PyMuPDFConverter()
    return DoclingConverter()


def select_converter() -> Converter:
    name = (os.environ.get("LEARN_CONVERTER") or "docling").strip().lower()
    key = "pymupdf" if name == "pymupdf" else "docling"
    conv = _CONVERTER_CACHE.get(key)
    if conv is None:
        conv = _make_converter(name)
        _CONVERTER_CACHE[key] = conv
    return conv


def convert_to_markdown(data: bytes, filename: str) -> tuple[str, str]:
    """Run the configured converter, falling back to pymupdf4llm on any failure.

    Returns ``(markdown, engine_name)``. Page provenance is collected separately by
    ``convert_document`` (which wraps this).
    """
    primary = select_converter()
    try:
        md = primary.to_markdown(data, filename)
        if md and md.strip():
            return md, primary.name
        if primary.name != "pymupdf4llm":
            raise PdfConvertError("Converter produced no text", 500)
        return md, primary.name
    except PdfConvertError:
        raise
    except Exception as exc:  # noqa: BLE001 - any converter failure should degrade gracefully
        if primary.name == PyMuPDFConverter.name:
            raise PdfConvertError(f"PDF conversion failed: {exc}", 500) from exc
        fallback = PyMuPDFConverter()
        try:
            return fallback.to_markdown(data, filename), fallback.name
        except Exception as fexc:  # noqa: BLE001
            raise PdfConvertError(f"PDF conversion failed: {fexc}", 500) from fexc


def convert_document(data: bytes, filename: str) -> ConvertedDoc:
    """Full-document markdown + page provenance (heading pages + per-page markdown).

    Mirrors ``convert_to_markdown``'s engine selection + pymupdf fallback, but also
    captures Docling's per-heading page numbers and always extracts per-page markdown
    (cheap pymupdf pass) for the page-primary store.
    """
    primary = select_converter()
    heading_pages: list[HeadingPage] = []
    try:
        md = primary.to_markdown(data, filename)
        engine = primary.name
        heading_pages = list(getattr(primary, "last_heading_pages", []) or [])
        if not (md and md.strip()) and primary.name != PyMuPDFConverter.name:
            raise PdfConvertError("Converter produced no text", 500)
    except PdfConvertError:
        raise
    except Exception as exc:  # noqa: BLE001
        if primary.name == PyMuPDFConverter.name:
            raise PdfConvertError(f"PDF conversion failed: {exc}", 500) from exc
        fallback = PyMuPDFConverter()
        try:
            md = fallback.to_markdown(data, filename)
            engine = fallback.name
            heading_pages = []
        except Exception as fexc:  # noqa: BLE001
            raise PdfConvertError(f"PDF conversion failed: {fexc}", 500) from fexc

    pages = extract_pages(data)
    if not heading_pages:
        # Docling not used (or gave nothing) — derive heading pages from per-page markdown.
        heading_pages = _heading_pages_from_pages(pages)
    outline = extract_pdf_outline(data)
    return ConvertedDoc(
        markdown=md, engine=engine, heading_pages=heading_pages, pages=pages, outline=outline
    )


def converter_health() -> dict[str, str]:
    selected = (os.environ.get("LEARN_CONVERTER") or "docling").strip().lower()
    docling_available = "no"
    try:
        import docling  # noqa: F401

        docling_available = "yes"
    except Exception:  # noqa: BLE001
        docling_available = "no"

    device = "cpu"
    try:
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        device = "unknown"

    return {
        "status": "ok",
        "selected": selected,
        "doclingAvailable": docling_available,
        "fallback": PyMuPDFConverter.name,
        "device": device,
    }
