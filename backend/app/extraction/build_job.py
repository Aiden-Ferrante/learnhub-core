"""The "build" job runner: concept extraction (skipped when present) + deep overlay.

Runs inside the platform jobs worker; registered by api/wiring.py. Ledger writes go
through the JobCtx — extraction outcomes are patched onto the job row so the Process
dashboard can show WHY sections produced 0 concepts.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.content.arango_content import fetch_section_content
from app.extraction.concept_store import concept_count
from app.extraction.concepts_extract import extract_concepts_document
from app.extraction.deep_chapter import generate_deep_chapter_artifacts


def run_build(db, job: dict[str, Any], ctx) -> dict[str, Any] | None:
    doc_id, scope = job["docId"], job["scope"]
    content = fetch_section_content(scope, doc_id)
    section_keys = sorted(
        {b.get("sectionKey") for b in content.get("blocks", []) if b.get("sectionKey")}
    )
    if not section_keys:
        return {"error": "no readable content in this scope"}

    if concept_count(db, doc_id, list(section_keys)) > 0:
        # Already extracted — go straight to the deep overlay (briefing + explanations).
        ctx.check_cancel()
        ctx.patch({"phase": "deep", "done": 0, "total": 0})
        generate_deep_chapter_artifacts(db, doc_id, scope, list(section_keys))
        ctx.patch({"outcomes": None})
        return None

    # Extraction; its eager hook generates the deep overlay in the same pass.
    ctx.phase = "extract"
    res = asyncio.run(
        extract_concepts_document(doc_id=doc_id, scope=scope, on_progress=ctx.progress)
    )
    if res.get("error"):
        return {"error": str(res["error"])}
    # Persist the per-section extraction report on the job so the Process
    # dashboard can show WHY sections produced 0 concepts (capped for sanity).
    ctx.patch({
        "outcomes": (res.get("outcomes") or [])[:200],
        "concepts": res.get("concepts"),
        "prereqEdges": res.get("prereqEdges"),
    })
    return None
