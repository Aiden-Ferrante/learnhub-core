"""API routes for server-side concept extraction.

Extraction is long (~15-20 min/chapter), so ``POST /api/extract`` starts a background
job and returns immediately; the client polls ``GET /api/extract/status``.
"""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.extraction.concept_store import fetch_document_concepts, fetch_section_concepts
from app.extraction.runner import extraction_status, start_extraction

router = APIRouter()


@router.post("/api/extract")
async def api_extract(
    doc: str | None = None,
    scope: str | None = None,
    body: dict | None = Body(default=None),
) -> JSONResponse:
    """Start a background concept extraction. ``?scope=toc:1`` = one chapter (and everything
    under it); body ``sectionKeys`` = an exact set (the TOC-preview selection); neither =
    the whole document (slow). Returns immediately with ``status:running``."""
    body = body or {}
    concurrency = int(body.get("concurrency") or 3)
    raw_keys = body.get("sectionKeys")
    section_keys = [str(k) for k in raw_keys if k] if isinstance(raw_keys, list) else None
    model = body.get("model")
    model = str(model).strip() if model else None
    data = start_extraction(
        doc, scope, concurrency=concurrency, section_keys=section_keys or None, model=model
    )
    return JSONResponse(data, status_code=503 if data.get("status") == "error" else 200)


@router.get("/api/extract/status")
def api_extract_status(doc: str | None = None, scope: str | None = None) -> JSONResponse:
    """Poll a background extraction's status (idle | running | done | error)."""
    return JSONResponse(extraction_status(doc, scope))


@router.get("/api/concepts")
def api_document_concepts(doc: str | None = None) -> JSONResponse:
    """Document-level canonical (deduped) concept list with merged provenance."""
    data = fetch_document_concepts(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/section/{key:path}/concepts")
def api_section_concepts(key: str, doc: str | None = None) -> JSONResponse:
    """Concept-lessons for a section (the course view)."""
    data = fetch_section_concepts(key, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)
