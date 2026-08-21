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

import hashlib
import os
import uuid
from pathlib import Path
from typing import Any

from app.process.ingestion import (
    PdfConvertError,
    convert_markdown_bytes,
    convert_pdf_bytes,
    is_markdown_filename,
)
from app.process.content import create_stub, mark_document_status
from app.conductor.lifecycle import on_converted

__all__ = [
    "prepare_upload",
    "run_convert",
    "PdfConvertError",
]


def _source_path(doc_id: str, filename: str | None = None) -> Path:
    """Where the uploaded file is stashed. The name keeps the source's own extension, so
    the convert job can pick its converter from the file it finds — one job kind,
    ``convert``, for every format. ``original.pdf`` stays the PDF name because
    ``/api/document/pdf`` and ``figure_path()`` both resolve to it by that literal name."""
    base = "original.md" if is_markdown_filename(filename) else "original.pdf"
    return Path(os.environ.get("SHARED_DIR", "/shared")) / "ingest" / doc_id / base


def prepare_upload(data: bytes, filename: str) -> dict[str, Any]:
    """Mint a document id, insert its stub identity row (status='converting') so the convert
    job and any content FK against it, stash the source on the shared volume, and return the
    ``docId`` + ``pdfPath``. Stub-before-enqueue is what the FKs require; it also makes a
    re-upload detectable mid-conversion. The bytes live on disk (not in memory or the ledger
    row) so the conversion survives an app restart.

    ``pdfPath`` keeps its name for compatibility with queued jobs and the ledger's existing
    payload shape; it is the path to the stashed source whatever its format."""
    doc_id = str(uuid.uuid4())
    source_hash = hashlib.sha256(data).hexdigest()
    title = filename.rsplit(".", 1)[0] if filename else "document"
    create_stub(doc_id, title, source_hash)
    path = _source_path(doc_id, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {"docId": doc_id, "pdfPath": str(path), "filename": filename}


def run_convert(job: dict[str, Any], ctx) -> dict[str, Any] | None:
    """``convert`` job runner: read the stashed source, convert + persist, and patch a light
    result (no markdown — that lives in the documents collection) onto the ledger row.

    One job kind covers both formats. The converter is chosen from the source filename
    rather than from a payload flag, so a job queued before this existed still runs: an
    unrecognized extension is a PDF, which is what every such job is."""
    doc_id = job["docId"]
    pdf_path = job.get("pdfPath")
    filename = job.get("filename") or "document.pdf"
    if not pdf_path or not Path(pdf_path).is_file():
        return {"error": "uploaded file not found on the shared volume"}
    data = Path(pdf_path).read_bytes()
    ctx.patch({"phase": "convert"})
    convert = convert_markdown_bytes if is_markdown_filename(filename) else convert_pdf_bytes
    try:
        result = convert(data, filename, doc_id=doc_id)
    except PdfConvertError as e:
        ctx.patch({"statusCode": e.status_code})
        mark_document_status(doc_id, "error", e.status_code)
        return {"error": str(e)}
    ctx.patch({
        "result": {
            "sourceFilename": result.source_filename,
            "outputFilename": result.output_filename,
            "pageCount": result.page_count,
            "docId": result.doc_id,
        },
        # The TOC controller's verdict — which route the book's structure took and why.
        # Schemaless jsonb payload fields: diagnosable from the ledger, no schema change.
        "tocRoute": result.toc_route,
        "tocDecisions": result.toc_decisions or [],
    })
    # Lifecycle hook: by default a no-op — the book is readable once converted, and
    # concepts are extracted on demand per chapter from the TOC. (LEARN_AUTOCHAIN=1
    # re-enables the old convert→extract-everything chain for bulk ingests.)
    on_converted(result.doc_id or doc_id)
    return None
