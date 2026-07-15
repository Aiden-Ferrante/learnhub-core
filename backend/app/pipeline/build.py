"""Job runner for concept extraction.

Runs inside the platform jobs worker; registered by pipeline/registry.py. Ledger writes go
through the JobCtx — extraction outcomes are patched onto the job row so the Process
dashboard can show WHY sections produced 0 concepts.

``build`` is a compatibility alias for ``extract`` (clients still enqueue it): the deep
per-concept-explanation overlay was retired, so extraction is the whole build.

Extraction inputs may ride on the job row as a payload: ``sectionKeys`` (an exact set,
the TOC-preview selection), ``model`` (override), and ``force`` (re-extract even when the
scope already has concepts). This is how ``/api/extract`` reaches the queue.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.content.store import fetch_section_content
from app.extraction.concept_store import concept_count
from app.extraction.concepts_extract import extract_concepts_document


def _scope_keys(doc_id: str, scope: str) -> list[str] | None:
    """The section keys this scope spans, or None if the scope has no readable content."""
    content = fetch_section_content(scope, doc_id)
    keys = sorted({b.get("sectionKey") for b in content.get("blocks", []) if b.get("sectionKey")})
    return keys or None



def run_extract(db, job: dict[str, Any], ctx) -> dict[str, Any] | None:
    """Core concept extraction — no overlay. ``sectionKeys``/``model`` come from the job
    payload. Idempotent: skips a whole scope that already has concepts unless ``force`` is
    set (or an exact ``sectionKeys`` set is requested). Refreshes the semantic index after."""
    doc_id, scope = job["docId"], (job.get("scope") or None)
    section_keys = job.get("sectionKeys")
    model = job.get("model")
    force = bool(job.get("force"))
    if scope and not section_keys:
        keys = _scope_keys(doc_id, scope)
        if not keys:
            return {"error": "no readable content in this scope"}
        if not force and concept_count(doc_id, keys) > 0:
            ctx.patch({"outcomes": None})
            return None
    ctx.phase = "extract"
    res = asyncio.run(
        extract_concepts_document(
            doc_id=doc_id, scope=scope, section_keys=section_keys, model=model,
            on_progress=ctx.progress,
        )
    )
    if res.get("error"):
        return {"error": str(res["error"])}
    # Persist the per-section report + a summary the /api/extract/status poller reads.
    ctx.patch({
        "outcomes": (res.get("outcomes") or [])[:200],
        "concepts": res.get("concepts"),
        "summary": {k: res.get(k) for k in ("sections", "extracted", "concepts", "seconds", "errors")},
    })
    # Best-effort: keep semantic search current with the freshly-extracted content.
    try:
        from app.search.semantic_search import ensure_index

        ensure_index(doc_id)
    except Exception:  # noqa: BLE001 — indexing must never fail the extraction
        pass
    # Quality gate: critic-grade a sample of what was just written and put the score on
    # the ledger row next to outcomes — extraction quality as a regression number.
    try:
        from app.extraction.eval_gate import eval_enabled, evaluate_extraction_sample

        if eval_enabled():
            ctx.patch({"phase": "eval"})
            eval_keys = section_keys or (_scope_keys(doc_id, scope) if scope else None)
            report = evaluate_extraction_sample(doc_id, eval_keys)
            ctx.patch({"phase": None, **({"eval": report} if report else {})})
    except Exception:  # noqa: BLE001 — the eval must never fail the extraction
        pass
    return None

