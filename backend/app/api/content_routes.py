"""Content routes: the book itself — courses, TOC tree, outline, chapters, sections,
elements, figures, keyword search.

Thin routers over the ``process/content`` domain (plus the original-PDF and figure
file streams). The course list decorates content's rows with extraction's concept
counts — api-level composition, both through facades.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Body, Query
from fastapi.responses import FileResponse, JSONResponse

from app.process.content import (
    chapter_units,
    create_version,
    delete_document,
    delete_version,
    edit_block,
    move_blocks,
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
    remove_blocks,
    revert_block,
    save_outline,
    section_material,
    set_main_version,
    source_id_of,
    stale_sections,
    unplaced_blocks,
)
from app.supplemental.media import remove_audiobooks
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
    """Delete a course outright: document row, every learn table keyed by it, its on-disk
    artifacts, and its audiobooks. Irreversible.

    The audiobooks are why this handler is not a pure pass-through. They live in
    `supplemental/media` and `process/content` may not import it — the layering forbids a
    sideways dependency — so `delete_document` takes a callback and the composition happens
    here, at the one layer allowed to know about both (finding B5).
    """
    try:
        data = delete_document(doc, on_deleted=remove_audiobooks)
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


# ── editing the material ───────────────────────────────────────────────────
# Blocks keep their key through an edit — see process/content/editing.py for why
# re-splitting the document on save would destroy every version's material.


@router.get("/api/section/material")
def api_section_material(doc: str = Query(...), scope: str = Query("")) -> JSONResponse:
    """This course's editable blocks for a section — each with the key an edit addresses,
    its own markdown, and whether this course has already rewritten it."""
    try:
        return JSONResponse(section_material(doc, scope))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.patch("/api/section/material")
def api_edit_material(
    doc: str = Query(...),
    block: str = Query(..., description="raw_content key of the block being edited"),
    target: str = Query("version", pattern="^(book|version)$"),
    body: dict = Body(...),
) -> JSONResponse:
    """Rewrite one block. ``target=book`` fixes the source for every course cut from it;
    ``target=version`` stores this course's own wording (copy-on-write)."""
    try:
        data = edit_block(doc, block, body.get("markdown") or "", target)
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.delete("/api/section/material")
def api_revert_material(doc: str = Query(...), block: str = Query(...)) -> JSONResponse:
    """Drop this course's rewrite of a block and read the book's text again."""
    try:
        return JSONResponse(revert_block(doc, block))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.get("/api/material/stale")
def api_stale_sections(doc: str = Query(...)) -> JSONResponse:
    """Sections whose material changed after their concepts were built — the rebuild cue.
    Derived from timestamps, so a rebuild clears it without anything resetting a flag."""
    try:
        return JSONResponse(stale_sections(doc))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


# ── editing a course's outline ─────────────────────────────────────────────
# Saves are whole-outline and reconcile in place: a node's id encodes its section key and
# version_blocks points at it, so delete-and-recreate would unplace every block on a reorder.


@router.post("/api/outline")
def api_save_outline(doc: str = Query(...), body: dict = Body(...)) -> JSONResponse:
    """Reconcile this course's outline to the sections given — an ordered flat list of
    ``{sectionKey?, title, depth}``. A section with no key is new. Removing sections is
    refused on the Default course (409): concepts anchor to its tree."""
    try:
        data = save_outline(doc, body.get("sections") or [])
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.patch("/api/version/blocks")
def api_move_blocks(
    doc: str = Query(...), section: str = Query(...), body: dict = Body(...)
) -> JSONResponse:
    """File the given blocks under a different section of this course."""
    try:
        data = move_blocks(doc, body.get("blocks") or [], section)
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.post("/api/version/blocks/remove")
def api_remove_blocks(doc: str = Query(...), body: dict = Body(...)) -> JSONResponse:
    """Drop material from THIS course — distilling. The book and other courses keep it.
    POST rather than DELETE because the block list is a body, not a query string."""
    try:
        data = remove_blocks(doc, body.get("blocks") or [])
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.get("/api/version/unplaced")
def api_unplaced_blocks(doc: str = Query(...)) -> JSONResponse:
    """Material this course keeps but files under no section — so a delete never makes
    content vanish silently, it just leaves it unplaced."""
    try:
        return JSONResponse(unplaced_blocks(doc))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
