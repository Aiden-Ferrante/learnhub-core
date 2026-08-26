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

from app.gateways import JobCancelled
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
        # ⚠ Mark before returning. This exit used to leave the stub row at `converting`
        # forever: a document permanently mid-flight, invisible to the shelf (which lists
        # `ready` only), visible in the Process tab, and still holding its content hash so
        # re-uploading the same book deduped onto the corpse. Two such rows were sitting in
        # the dev library, from 2026-07-22 and 2026-08-22 (finding C2).
        mark_document_status(doc_id, "error", 404)
        return {"error": "uploaded file not found on the shared volume"}
    data = Path(pdf_path).read_bytes()
    # Cancellation checkpoints. ⚠ These bracket the engine rather than interrupting it:
    # convert_document() is a single opaque call into docling with no page loop to hook,
    # so a conversion already inside the engine runs to completion. Interrupting mid-flight
    # would mean hosting the engine in a killable subprocess — a much larger change.
    #
    # What these two do buy, and it is most of the value: a job cancelled while queued or
    # in the window before the engine starts stops immediately, and a job cancelled DURING
    # a long conversion does not then persist a document nobody wants. Before this, the
    # convert runner never called check_cancel at all — only ctx.progress() reaches it, and
    # convert has no per-item loop to report progress against, so `cancel` on a convert set
    # a flag that nothing ever read.
    # Every exit from here on marks the document, including the two that are not failures
    # of the converter: a cancel, and an exception nobody anticipated. A document left at
    # `converting` is the worst of the three outcomes because nothing ever revisits it —
    # there is no timeout, and the next restart requeues the job rather than settling the row.
    try:
        ctx.check_cancel()
        ctx.patch({"phase": "convert"})
        convert = convert_markdown_bytes if is_markdown_filename(filename) else convert_pdf_bytes
        result = convert(data, filename, doc_id=doc_id)
    except PdfConvertError as e:
        ctx.patch({"statusCode": e.status_code})
        mark_document_status(doc_id, "error", e.status_code)
        return {"error": str(e)}
    except JobCancelled:
        # Cancelled BEFORE the engine ran, so there is nothing to keep. The stub is marked
        # error rather than deleted: the row is what the Process tab shows you, and a book
        # that vanishes on cancel is harder to reason about than one that says it stopped.
        mark_document_status(doc_id, "error", 499)
        raise
    except Exception:
        mark_document_status(doc_id, "error", 500)
        raise
    # Raises JobCancelled, which the worker turns into status=canceled — so the expensive
    # engine output is discarded rather than written. The pages are already spent; the
    # point is that the library does not gain a book the user asked to abandon.
    try:
        ctx.check_cancel()
    except JobCancelled:
        mark_document_status(doc_id, "error", 499)
        raise
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
