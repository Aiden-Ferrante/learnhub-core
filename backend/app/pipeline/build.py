"""Job runners for the extraction phase: core ``extract`` + ``deep`` enrichment.

Runs inside the platform jobs worker; registered by pipeline/registry.py. Ledger writes go
through the JobCtx — extraction outcomes are patched onto the job row so the Process
dashboard can show WHY sections produced 0 concepts.

The phases are separable job kinds:
  - ``extract``: core concept extraction only (no overlay).
  - ``deep``:    the Deep Chapter enrichment overlay for an already-extracted scope.
  - ``build``:   compatibility — ``extract`` then ``deep``, the pre-split behavior.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.content.store import fetch_section_content
from app.extraction.concept_store import concept_count
from app.extraction.concepts_extract import extract_concepts_document
from app.extraction.deep_chapter import generate_deep_chapter_artifacts


def _scope_keys(db, doc_id: str, scope: str) -> list[str] | None:
    """The section keys this scope spans, or None if the scope has no readable content."""
    content = fetch_section_content(scope, doc_id)
    keys = sorted({b.get("sectionKey") for b in content.get("blocks", []) if b.get("sectionKey")})
    return keys or None


def run_extract(db, job: dict[str, Any], ctx) -> dict[str, Any] | None:
    """Core concept extraction for a scope — no overlay. Idempotent: skips if the scope
    already has concepts (re-extraction is an explicit re-run of a fresh job)."""
    doc_id, scope = job["docId"], job["scope"]
    section_keys = _scope_keys(db, doc_id, scope)
    if not section_keys:
        return {"error": "no readable content in this scope"}
    if concept_count(db, doc_id, section_keys) > 0:
        ctx.patch({"outcomes": None})
        return None
    ctx.phase = "extract"
    res = asyncio.run(
        extract_concepts_document(doc_id=doc_id, scope=scope, on_progress=ctx.progress, generate_deep=False)
    )
    if res.get("error"):
        return {"error": str(res["error"])}
    # Persist the per-section extraction report so the Process dashboard can show WHY
    # sections produced 0 concepts (capped for sanity).
    ctx.patch({
        "outcomes": (res.get("outcomes") or [])[:200],
        "concepts": res.get("concepts"),
    })
    return None


def run_deep(db, job: dict[str, Any], ctx) -> dict[str, Any] | None:
    """Deep Chapter enrichment overlay (briefing + per-section recaps + per-concept deep
    explanations) for a scope. Assumes concepts already exist; idempotent."""
    doc_id, scope = job["docId"], job["scope"]
    section_keys = _scope_keys(db, doc_id, scope)
    if not section_keys:
        return {"error": "no readable content in this scope"}
    ctx.check_cancel()
    ctx.patch({"phase": "deep", "done": 0, "total": 0})
    generate_deep_chapter_artifacts(db, doc_id, scope, section_keys)
    return None


def run_build(db, job: dict[str, Any], ctx) -> dict[str, Any] | None:
    """Compatibility runner (pre-split behavior): core extraction then the deep overlay."""
    err = run_extract(db, job, ctx)
    if err:
        return err
    return run_deep(db, job, ctx)
