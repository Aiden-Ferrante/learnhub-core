"""Job runner for concept extraction.

Runs inside the platform jobs worker; registered by conductor/registry.py. Ledger writes go
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

from app.process.content import fetch_section_content
from app.process.extraction import concept_count
from app.process.extraction import extract_concepts_document


def _scope_keys(doc_id: str, scope: str) -> list[str] | None:
    """The section keys this scope spans, or None if the scope has no readable content."""
    content = fetch_section_content(scope, doc_id)
    keys = sorted({b.get("sectionKey") for b in content.get("blocks", []) if b.get("sectionKey")})
    return keys or None



def run_extract(job: dict[str, Any], ctx) -> dict[str, Any] | None:
    """Core concept extraction — no overlay. ``sectionKeys``/``model`` come from the job
    payload. Idempotent: skips a whole scope that already has concepts unless ``force`` is
    set (or an exact ``sectionKeys`` set is requested)."""
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
    # An extraction where EVERY section failed is a failed extraction, whatever the absence
    # of a top-level error says. `extract_concepts_document` reports per-section outcomes and
    # only sets `error` when the run itself could not start, so a chapter whose every section
    # timed out or came back ungrounded landed here as a clean `done` with zero concepts —
    # indistinguishable, on every surface above, from a chapter that genuinely teaches
    # nothing (finding C3).
    sections = res.get("sections") or 0
    errors = res.get("errors") or 0
    if sections and errors >= sections:
        ctx.patch({
            "outcomes": (res.get("outcomes") or [])[:200],
            "summary": {k: res.get(k) for k in
                        ("sections", "extracted", "concepts", "seconds", "errors")},
        })
        return {"error": f"every section failed ({errors}/{sections})"}
    # Persist the per-section report + a summary the /api/extract/status poller reads.
    ctx.patch({
        "outcomes": (res.get("outcomes") or [])[:200],
        "concepts": res.get("concepts"),
        "summary": {k: res.get(k) for k in ("sections", "extracted", "concepts", "seconds", "errors")},
    })
    # Quality gate: critic-grade a sample of what was just written and put the score on
    # the ledger row next to outcomes — extraction quality as a regression number.
    try:
        from app.process.extraction import eval_enabled, evaluate_extraction_sample

        if eval_enabled():
            ctx.patch({"phase": "eval"})
            eval_keys = section_keys or (_scope_keys(doc_id, scope) if scope else None)
            report = evaluate_extraction_sample(doc_id, eval_keys)
            ctx.patch({"phase": None, **({"eval": report} if report else {})})
    except Exception:  # noqa: BLE001 — the eval must never fail the extraction
        pass
    return None

