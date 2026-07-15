"""Section loading + scope resolution for extraction.

Historically this module ran the triple/proposition KG extraction; that pipeline was
removed with the concept-layer pivot (see docs/aposd-review-2026-07-09.md). What remains
is the shared infrastructure the concept pipeline and every study surface still use:
scope resolution (``_scope_keys_from_outline`` / ``_blocks_in_scope`` /
``_load_section_blocks``) — which ``section_content`` rows a TOC scope spans — plus the
prompt/domain helpers.

Background extraction now runs on the persistent queue (pipeline/build.py) behind
``/api/extract`` — the old in-memory runner is retired.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from app.content.sections import _clean_heading_markup
from app.content.scope import _blocks_in_scope, _scope_keys_from_outline, _section_level_fn
from app.platform.db import db

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


def section_body_len(markdown: str) -> int:
    """Length of a section block's body (markdown minus its leading heading line)."""
    parts = (markdown or "").split("\n", 1)
    return len(parts[1].strip()) if len(parts) > 1 else 0


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
