"""Pluggable PDF -> Markdown converters behind a small ``Converter`` interface.

Docling is the higher-fidelity default (hierarchical headings, better tables/math);
``pymupdf4llm`` remains the always-available fallback. Selection is via the
``LEARN_CONVERTER`` env var ("docling" | "pymupdf"); if the chosen engine fails to
import or convert, we fall back to pymupdf so ingestion never hard-breaks.

Page provenance: alongside the full-document markdown we collect (a) per-heading page
numbers from Docling's structured document (``iterate_items`` → ``prov[0].page_no``) and
(b) per-page markdown via ``pymupdf4llm(page_chunks=True)``. ``content/store`` joins
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

from app.process.content import replacement_char_ratio

# A single converter instance is reused across requests so Docling's heavy formula/layout
# models load ONCE, not per conversion (which was slow + churned GPU memory → "fetch
# failed" / restart crashes). The lock guards the first (model-loading) build.
_CONVERTER_CACHE: dict[str, "Converter"] = {}
_CONVERTER_LOCK = threading.Lock()

_ATX_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_HEADING_LABELS = {"section_header", "title"}

# Typed-element extraction (the retrieval layer): pull figures/tables/equations/code out of
# the structured Docling document alongside the markdown. On by default; LEARN_EXTRACT_ELEMENTS=0
# disables it (and skips picture rasterization, saving convert time/memory).
_EXTRACT_ELEMENTS = os.environ.get("LEARN_EXTRACT_ELEMENTS", "1").strip().lower() not in ("0", "false", "no")
_IMAGE_SCALE = float(os.environ.get("LEARN_IMAGE_SCALE", "2.0") or "2.0")


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
class Element:
    """A typed, page-located artifact from the structured document (figure / table /
    equation / code) — the retrieval layer that sits beside the flat markdown."""

    type: str  # figure | table | equation | code
    page: int | None = None
    bbox: list[float] | None = None      # [l, t, r, b] in the page's coordinate space
    bbox_origin: str | None = None       # TOPLEFT | BOTTOMLEFT (how to read bbox)
    caption: str | None = None
    latex: str | None = None             # equation body
    table_markdown: str | None = None
    table_data: dict | None = None       # {columns: [...], rows: [[...]]}
    code: str | None = None
    language: str | None = None
    image_png: bytes | None = None       # figure raster (PNG); persisted to /shared in piece 2


@dataclass
class ConvertedDoc:
    """Full-document markdown plus page-provenance side channels."""

    markdown: str
    engine: str
    heading_pages: list[HeadingPage] = field(default_factory=list)
    pages: list[PageText] = field(default_factory=list)
    outline: list[dict] = field(default_factory=list)  # embedded PDF bookmarks (the real TOC)
    elements: list[Element] = field(default_factory=list)  # typed artifacts (figure/table/equation/code)


class PdfConvertError(Exception):
    """User-facing conversion failure."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class Converter(Protocol):
    """A PDF engine returns everything it knows in one ``ConvertedDoc`` — markdown plus
    whatever provenance it can produce (heading pages, typed elements). Engines that
    can't produce a channel leave it empty; ``convert_document`` fills the gaps."""

    name: str

    def convert(self, data: bytes, filename: str) -> ConvertedDoc: ...


class PyMuPDFConverter:
    """Fast, dependency-light extraction via pymupdf4llm (the original engine)."""

    name = "pymupdf4llm"

    def convert(self, data: bytes, filename: str) -> ConvertedDoc:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            kwargs: dict = {"detect_bg_color": True, "force_text": True}
            markdown = pymupdf4llm.to_markdown(doc, **kwargs) or ""
            if replacement_char_ratio(markdown) > 0.002:
                try:
                    alt = pymupdf4llm.to_markdown(doc, use_glyphs=True, **kwargs) or ""
                    if replacement_char_ratio(alt) < replacement_char_ratio(markdown):
                        markdown = alt
                except TypeError:
                    pass
            return ConvertedDoc(markdown=markdown, engine=self.name)
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
            # Rasterize figures so the retrieval layer can persist them; without this,
            # pictures are detected but dropped as "<!-- image -->" placeholders.
            if _EXTRACT_ELEMENTS:
                pipeline_options.generate_picture_images = True
                pipeline_options.images_scale = _IMAGE_SCALE

            self._converter = DocumentConverter(
                format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
            )
        return self._converter

    def convert(self, data: bytes, filename: str) -> ConvertedDoc:
        from docling.datamodel.base_models import DocumentStream

        source = DocumentStream(name=filename or "document.pdf", stream=io.BytesIO(data))
        result = self._get_converter().convert(source)
        document = result.document
        return ConvertedDoc(
            markdown=document.export_to_markdown() or "",
            engine=self.name,
            heading_pages=_docling_heading_pages(document),
            elements=_docling_elements(document) if _EXTRACT_ELEMENTS else [],
        )


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


