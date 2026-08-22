"""Process routes: the document-processing side — upload→convert, extract, the build
queue/ledger, and the per-course pipeline status.

Long work never runs in a request: POST endpoints stash inputs and enqueue a job on
the persistent ledger (gateways/ledger, drained by conductor/worker); clients poll
the matching status endpoint.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from app.conductor import prepare_upload
from app.gateways import KINDS, cancel_build, enqueue_build, list_builds
from app.process.content import chapter_key_of, document_overview, fetch_latest_document, find_by_source_hash, resolve_doc_id
from app.process.extraction import section_concept_rows
from app.process.ingestion import MARKDOWN_SUFFIXES, source_hash_of

router = APIRouter()

# What ``/api/convert-pdf`` will take. A rendered book or an authored one.
ACCEPTED_SUFFIXES = (".pdf", *MARKDOWN_SUFFIXES)

# Map the persistent queue's job status onto the status vocabulary clients poll.
_CONVERT_STATUS = {"queued": "running", "running": "running", "done": "done",
                   "error": "error", "canceled": "error"}
_EXTRACT_STATUS = {"queued": "running", "running": "running", "done": "done",
                   "error": "error", "canceled": "idle"}


# ── Ingest: PDF → markdown ──────────────────────────────────────────────────


@router.post("/api/convert-pdf")
async def convert_pdf(file: UploadFile = File(...), force: int = Query(0)) -> JSONResponse:
    """Start a background conversion; returns ``{jobId, status:"running"}``.

    Accepts a rendered book (``.pdf``) or an authored one (``.md``); the conductor picks
    the converter from the extension. If this exact file (by content hash) was already
    ingested, returns ``{status:"duplicate", docId, ...}`` instead — pass ``?force=1`` to
    re-ingest anyway.

    The route keeps its ``/api/convert-pdf`` path: it is the documented seam the frontend
    proxy and the status endpoint are both keyed to, and renaming it would break queued
    clients for a cosmetic gain."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not file.filename.lower().endswith(ACCEPTED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail=f"Only {', '.join(ACCEPTED_SUFFIXES)} files are accepted",
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    if not force:
        existing = find_by_source_hash(source_hash_of(data))
        if existing:
            return JSONResponse(
                {
                    "status": "duplicate",
                    "docId": existing["docId"],
                    "existingTitle": existing.get("title"),
                    "existingFilename": existing.get("sourceFilename"),
                    "filename": file.filename,
                }
            )

    prep = prepare_upload(data, file.filename)  # mint docId + stash the PDF on /shared
    enqueue_build(prep["docId"], "", kind="convert",
                  payload={"pdfPath": prep["pdfPath"], "filename": file.filename})
    return JSONResponse({"jobId": prep["docId"], "status": "running", "filename": file.filename})


@router.get("/api/convert-pdf/status")
def convert_pdf_status(jobId: str) -> JSONResponse:
    """Poll a conversion job: ``running`` | ``done`` (+result) | ``error`` (+error) | ``unknown``.
    ``jobId`` is the document id. On ``done`` the result's markdown is read from the stored
    document (kept off the job ledger row)."""
    builds = list_builds(jobId, kind="convert").get("builds", [])
    job = builds[0] if builds else None
    if not job:
        return JSONResponse({"status": "unknown", "error": "job not found"}, status_code=404)
    status = _CONVERT_STATUS.get(job.get("status"), "running")
    out: dict = {"status": status, "filename": job.get("filename")}
    if status == "done" and job.get("result"):
        result = dict(job["result"])
        doc = (fetch_latest_document(jobId) or {}).get("document") or {}
        result["markdown"] = doc.get("markdown", "")
        out["result"] = result
    elif status == "error":
        out["error"] = job.get("error") or "conversion failed"
        if job.get("statusCode"):
            out["statusCode"] = job["statusCode"]
    return JSONResponse(out)


# ── Extract: content → concepts ─────────────────────────────────────────────


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
    data = enqueue_build(doc, scope or "", kind="extract", payload=payload)
    if data.get("error"):
        return JSONResponse({"status": "error", "error": data["error"]}, status_code=503)
    return JSONResponse({"status": "running", "docId": data.get("docId"), "scope": scope})


