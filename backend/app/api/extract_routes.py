"""API routes for server-side concept extraction.

Extraction is long (~15-20 min/chapter), so ``POST /api/extract`` starts a background
job and returns immediately; the client polls ``GET /api/extract/status``.
"""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.content.documents import resolve_doc_id
from app.extraction.concept_store import fetch_document_concepts, fetch_section_concepts
from app.platform.jobs import enqueue_build, list_builds

router = APIRouter()

# Map the persistent queue's job status onto the legacy extract-status vocabulary the
# client polls (idle | running | done | error). Extraction now runs as a queue "build"
# job (concepts + deep overlay) — same net behavior as the retired in-memory runner.
_STATUS = {"queued": "running", "running": "running", "done": "done",
           "error": "error", "canceled": "idle"}


@router.post("/api/extract")
async def api_extract(
    doc: str | None = None,
    scope: str | None = None,
    body: dict | None = Body(default=None),
) -> JSONResponse:
    """Start a background concept extraction (queued). ``?scope=toc:1`` = one chapter (and
    everything under it); body ``sectionKeys`` = an exact set (the TOC-preview selection);
    neither = the whole document (slow). Returns immediately with ``status:running``."""
    body = body or {}
    raw_keys = body.get("sectionKeys")
    section_keys = [str(k) for k in raw_keys if k] if isinstance(raw_keys, list) else None
    model = body.get("model")
    model = str(model).strip() if model else None
    payload: dict = {"force": True}  # /api/extract is an explicit re-extract request
    if section_keys:
        payload["sectionKeys"] = section_keys
    if model:
        payload["model"] = model
    data = enqueue_build(doc, scope or "", kind="build", payload=payload)
    if data.get("error"):
        return JSONResponse({"status": "error", "error": data["error"]}, status_code=503)
    return JSONResponse({"status": "running", "docId": data.get("docId"), "scope": scope})


@router.get("/api/extract/status")
def api_extract_status(doc: str | None = None, scope: str | None = None) -> JSONResponse:
    """Poll a background extraction's status (idle | running | done | error)."""
    doc_id = resolve_doc_id(doc)
    if not doc_id:
        return JSONResponse({"status": "idle", "scope": scope})
    builds = list_builds(doc_id, kind="build").get("builds", [])
    job = next((b for b in builds if (b.get("scope") or "") == (scope or "")), None)
    if not job:
        return JSONResponse({"status": "idle", "scope": scope, "docId": doc_id})
    out: dict = {"status": _STATUS.get(job.get("status"), "idle"), "scope": scope, "docId": doc_id}
    if job.get("total"):
        out["progress"] = {"done": job.get("done"), "total": job.get("total"), "current": job.get("phase")}
    if job.get("summary"):
        out["summary"] = job["summary"]
    if job.get("status") == "error":
        out["error"] = job.get("error")
    return JSONResponse(out)


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
