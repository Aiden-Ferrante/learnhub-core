"""Content reads: the book itself — TOC tree, outline, document, sections, elements, figures.

Thin routers over the ``content`` domain (plus the original-PDF and figure file streams).
Moved out of main.py so it is a pure composition root.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from app.content import (
    fetch_elements,
    fetch_latest_document,
    fetch_outline,
    fetch_section_content,
    figure_path,
    get_toc_tree,
    resolve_doc_id,
)

router = APIRouter()


@router.get("/api/toc-tree")
def api_toc_tree(doc: str | None = None) -> JSONResponse:
    forest, section_count, err = get_toc_tree(doc)
    if err:
        return JSONResponse({"error": err, "tree": [], "sectionCount": 0}, status_code=503)
    return JSONResponse({"tree": forest, "sectionCount": section_count})


@router.get("/api/document")
def api_document(id: str | None = None) -> JSONResponse:
    data = fetch_latest_document(id)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/outline")
def api_outline(doc: str | None = None) -> JSONResponse:
    """The document's outline only (no markdown) — chapter list for the reader."""
    data = fetch_outline(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/document/pdf")
def api_document_pdf(doc: str | None = None):
    """The ORIGINAL uploaded PDF, untouched — the source of truth a reader can verify
    the extracted content against. 404 for documents ingested from non-PDF sources."""
    doc_id = resolve_doc_id(doc)
    # Ingest ids are uuid-ish; reject anything that could traverse the shared dir.
    if not doc_id or set(doc_id) - set("0123456789abcdef-"):
        return JSONResponse({"error": "doc required"}, status_code=400)
    path = Path(os.environ.get("SHARED_DIR", "/shared")) / "ingest" / doc_id / "original.pdf"
    if not path.exists():
        return JSONResponse({"error": "no original PDF for this document"}, status_code=404)
    return FileResponse(str(path), media_type="application/pdf")


@router.get("/api/section/{key:path}/content")
def api_section_content(key: str, doc: str | None = None) -> JSONResponse:
    data = fetch_section_content(key, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/elements")
def api_elements(doc: str | None = None, scope: str | None = None, type: str | None = None) -> JSONResponse:
    """The typed retrieval layer: list a document's figures/tables/equations/code, filtered by
    ``scope`` (a toc: key → section + descendants) and/or ``type``. Figures carry an ``imageRef``;
    fetch the bytes from ``/api/figure?doc=&n=<order>``."""
    data = fetch_elements(doc, scope=scope, el_type=type)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/figure")
def api_figure(doc: str, n: int):
    """Serve a figure PNG by (doc, element order ``n``). 404 when the file is missing."""
    p = figure_path(doc, n)
    if p is None:
        return JSONResponse({"error": "figure not found"}, status_code=404)
    return FileResponse(str(p), media_type="image/png")
