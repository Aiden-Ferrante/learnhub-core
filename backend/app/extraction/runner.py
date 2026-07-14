"""In-memory background wrapper around concept extraction (behind ``/api/extract``).

Extraction is 15-20 min — never block the HTTP request. This is the LEGACY per-request
job slot (status polling for the upload/TOC-preview flows); durable, restart-surviving
jobs live in the platform jobs ledger (``platform/jobs.py``).
"""

from __future__ import annotations

import asyncio

from app.content.arango_content import fetch_latest_document
from app.extraction.concepts_extract import extract_concepts_document

_JOBS: dict[str, dict] = {}


def _job_key(doc_id: str, scope: str | None) -> str:
    return f"{doc_id}:{scope or 'ALL'}"


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


async def _run_job(
    key: str,
    doc_id: str,
    scope: str | None,
    concurrency: int,
    section_keys: list[str] | None,
    model: str | None = None,
) -> None:
    try:
        def on_progress(done: int, total: int, current: str | None) -> None:
            job = _JOBS.get(key)
            if job and job.get("status") == "running":
                job["progress"] = {"done": done, "total": total, "current": current}

        summary = await extract_concepts_document(
            doc_id=doc_id, section_keys=section_keys, scope=scope, concurrency=concurrency,
            model=model, on_progress=on_progress,
        )
        # Best-effort: refresh the semantic-search index so ask_textbook / semantic-search cover
        # the freshly-processed content. Never fail the extraction over indexing.
        try:
            import asyncio as _asyncio

            from app.platform.arango import connect_arango
            from app.search.semantic_search import ensure_index

            await _asyncio.to_thread(lambda: ensure_index(connect_arango(), doc_id))
        except Exception:  # noqa: BLE001
            pass
        _JOBS[key] = {"status": "done", "scope": scope, "docId": doc_id, "summary": summary}
    except Exception as exc:  # noqa: BLE001 — surface in status, never crash the loop
        _JOBS[key] = {"status": "error", "scope": scope, "docId": doc_id, "error": str(exc)}


def start_extraction(
    doc_id: str | None,
    scope: str | None,
    concurrency: int = 3,
    section_keys: list[str] | None = None,
    model: str | None = None,
) -> dict:
    """Kick off concept extraction as a background task and return immediately. Idempotent
    while a job for the same (doc, scope) slot is already running.

    ``section_keys`` extracts an exact set of sections (the TOC-preview selection); it is
    keyed under the ``scope`` slot, so the "Process documents" flow passes ``scope=None``
    (the per-document slot) while the syllabus tree uses ``scope=toc:N`` per chapter."""
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "error", "error": "no document found"}
    key = _job_key(doc_id, scope)
    current = _JOBS.get(key)
    if current and current.get("status") == "running":
        return {"status": "running", "scope": scope, "docId": doc_id, "alreadyRunning": True}
    _JOBS[key] = {"status": "running", "scope": scope, "docId": doc_id}
    asyncio.create_task(_run_job(key, doc_id, scope, concurrency, section_keys, model))
    return {"status": "running", "scope": scope, "docId": doc_id}


def extraction_status(doc_id: str | None, scope: str | None) -> dict:
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "idle", "scope": scope}
    return _JOBS.get(_job_key(doc_id, scope), {"status": "idle", "scope": scope, "docId": doc_id})