@router.get("/api/extract/status")
def api_extract_status(doc: str | None = None, scope: str | None = None) -> JSONResponse:
    """Poll a background extraction's status (idle | running | done | error)."""
    doc_id = resolve_doc_id(doc)
    if not doc_id:
        return JSONResponse({"status": "idle", "scope": scope})
    builds = list_builds(doc_id, kind="extract").get("builds", [])
    job = next((b for b in builds if (b.get("scope") or "") == (scope or "")), None)
    if not job:
        return JSONResponse({"status": "idle", "scope": scope, "docId": doc_id})
    out: dict = {"status": _EXTRACT_STATUS.get(job.get("status"), "idle"), "scope": scope, "docId": doc_id}
    if job.get("total"):
        out["progress"] = {"done": job.get("done"), "total": job.get("total"), "current": job.get("phase")}
    if job.get("summary"):
        out["summary"] = job["summary"]
    if job.get("status") == "error":
        out["error"] = job.get("error")
    return JSONResponse(out)


# ── Build queue: enqueue any artifact kind, cancel, list, full ledger ───────


@router.post("/api/build")
def api_build(
    doc: str | None = None, scope: str = "", body: dict | None = Body(default=None)
) -> JSONResponse:
    if not scope:
        return JSONResponse({"error": "scope required"}, status_code=400)
    body = body or {}
    at = body.get("at")
    kind = str(body.get("kind") or "build")
    if kind not in KINDS:
        return JSONResponse({"error": f"kind must be one of {', '.join(KINDS)}"}, status_code=400)
    data = enqueue_build(doc, scope, not_before=int(at) if at else None, kind=kind)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.post("/api/build/cancel")
def api_build_cancel(
    doc: str | None = None, scope: str = "", kind: str = "build"
) -> JSONResponse:
    """Cancel one job. ``scope`` is part of the job's identity, not a filter — an empty
    scope names the whole-document job specifically, which is exactly what
    ``POST /api/extract`` with no scope enqueues. Rejecting it left those jobs
    uncancellable: the only way to stop one was to edit the ledger by hand."""
    data = cancel_build(doc, scope, kind=kind)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/build")
def api_build_list(doc: str | None = None) -> JSONResponse:
    data = list_builds(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/jobs")
def api_jobs(doc: str | None = None) -> JSONResponse:
    """The full processing ledger for a course — every kind, queued/running/done/error."""
    data = list_builds(doc, kind=None)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


# ── Course status: one pipeline readout per course ──────────────────────────


@router.get("/api/course-status")
def api_course_status(doc: str = Query(...)) -> JSONResponse:
    """One pipeline status for a course: does the content exist, is there an outline, and
    how far concept coverage has progressed per chapter. Drives the UI status strip
    and reason-aware empty states (exists=false -> broken content link)."""
    try:
        row = document_overview(doc)
        if row is None:
            return JSONResponse(
                {"doc": doc, "exists": False, "reason": "doc-not-found"}, status_code=404
            )
        concept_rows = section_concept_rows(doc)
        outline = row.get("outline") or []
        top = [e for e in outline if (e.get("listDepth") or 0) == 0]
        # Numbered chapters are the study surface; front/back matter (Title Page, Index…)
        # never gets concepts and would make the coverage denominator unreachable. Books
        # without numbered chapters (slug outlines) fall back to all top-level entries.
        numbered = [e for e in top if e.get("numberKey")]
        chapters = numbered or top
        chapter_keys = {e.get("sectionKey") for e in chapters if e.get("sectionKey")}

        with_concepts: set[str] = set()
        for c in concept_rows:
            ck = chapter_key_of(c.get("sectionKey") or "")
            if ck in chapter_keys:
                with_concepts.add(ck)
        return JSONResponse(
            {
                "doc": doc,
                "exists": True,
                "title": row.get("title"),
                "converted": True,
                "pageCount": row.get("pageCount"),
                "sectionCount": row.get("sectionCount"),
                "outlineEntries": len(outline),
                "chaptersTotal": len(chapter_keys),
                "chaptersWithConcepts": len(with_concepts),
                "conceptCount": len(concept_rows),
            }
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503)
