"""Scope resolution — which sections a TOC scope spans, and their contentful blocks.

The ONE answer to "what's inside chapter X": outline nesting first (bridges mixed
keyspaces — a numbered chapter whose sub-sections carry slug keys), then the
reading-order span. The public surface is three functions — ``scope_blocks`` (the
rows), ``scope_section_keys`` (just the keys), ``load_section_blocks`` (extraction-
ready blocks with the junk/short filters) — and every consumer (reader, extraction,
study scoping, coverage) goes through them, so no two surfaces can disagree about a
chapter's extent. The underscore helpers are implementation detail; do not import
them outside this package.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.process.content.blocks import fetch_blocks

_NUMERIC = re.compile(r"^\d+(?:\.\d+)*$")
_CHAPTER_HEADING = re.compile(r"(?i)^\s*chapter\s+\d+\b")


def is_ancestor_section_key(ancestor: str, child: str) -> bool:
    """True when ``ancestor`` is the same section or a numeric parent of ``child``."""
    if ancestor == child:
        return True
    a = ancestor[4:] if ancestor.startswith("toc:") else ancestor
    c = child[4:] if child.startswith("toc:") else child
    return bool(_NUMERIC.match(a) and _NUMERIC.match(c)) and (c == a or c.startswith(f"{a}."))


def _is_chapter_marker(sk: str, heading: str) -> bool:
    return sk.startswith("toc:chapter-") or bool(_CHAPTER_HEADING.match(heading or ""))


def _section_level_fn(doc_id: str):
    """Build ``level_of(sectionKey, heading)`` — a 1-based outline level where chapters are
    level 1: numeric keys ``toc:1.2`` → numeric depth; ``toc:chapter-*`` keys or "CHAPTER N"
    headings → level 1; any other slug → a deep leaf level. (A TOC-tree-depth fallback used
    to sit between the last two, but its lookup had never worked — the system's observed
    behavior IS this rule, now stated honestly. ``doc_id`` is kept for signature stability.)"""
    del doc_id  # no longer consulted; see docstring

    def level_of(sk: str, heading: str = "") -> int:
        body = sk[4:] if sk.startswith("toc:") else sk
        if _NUMERIC.match(body):
            return body.count(".") + 1
        if _is_chapter_marker(sk, heading):
            return 1
        return 99

    return level_of


def _blocks_in_scope(rows: list[dict], scope: str, level_of=None) -> list[dict]:
    """All section_content rows under a chapter/section ``scope``, by reading-order span:
    from the scope's first block to the next block at the SAME-OR-SHALLOWER outline level.

    Captures the scope's subsections AND interspersed slug blocks (theorems, definitions,
    untitled prose) that a pure numeric-descendant match would miss — and works for books
    keyed by chapter slugs, not just ``toc:1.2`` numbering.
    """
    ordered = sorted(rows, key=lambda r: r.get("order", 0))
    start_idx = next(
        (i for i, r in enumerate(ordered) if is_ancestor_section_key(scope, r.get("sectionKey", ""))),
        None,
    )
    if start_idx is None:
        return []
    if level_of is None:
        level_of = lambda sk, h="": (sk[4:].count(".") + 1) if (sk.startswith("toc:") and _NUMERIC.match(sk[4:])) else 99  # noqa: E731
    scope_lvl = level_of(scope, ordered[start_idx].get("heading", ""))
    # A block sitting right after a chapter marker is the chapter title → treat it as a chapter.
    if start_idx > 0:
        prev = ordered[start_idx - 1]
        if _is_chapter_marker(prev.get("sectionKey", ""), prev.get("heading", "")):
            scope_lvl = min(scope_lvl, 1)
    end_idx = len(ordered)
    for j in range(start_idx + 1, len(ordered)):
        r = ordered[j]
        sk = r.get("sectionKey", "")
        if sk == scope or is_ancestor_section_key(scope, sk):
            continue
        if level_of(sk, r.get("heading", "")) <= scope_lvl:
            end_idx = j
            break
    return ordered[start_idx:end_idx]


def _scope_keys_from_outline(doc_id: str, scope: str) -> set[str] | None:
    """Section keys under ``scope`` via the outline's ``listDepth`` nesting — ``scope`` plus
    everything nested beneath it until a same-or-shallower (sibling) entry. Key-scheme-agnostic:
    works when a numbered chapter (``toc:2``) contains slug sub-sections (``toc:modeling``) that
    aren't numeric descendants of the chapter. Returns None if ``scope`` isn't an outline entry
    (caller falls back to the reading-order span)."""
    from app.process.content.documents import fetch_structure_entries

    outline = fetch_structure_entries(doc_id)
    if not outline:
        return None
    idx = next((i for i, e in enumerate(outline) if e.get("sectionKey") == scope), None)
    if idx is None:
        return None
    base = int(outline[idx].get("listDepth") or 0)
    keys = {scope}
    for e in outline[idx + 1 :]:
        if int(e.get("listDepth") or 0) <= base:
            break
        if e.get("sectionKey"):
            keys.add(e["sectionKey"])
    return keys


def _fetch_scope_rows(doc_id: str) -> list[dict]:
    return fetch_blocks(doc_id)


def scope_blocks(doc_id: str, scope: str, rows: list[dict] | None = None) -> list[dict]:
    """A scope's ``section_content`` rows: outline-first, reading-order-span fallback.

    ``rows`` lets batch callers (coverage, chapters) load the doc's rows ONCE and span
    many scopes over them; rows may carry extra columns (markdown, pages) — they pass
    through untouched. ``rows=None`` fetches the minimal columns."""
    if rows is None:
        rows = _fetch_scope_rows(doc_id)
    okeys = _scope_keys_from_outline(doc_id, scope)
    if okeys:
        matched = [r for r in rows if r.get("sectionKey") in okeys]
        if matched:
            return matched
    return _blocks_in_scope(rows, scope, _section_level_fn(doc_id))


def scope_section_keys(doc: str | None, scope: str | None) -> set[str] | None:
    """The set of section keys a chapter scope spans (chapter → all its sub-sections),
    resolved the same way as the reader. None = whole course (no filter)."""
    if not scope:
        return None
    if not doc:
        return {scope}
    try:
        keys = {b.get("sectionKey") for b in scope_blocks(doc, scope) if b.get("sectionKey")}
        return keys or {scope}
    except Exception:  # noqa: BLE001
        return {scope}


# ---------------------------------------------------------------------------- #
# Extraction-ready loading (moved from extraction/extract.py — content is the
# lowest layer that may own it; media, study, and extraction all consume it)
# ---------------------------------------------------------------------------- #

_MIN_SECTION_BODY_CHARS = 80  # skip heading-only / structural blocks with no real content
# Front-matter noise that the splitter mis-detects as a heading (copyright URLs, ISBNs).
_JUNK_HEADING = re.compile(r"(https?://|www\.|isbn|cambridge\.org|\b\d{9,}\b)", re.IGNORECASE)


@dataclass(frozen=True)
class SectionExtractInput:
    doc_id: str
    section_key: str
    # Where this block sits in the BOOK. Extraction writes concepts against the book, so a
    # custom version's chapter enriches the source everything else inherits from — rather
    # than minting concepts only that one version can see. Equal to section_key on a
    # Default version.
    source_section_key: str
    heading: str
    page_start: int | None
    page_end: int | None
    markdown: str


def section_body_len(markdown: str) -> int:
    """Length of a section block's body (markdown minus its leading heading line)."""
    parts = (markdown or "").split("\n", 1)
    return len(parts[1].strip()) if len(parts) > 1 else 0


def load_section_blocks(
    doc_id: str,
    section_keys: list[str] | None = None,
    scope: str | None = None,
    skipped_out: list[dict] | None = None,
) -> list[SectionExtractInput]:
    """A scope's blocks WITH their markdown, filtered to what's worth processing
    (drops heading-only stubs and front-matter junk, recording why into ``skipped_out``)."""
    rows = fetch_blocks(doc_id, markdown=True)
    if scope:
        rows = scope_blocks(doc_id, scope, rows=rows)
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
                source_section_key=r.get("sourceSectionKey") or sk,
                heading=r.get("heading") or sk,
                page_start=r.get("pageStart"),
                page_end=r.get("pageEnd"),
                markdown=md,
            )
        )
    return out
