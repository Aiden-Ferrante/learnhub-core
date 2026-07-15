"""Ingestion: PDF -> Markdown as a persistent queue job.

Converting a large book takes minutes (Docling layout + formula models), which is longer
than the ~5-min undici fetch timeout on the app->learn hop. So ``POST /api/convert-pdf``
stashes the upload on the shared volume, enqueues a ``convert`` job, and returns a
``jobId`` immediately; the client polls ``GET /api/convert-pdf/status``. The job lives on
the persistent queue (pipeline/build worker), so it survives an app restart.

The ``jobId`` is the document id minted at upload — the queue keys the convert job by it.
"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from app.content.documents import fetch_latest_document
from app.content.documents import find_by_source_hash
from app.ingestion.pdf_convert import source_hash_of
from app.pipeline.ingest import prepare_upload
from app.platform.jobs import enqueue_build, list_builds

router = APIRouter()

_STATUS = {"queued": "running", "running": "running", "done": "done",
           "error": "error", "canceled": "error"}


@router.post("/api/convert-pdf")
async def convert_pdf(file: UploadFile = File(...), force: int = Query(0)) -> JSONResponse:
    """Start a background PDF->markdown conversion; returns ``{jobId, status:"running"}``.
    If this exact PDF (by content hash) was already ingested, returns
    ``{status:"duplicate", docId, ...}`` instead — pass ``?force=1`` to re-ingest anyway."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only .pdf files are accepted")
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
    status = _STATUS.get(job.get("status"), "running")
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
