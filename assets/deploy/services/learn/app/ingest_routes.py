"""Ingestion: PDF -> Markdown as a background job.

Converting a large book takes minutes (Docling layout + formula models), which is longer
than the ~5-min undici fetch timeout on the app->learn hop. So ``POST /api/convert-pdf``
starts a background job and returns a ``jobId`` immediately; the client polls
``GET /api/convert-pdf/status``. This never holds a request open for the whole conversion
and survives an app restart (the browser just keeps polling).
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.pdf_convert import PdfConvertError, convert_pdf_bytes, pdf_convert_health

router = APIRouter()

# In-memory conversion jobs: jobId -> {status, filename, result?|error?}.
_CONVERT_JOBS: dict[str, dict] = {}
_MAX_JOBS = 50


def _result_payload(result) -> dict:
    return {
        "markdown": result.markdown,
        "sourceFilename": result.source_filename,
        "outputFilename": result.output_filename,
        "pageCount": result.page_count,
        "savedPath": result.saved_path,
        "docId": result.doc_id,
        "engine": result.engine,
        "hasPageProvenance": result.has_page_provenance,
        "elementCount": result.element_count,
    }


def _prune_jobs() -> None:
    """Bound the jobs map: drop the oldest finished jobs (dict keeps insertion order)."""
    if len(_CONVERT_JOBS) <= _MAX_JOBS:
        return
    for key in list(_CONVERT_JOBS)[: len(_CONVERT_JOBS) - _MAX_JOBS]:
        if _CONVERT_JOBS[key].get("status") in ("done", "error"):
            _CONVERT_JOBS.pop(key, None)


async def _run_convert(job_id: str, data: bytes, filename: str) -> None:
    try:
        result = await asyncio.to_thread(convert_pdf_bytes, data, filename)
        _CONVERT_JOBS[job_id] = {"status": "done", "filename": filename, "result": _result_payload(result)}
    except PdfConvertError as e:
        _CONVERT_JOBS[job_id] = {"status": "error", "filename": filename, "error": str(e), "statusCode": e.status_code}
    except Exception as e:  # noqa: BLE001 — surface in status, never crash the loop
        _CONVERT_JOBS[job_id] = {"status": "error", "filename": filename, "error": str(e), "statusCode": 500}


@router.get("/api/convert-pdf/health")
def convert_pdf_health() -> JSONResponse:
    return JSONResponse(pdf_convert_health())


@router.post("/api/convert-pdf")
async def convert_pdf(file: UploadFile = File(...)) -> JSONResponse:
    """Start a background PDF->markdown conversion; returns ``{jobId, status:"running"}``."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only .pdf files are accepted")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    job_id = uuid.uuid4().hex
    _prune_jobs()
    _CONVERT_JOBS[job_id] = {"status": "running", "filename": file.filename}
    asyncio.create_task(_run_convert(job_id, data, file.filename))
    return JSONResponse({"jobId": job_id, "status": "running", "filename": file.filename})


@router.get("/api/convert-pdf/status")
def convert_pdf_status(jobId: str) -> JSONResponse:
    """Poll a conversion job: ``running`` | ``done`` (+result) | ``error`` (+error) | ``unknown``."""
    job = _CONVERT_JOBS.get(jobId)
    if job is None:
        return JSONResponse({"status": "unknown", "error": "job not found"}, status_code=404)
    return JSONResponse(job)
