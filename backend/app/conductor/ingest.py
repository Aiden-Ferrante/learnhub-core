"""Phase 1 conductor — ingestion: raw PDF → converted markdown → persisted content.

The single entry point for "ingest a document," so phase 1 is one legible thing. The
actual work lives in the domains: conversion in ingestion/ (reader, pdf_convert) and
persistence in content/ (store).

Ingestion runs as a persistent ``convert`` queue job (survives restart): the route saves
the uploaded PDF to the shared volume and enqueues, the worker calls ``run_convert``. The
document id is minted at upload (``prepare_upload``) so the job is addressable before the
document exists.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from app.process.ingestion import PdfConvertError, convert_pdf_bytes
from app.conductor.lifecycle import on_converted

__all__ = [
    "prepare_upload",
    "run_convert",
    "PdfConvertError",
]


def _pdf_path(doc_id: str) -> Path:
    return Path(os.environ.get("SHARED_DIR", "/shared")) / "ingest" / doc_id / "original.pdf"


def prepare_upload(data: bytes, filename: str) -> dict[str, Any]:
    """Mint a document id, stash the uploaded PDF on the shared volume, and return the
    ``docId`` + ``pdfPath`` for a ``convert`` job to pick up. The bytes live on disk (not in
    memory or the ledger row) so the conversion survives an app restart."""
    doc_id = str(uuid.uuid4())
    path = _pdf_path(doc_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {"docId": doc_id, "pdfPath": str(path), "filename": filename}


def run_convert(job: dict[str, Any], ctx) -> dict[str, Any] | None:
    """``convert`` job runner: read the stashed PDF, convert + persist, and patch a light
    result (no markdown — that lives in the documents collection) onto the ledger row."""
    doc_id = job["docId"]
    pdf_path = job.get("pdfPath")
    filename = job.get("filename") or "document.pdf"
    if not pdf_path or not Path(pdf_path).is_file():
        return {"error": "uploaded PDF not found on the shared volume"}
    data = Path(pdf_path).read_bytes()
    ctx.patch({"phase": "convert"})
    try:
        result = convert_pdf_bytes(data, filename, doc_id=doc_id)
    except PdfConvertError as e:
        ctx.patch({"statusCode": e.status_code})
        return {"error": str(e)}
    ctx.patch({
        "result": {
            "sourceFilename": result.source_filename,
            "outputFilename": result.output_filename,
            "pageCount": result.page_count,
            "docId": result.doc_id,
        }
    })
    # Lifecycle auto-chain: converted → extract, so an upload yields a studyable document
    # without a manual build. Enrichment stays on-demand. (No-op when LEARN_AUTOCHAIN=0.)
    on_converted(result.doc_id or doc_id)
    return None
