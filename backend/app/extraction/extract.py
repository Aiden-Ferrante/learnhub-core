"""Section loading + scope resolution for extraction, and the extraction job runner.

Historically this module ran the triple/proposition KG extraction; that pipeline was
removed with the concept-layer pivot (see docs/aposd-review-2026-07-09.md). What remains
is the shared infrastructure the concept pipeline and every study surface still use:

- scope resolution (``_scope_keys_from_outline`` / ``_blocks_in_scope`` /
  ``_load_section_blocks``): which ``section_content`` rows a TOC scope spans;
- structural ``has_subsection`` edges (``structural_subsection_triples`` +
  ``upsert_structural_edges``) that keep the TOC tree renderable;
- the in-memory background-job wrapper around ``concepts_extract`` (``start_extraction``
  / ``extraction_status``) behind ``/api/extract``.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
from dataclasses import dataclass

from app.content.arango_content import _clean_heading_markup, fetch_latest_document
from app.content.scope import _blocks_in_scope, _scope_keys_from_outline, _section_level_fn
from app.content.arango_tree import get_toc_tree
from app.platform.arango import connect_arango

ENTITIES = "entities"
RELATIONSHIPS = "relationships"

HAS_SUBSECTION = "has_subsection"
TOC_ROOT = "toc:root"

_NUMERIC = re.compile(r"^\d+(?:\.\d+)*$")
_MIN_SECTION_BODY_CHARS = 80  # skip heading-only / structural blocks with no real content
# Front-matter noise that the splitter mis-detects as a heading (copyright URLs, ISBNs).
_JUNK_HEADING = re.compile(r"(https?://|www\.|isbn|cambridge\.org|\b\d{9,}\b)", re.IGNORECASE)

_DEFAULT_DOMAIN = "a mathematics / causal-inference textbook"

# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class SectionExtractInput:
    doc_id: str
    section_key: str
    heading: str
    page_start: int | None
    page_end: int | None
    markdown: str


@dataclass(frozen=True)
class ExtractedTriple:
    subject: str
    predicate: str
    object: str


# --------------------------------------------------------------------------- #
# Pure functions (unit-testable; no LLM, no DB)
# --------------------------------------------------------------------------- #

def _domain() -> str:
    return os.environ.get("LEARN_EXTRACT_DOMAIN") or _DEFAULT_DOMAIN


def build_user_prompt(inp: SectionExtractInput) -> str:
    if inp.page_start is None:
        pages = ""
    elif inp.page_end and inp.page_end != inp.page_start:
        pages = f", pages {inp.page_start}-{inp.page_end}"
    else:
        pages = f", page {inp.page_start}"
    return (
        f"Section: {inp.heading}  ({inp.section_key}{pages})\n\n"
        f"<section_markdown>\n{inp.markdown}\n</section_markdown>"
    )


def normalize_entity(name: object) -> str:
    return _clean_heading_markup(str(name or "")).strip()


def _norm_part(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def structural_subsection_triples(section_keys: list[str]) -> list[ExtractedTriple]:
    """Numeric-prefix ``has_subsection`` chain (toc:root→toc:1→toc:1.2→…), deduped.

    Mirrors the frontend ``numberPrefixChainTriples`` so ``get_toc_tree`` still renders.
    """
    seen: set[tuple[str, str]] = set()
    out: list[ExtractedTriple] = []
    for key in section_keys:
        if not key.startswith("toc:"):
            continue
        body = key[4:]
        if not _NUMERIC.match(body):
            continue
        parts = body.split(".")
        prev = TOC_ROOT
        for i in range(len(parts)):
            cur = "toc:" + ".".join(parts[: i + 1])
            pair = (prev, cur)
            if prev != cur and pair not in seen:
                seen.add(pair)
                out.append(ExtractedTriple(subject=prev, predicate=HAS_SUBSECTION, object=cur))
            prev = cur
    return out


def section_body_len(markdown: str) -> int:
    """Length of a section block's body (markdown minus its leading heading line)."""
    parts = (markdown or "").split("\n", 1)
    return len(parts[1].strip()) if len(parts) > 1 else 0


# --------------------------------------------------------------------------- #
# Deterministic keys (historical contract of the KG collections)
# --------------------------------------------------------------------------- #

def entity_key(name: str) -> str:
    return hashlib.md5(name.lower().strip().encode()).hexdigest()[:16]


def edge_key(from_key: str, predicate: str, to_key: str) -> str:
    return hashlib.md5(f"{from_key}|{predicate.lower().strip()}|{to_key}".encode()).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# ArangoDB structural-edge writes (python-arango UPSERT)