def _prov_page_bbox(item) -> tuple[int | None, list[float] | None, str | None]:
    """``(1-based page, [l,t,r,b], coord_origin)`` from an item's first provenance, or Nones."""
    prov = getattr(item, "prov", None) or []
    if not prov:
        return None, None, None
    p = prov[0]
    page = int(p.page_no) if getattr(p, "page_no", None) is not None else None
    bbox = origin = None
    bb = getattr(p, "bbox", None)
    if bb is not None:
        try:
            bbox = [float(bb.l), float(bb.t), float(bb.r), float(bb.b)]
            origin = str(getattr(bb, "coord_origin", "") or "") or None
        except Exception:  # noqa: BLE001
            bbox = origin = None
    return page, bbox, origin


def _caption_text(item, document) -> str | None:
    try:
        cap = (item.caption_text(document) or "").strip()
    except Exception:  # noqa: BLE001
        return None
    return cap or None


def _picture_png(item, document) -> bytes | None:
    """Render a PictureItem to PNG bytes (requires ``generate_picture_images``)."""
    try:
        img = item.get_image(document)
    except Exception:  # noqa: BLE001
        return None
    if img is None:
        return None
    try:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:  # noqa: BLE001
        return None


def _docling_elements(document) -> list[Element]:
    """Typed artifacts (figure/table/equation/code) from a DoclingDocument, in reading order.

    Best-effort: a structural surprise on one item is skipped (never fatal), and the whole
    walk returns ``[]`` on any top-level failure so ingestion never breaks.
    """
    try:
        from docling_core.types.doc.document import CodeItem, FormulaItem, PictureItem, TableItem
    except Exception:  # noqa: BLE001
        return []

    out: list[Element] = []
    try:
        for item, _level in document.iterate_items():
            try:
                # FormulaItem/CodeItem subclass TextItem, so test the specific types.
                if isinstance(item, TableItem):
                    page, bbox, origin = _prov_page_bbox(item)
                    try:
                        table_md = item.export_to_markdown(document) or None
                    except Exception:  # noqa: BLE001
                        table_md = None
                    table_data = None
                    try:
                        df = item.export_to_dataframe(document)
                        table_data = {
                            "columns": [str(c) for c in df.columns],
                            "rows": df.astype(str).values.tolist(),
                        }
                    except Exception:  # noqa: BLE001
                        table_data = None
                    out.append(Element(
                        type="table", page=page, bbox=bbox, bbox_origin=origin,
                        caption=_caption_text(item, document),
                        table_markdown=table_md, table_data=table_data,
                    ))
                elif isinstance(item, PictureItem):
                    page, bbox, origin = _prov_page_bbox(item)
                    out.append(Element(
                        type="figure", page=page, bbox=bbox, bbox_origin=origin,
                        caption=_caption_text(item, document),
                        image_png=_picture_png(item, document),
                    ))
                elif isinstance(item, FormulaItem):
                    latex = (getattr(item, "text", "") or "").strip()
                    if latex:
                        page, bbox, origin = _prov_page_bbox(item)
                        out.append(Element(type="equation", page=page, bbox=bbox, bbox_origin=origin, latex=latex))
                elif isinstance(item, CodeItem):
                    code = (getattr(item, "text", "") or "").strip()
                    if code:
                        page, bbox, origin = _prov_page_bbox(item)
                        lang = getattr(item, "code_language", None)
                        lang = getattr(lang, "value", lang)
                        out.append(Element(
                            type="code", page=page, bbox=bbox, bbox_origin=origin,
                            code=code, language=(str(lang) if lang else None),
                        ))
            except Exception:  # noqa: BLE001
                continue
    except Exception:  # noqa: BLE001
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
    ``[]`` when the PDF has no bookmarks. There is NO fallback parsing here: an empty list
    hands the TOC controller (content/toc_controller.py) to its derive strategies —
    ``derive_from_headings`` builds structure from the split blocks' own headings; only
    when every strategy fails does the route become ``none``, loudly logged."""
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


def convert_document(data: bytes, filename: str) -> ConvertedDoc:
    """Full-document markdown + page provenance (heading pages + per-page markdown).

    Runs the configured engine (pymupdf fallback on any failure), then fills the
    provenance channels the engine couldn't produce: per-page markdown (cheap pymupdf
    pass, always), heading pages (derived from page markdown when the engine gave
    none), and the PDF's embedded bookmark outline.
    """
    primary = select_converter()
    doc: ConvertedDoc | None = None
    primary_err: Exception | None = None
    try:
        doc = primary.convert(data, filename)
        if not doc.markdown.strip():
            doc = None  # engine ran but produced nothing usable — same as a failure
    except Exception as exc:  # noqa: BLE001 — any engine failure should degrade gracefully
        primary_err = exc
    if doc is None and primary.name != PyMuPDFConverter.name:
        # Fall back to pymupdf. Empty fallback output is NOT an error here — the caller
        # turns "no extractable text" into a friendly 400 (likely a scanned PDF).
        try:
            doc = PyMuPDFConverter().convert(data, filename)
        except Exception as fexc:  # noqa: BLE001
            raise PdfConvertError(f"PDF conversion failed: {fexc}", 500) from fexc
    if doc is None:
        raise PdfConvertError(f"PDF conversion failed: {primary_err}", 500) from primary_err

    doc.pages = extract_pages(data)
    if not doc.heading_pages:
        # Engine gave no heading provenance — derive it from per-page markdown.
        doc.heading_pages = _heading_pages_from_pages(doc.pages)
    doc.outline = extract_pdf_outline(data)
    return doc


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
