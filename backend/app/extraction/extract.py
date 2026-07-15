"""Section loading + scope resolution for extraction.

Historically this module ran the triple/proposition KG extraction; that pipeline was
removed with the concept-layer pivot (see docs/aposd-review-2026-07-09.md). What remains
is the shared infrastructure the concept pipeline and every study surface still use:

- scope resolution (``_scope_keys_from_outline`` / ``_blocks_in_scope`` /
  ``_load_section_blocks``): which ``section_content`` rows a TOC scope spans;
- structural ``has_subsection`` edges (``structural_subsection_triples`` +
  ``upsert_structural_edges``) that keep the TOC tree renderable.

Background extraction now runs on the persistent queue (pipeline/build.py) behind
``/api/extract`` — the old in-memory runner is retired.
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass

from app.content.sections import _clean_heading_markup
from app.content.scope import _blocks_in_scope, _scope_keys_from_outline, _section_level_fn
from app.content.toc_tree import get_toc_tree
from psycopg.types.json import Json

from app.platform.db import db

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

_UNION_DOCIDS = (
    " DO UPDATE SET doc_ids = (SELECT jsonb_agg(DISTINCT e) FROM jsonb_array_elements("
    "COALESCE({tbl}.doc_ids, '[]'::jsonb) || EXCLUDED.doc_ids) e)"
)


def upsert_entities(names: list[str], doc_id: str, batch: int = 1000) -> None:
    seen: set[str] = set()
    items: list[dict] = []
    for n in names:
        k = entity_key(n)
        if k in seen:
            continue
        seen.add(k)
        items.append({"key": k, "name": n})
    if not items:
        return
    doc_ids = Json([doc_id] if doc_id else [])
    with db() as conn:
        conn.cursor().executemany(
            "INSERT INTO entities (key, name, doc_ids) VALUES (%(key)s, %(name)s, %(doc_ids)s) "
            "ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name,"
            + _UNION_DOCIDS.format(tbl="entities").replace(" DO UPDATE SET doc_ids", " doc_ids"),
            [{"key": it["key"], "name": it["name"], "doc_ids": doc_ids} for it in items],
        )


def upsert_structural_edges(triples: list[ExtractedTriple], doc_id: str, batch: int = 1000) -> None:
    """has_subsection / section_mentions edges (docIds provenance only). Ensures endpoints exist."""
    names: set[str] = set()
    for t in triples:
        names.add(t.subject)
        names.add(t.object)
    if names:
        upsert_entities(list(names), doc_id, batch)
    seen: set[str] = set()
    edges: list[dict] = []
    for t in triples:
        fk, tk = entity_key(t.subject), entity_key(t.object)
        ek = edge_key(fk, t.predicate, tk)
        if ek in seen:
            continue
        seen.add(ek)
        edges.append({"key": ek, "from_key": f"entities/{fk}", "to_key": f"entities/{tk}", "type": t.predicate})
    if not edges:
        return
    doc_ids = Json([doc_id] if doc_id else [])
    with db() as conn:
        conn.cursor().executemany(
            "INSERT INTO relationships (key, from_key, to_key, type, doc_ids) "
            "VALUES (%(key)s, %(from_key)s, %(to_key)s, %(type)s, %(doc_ids)s) "
            "ON CONFLICT (key)" + _UNION_DOCIDS.format(tbl="relationships"),
            [{**e, "doc_ids": doc_ids} for e in edges],
        )


# --------------------------------------------------------------------------- #
# Scope resolution
# --------------------------------------------------------------------------- #

def _load_section_blocks(
    doc_id: str,
    section_keys: list[str] | None = None,
    scope: str | None = None,
    skipped_out: list[dict] | None = None,
) -> list[SectionExtractInput]:
    with db() as conn:
        rows = conn.execute(
            'SELECT section_key AS "sectionKey", "order", heading, level, markdown, '
            'page_start AS "pageStart", page_end AS "pageEnd" '
            'FROM section_content WHERE doc_id = %(d)s ORDER BY "order"',
            {"d": doc_id},
        ).fetchall()
    if scope:
        okeys = _scope_keys_from_outline(doc_id, scope)
        if okeys is not None:
            rows = [r for r in rows if r.get("sectionKey") in okeys]
        else:
            rows = _blocks_in_scope(rows, scope, _section_level_fn(doc_id))
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