# --------------------------------------------------------------------------- #

def ensure_kg_collections(db) -> None:
    if not db.has_collection(ENTITIES):
        db.create_collection(ENTITIES)
    if not db.has_collection(RELATIONSHIPS):
        db.create_collection(RELATIONSHIPS, edge=True)


def upsert_entities(db, names: list[str], doc_id: str, batch: int = 1000) -> None:
    seen: set[str] = set()
    items: list[dict] = []
    for n in names:
        k = entity_key(n)
        if k in seen:
            continue
        seen.add(k)
        items.append({"_key": k, "name": n})
    doc_ids = [doc_id] if doc_id else []
    for i in range(0, len(items), batch):
        db.aql.execute(
            """
            FOR item IN @batch
              UPSERT { _key: item._key }
              INSERT MERGE(item, { docIds: @docIds })
              UPDATE { docIds: UNION_DISTINCT(NOT_NULL(OLD.docIds, []), @docIds) }
              IN entities
            """,
            bind_vars={"batch": items[i : i + batch], "docIds": doc_ids},
        )


def upsert_structural_edges(db, triples: list[ExtractedTriple], doc_id: str, batch: int = 1000) -> None:
    """has_subsection / section_mentions edges (docIds provenance only). Ensures endpoints exist."""
    names: set[str] = set()
    for t in triples:
        names.add(t.subject)
        names.add(t.object)
    if names:
        upsert_entities(db, list(names), doc_id, batch)
    seen: set[str] = set()
    edges: list[dict] = []
    for t in triples:
        fk, tk = entity_key(t.subject), entity_key(t.object)
        ek = edge_key(fk, t.predicate, tk)
        if ek in seen:
            continue
        seen.add(ek)
        edges.append({"_key": ek, "_from": f"entities/{fk}", "_to": f"entities/{tk}", "type": t.predicate})
    doc_ids = [doc_id] if doc_id else []
    for i in range(0, len(edges), batch):
        db.aql.execute(
            """
            FOR item IN @batch
              UPSERT { _key: item._key }
              INSERT MERGE(item, { docIds: @docIds })
              UPDATE { docIds: UNION_DISTINCT(NOT_NULL(OLD.docIds, []), @docIds) }
              IN relationships
            """,
            bind_vars={"batch": edges[i : i + batch], "docIds": doc_ids},
        )


# --------------------------------------------------------------------------- #
# Scope resolution
# --------------------------------------------------------------------------- #

def _load_section_blocks(
    db,
    doc_id: str,
    section_keys: list[str] | None = None,
    scope: str | None = None,
    skipped_out: list[dict] | None = None,
) -> list[SectionExtractInput]:
    rows = list(
        db.aql.execute(
            "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
            bind_vars={"d": doc_id},
        )
    )
    if scope:
        okeys = _scope_keys_from_outline(db, doc_id, scope)
        if okeys is not None:
            rows = [r for r in rows if r.get("sectionKey") in okeys]
        else:
            rows = _blocks_in_scope(rows, scope, _section_level_fn(db, doc_id))
    wanted = set(section_keys) if section_keys else None
    out: list[SectionExtractInput] = []
    for r in rows:
        sk = r.get("sectionKey")
        if wanted is not None and sk not in wanted:
            continue
        md = r.get("markdown") or ""
        if section_body_len(md) < _MIN_SECTION_BODY_CHARS:
            if skipped_out is not None:
                skipped_out.append({"sectionKey": sk, "heading": r.get("heading") or sk, "reason": "too-short"})
            continue
        if _JUNK_HEADING.search(r.get("heading") or ""):
            if skipped_out is not None:
                skipped_out.append({"sectionKey": sk, "heading": r.get("heading") or sk, "reason": "junk-heading"})
            continue
        out.append(
            SectionExtractInput(
                doc_id=doc_id,
                section_key=sk,
                heading=r.get("heading") or sk,
                page_start=r.get("pageStart"),
                page_end=r.get("pageEnd"),
                markdown=md,
            )
        )
    return out


def _extract_model() -> str | None:
    """Optional extraction-specific model (``LEARN_EXTRACT_MODEL``); else the default
    ``OLLAMA_MODEL`` is used. Lets the batch pick a faster/better model than the Socratic one."""
    return os.environ.get("LEARN_EXTRACT_MODEL") or None


# --------------------------------------------------------------------------- #
# Background jobs (extraction is 15-20 min — never block the HTTP request)
# --------------------------------------------------------------------------- #

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
        # Concept-course extraction is the product now (lazy import avoids a cycle).
        from app.extraction.concepts_extract import extract_concepts_document

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
