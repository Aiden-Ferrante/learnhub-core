"""Content routes: the book itself — courses, TOC tree, outline, chapters, sections,
elements, figures, keyword search.

Thin routers over the ``process/content`` domain (plus the original-PDF and figure
file streams). The course list decorates content's rows with extraction's concept
counts — api-level composition, both through facades.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, JSONResponse

from app.process.content import (
    chapter_units,
    create_version,
    delete_document,
    delete_version,
    fetch_chapter,
    fetch_elements,
    fetch_latest_document,
    fetch_outline,
    fetch_section_content,
    figure_path,
    get_toc_tree,
    keyword_search,
    list_documents,
    list_versions,
    rename_version,
    resolve_doc_id,
    set_main_version,
    source_id_of,
)
from app.process.extraction import concept_counts_by_doc

router = APIRouter()


@router.get("/api/documents")
def api_list_documents() -> JSONResponse:
    """List the processed courses (one per converted document). Returns the learnDocId each
    study/concept endpoint expects as ``doc``."""
    try:
        rows = list_documents()
        counts = concept_counts_by_doc()
        for r in rows:
            r["conceptCount"] = counts.get(r["docId"], 0)
        return JSONResponse({"documents": rows})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.delete("/api/document")
def api_delete_document(doc: str = Query(...)) -> JSONResponse:
    """Delete a course outright: document row, every learn table keyed by it, and its
    on-disk artifacts. Irreversible."""
    try:
        data = delete_document(doc)
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.get("/api/chapters")
def api_chapters(doc: str | None = None) -> JSONResponse:
    """Canonical chapter units — every chapter list in the app derives from this."""
    data = chapter_units(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/chapter")
def api_chapter(
    doc: str | None = Query(None),
    ref: str = Query(..., description="chapter number, sectionKey, or title substring"),
    max_chars: int = Query(0, ge=0, description="optional cap on returned markdown (0 = no cap)"),
) -> JSONResponse:
    """Pull an ENTIRE chapter's text by number / sectionKey / title substring."""
    try:
        data = fetch_chapter(doc, ref, max_chars=max_chars)
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.get("/api/search")
def api_search(
    doc: str | None = Query(None),
    q: str = Query(..., min_length=2, description="keywords to find in the course content"),
    limit: int = Query(8, ge=1, le=40),
    full: bool = Query(False, description="include each match's full block markdown"),
) -> JSONResponse:
    """Keyword-search a course's content — locate a topic, then pull it with
    /api/section or /api/chapter."""
    try:
        return JSONResponse(keyword_search(doc, q, limit=limit, full=full))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


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
    # The PDF belongs to the book, not to the course version reading it — resolve to the
    # source so every version of a book serves the same original file.
    doc_id = source_id_of(resolve_doc_id(doc))
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


# ── course versions ────────────────────────────────────────────────────────
# A book can carry several named courses over it. `doc` is any version of the book;
# these all resolve to the book and act on its version set.


@router.get("/api/versions")
def api_list_versions(doc: str = Query(...)) -> JSONResponse:
    """Every version of this doc's book, oldest first, with which one is main."""
    try:
        return JSONResponse(list_versions(doc))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.post("/api/version")
def api_create_version(doc: str = Query(...), name: str = Query(..., min_length=1)) -> JSONResponse:
    """A new version of this book, seeded from its Default (same outline, all material).
    Created not-main; switching is a separate call."""
    try:
        data = create_version(doc, name)
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.patch("/api/version")
def api_update_version(
    doc: str = Query(...),
    name: str | None = Query(None),
    main: bool | None = Query(None, description="true = make this the version the card opens"),
) -> JSONResponse:
    """Rename a version and/or make it main. Both are idempotent."""
    try:
        out: dict = {}
        if name is not None:
            data = rename_version(doc, name)
            if data.get("error"):
                return JSONResponse(data, status_code=data.pop("status", 400))
            out.update(data)
        if main:
            data = set_main_version(doc)
            if data.get("error"):
                return JSONResponse(data, status_code=data.pop("status", 400))
            out.update(data)
        if not out:
            return JSONResponse({"error": "nothing to update"}, status_code=400)
        return JSONResponse(out)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.delete("/api/version")
def api_delete_version(doc: str = Query(...)) -> JSONResponse:
    """Delete ONE version — its outline, material mapping and study state. The book, its
    text and its concepts survive. The Default cannot be deleted (409)."""
    try:
        data = delete_version(doc)
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
