"""Concept routes: read the extracted concept layer + curate it.

Reads serve the concepts surface; the write routes (edit / delete) exist for
curation — mostly driven by the MCP server. A concept delete cascades to its
review schedule via the study facade (each domain cleans its own table).
"""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.process.extraction import delete_concept, fetch_document_concepts, fetch_section_concepts, update_concept
from app.supplemental.study import delete_concept_reviews

router = APIRouter()


@router.get("/api/concepts")
def api_document_concepts(doc: str | None = None) -> JSONResponse:
    """Document-level concept list with provenance."""
    data = fetch_document_concepts(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/section/{key:path}/concepts")
def api_section_concepts(key: str, doc: str | None = None) -> JSONResponse:
    """Concept-lessons for a section (the course view)."""
    data = fetch_section_concepts(key, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.patch("/api/concept/{key}")
def api_update_concept(key: str, body: dict = Body(...)) -> JSONResponse:
    """Edit a concept's curatable fields (name, signal, source, kind).
    Keys/provenance are immutable; review history is keyed by the concept key (untouched)."""
    try:
        data = update_concept(key, body or {})
        return JSONResponse(data, status_code=data.pop("status", 200) if data.get("error") else 200)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)


@router.delete("/api/concept/{key}")
def api_delete_concept(key: str) -> JSONResponse:
    """Curation: remove a junk concept plus its review history. The concept's
    section/document content is untouched — re-extracting the section will re-create
    the concept if the model still finds it."""
    try:
        data = delete_concept(key)
        if data.get("error"):
            return JSONResponse(data, status_code=data.pop("status", 404))
        data["reviews"] = delete_concept_reviews(key)
        return JSONResponse(data)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
