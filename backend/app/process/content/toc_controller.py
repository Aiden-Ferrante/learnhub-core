"""TOC controller — staged, logged resolution of a document's structure.

One entry point (``resolve_toc``) walks named stages and returns which route the
book took plus a human-readable decision log (persisted on the convert job's
ledger row), so any book's TOC weirdness is diagnosable without a debugger.

ROUTING TABLE (v1 — every path that exists today, named; zero behavior change):

  quality   route                    path
  -------   ---------------------    ----------------------------------------------
  present   bookmarks                canonicalize (build_outline_from_bookmarks)
                                     → reconcile (assign_blocks_to_outline matched
                                     ≥1 block; block_map OVERLAYS splitter keys)
  present   bookmarks-pagematched    reconcile matched 0 blocks (or canonicalize
                                     produced nothing) → normalize_outline: the
                                     REVERSE direction — outline entries re-keyed
                                     onto the blocks' own splitter keys by page;
                                     block_map is empty, blocks keep their keys
  absent    none                     derive strategies (headings, contents-page)
                                     are STUBS returning None → empty outline,
                                     loud decision log. This is today's silent
                                     no-bookmarks behavior, made explicit.

There is deliberately NO derived-llm route: conversion is a non-LLM job; LLM
repair belongs to a future queued job kind, never a synchronous stage here.

``block_map`` semantics: an OVERLAY. Apply only where present — a block absent
from the map keeps its splitter-assigned section_key. Never replace wholesale.

Pure — no DB, no LLM, no imports above content. Precondition: ``blocks`` arrive
page-annotated (persist_document assigns page_start/page_end before calling).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.process.content.outline import (
    assign_blocks_to_outline,
    build_outline_from_bookmarks,
    normalize_outline,
)
from app.process.content.sections import SectionBlock

# -- assess signals (v1 scoring is deliberately dumb: present|absent only). The
# clean/messy science gets these named slots when it lands: -------------------
# TODO_SIGNAL_ENTRY_RATIO: bookmark count vs page count (a 500-page book with 3
#   bookmarks is not a real TOC).
# TODO_SIGNAL_MONOTONIC_PAGES: bookmark pages should be non-decreasing.
# TODO_SIGNAL_JUNK_TITLE_RATIO: URLs/ISBNs/bare numbers as titles.
# TODO_SIGNAL_DEPTH_DISTRIBUTION: all-depth-1 outlines for nested books are messy.

QUALITY_PRESENT = "present"
QUALITY_ABSENT = "absent"

ROUTE_BOOKMARKS = "bookmarks"
ROUTE_PAGEMATCHED = "bookmarks-pagematched"
ROUTE_NONE = "none"


@dataclass
class TocResolution:
    """The controller's verdict: which route, what it produced, and why."""

    route: str                          # ROUTE_* above
    quality: str                        # QUALITY_* above
    outline_entries: list[dict]         # canonical entries store.py persists
    block_map: dict[int, str]           # block order -> sectionKey (OVERLAY; may be empty)
    decisions: list[str] = field(default_factory=list)  # one line per stage


# --------------------------------------------------------------------------- #
# Derive strategies — run only when bookmarks are absent. v1: stubs that return
# None, so the today-silent failure is loud and labeled instead of implicit.
# --------------------------------------------------------------------------- #

def derive_from_headings(blocks: list[SectionBlock], page_count: int) -> list[dict] | None:
    """Build an outline from the split blocks' own headings/levels/pages.
    Not implemented yet — first real derive strategy to build (blocks already
    carry heading, number_key, level, and page spans)."""
    return None


def derive_from_contents_page(blocks: list[SectionBlock], page_count: int) -> list[dict] | None:
    """Parse the book's printed Table of Contents. The printed TOC lives in the
    front-matter "Contents" BLOCK in raw_content (there is no pages table).
    Not implemented yet."""
    return None


_DERIVE_STRATEGIES = (
    ("derive-from-headings", derive_from_headings),
    ("derive-from-contents-page", derive_from_contents_page),
)


# --------------------------------------------------------------------------- #
# The control loop
# --------------------------------------------------------------------------- #

def resolve_toc(
    raw_outline: list[dict] | None,
    blocks: list[SectionBlock],
    page_count: int,
) -> TocResolution:
    """Resolve a document's TOC through the routing table above.

    Inputs are exactly what ``persist_document`` has in hand: the PDF bookmarks
    from the reader, the page-annotated split blocks, and the page count.
    """
    decisions: list[str] = []

    # stage: source — shape only. PDF-level bookmark cleanup is reader.py's job
    # (extract_pdf_outline); re-validating here would grow a second, drifting rule.
    raw = raw_outline or []
    decisions.append(f"source: {len(raw)} bookmark entries, {len(blocks)} content blocks")

    # stage: assess — v1 emits only what it actually knows.
    quality = QUALITY_PRESENT if raw else QUALITY_ABSENT
    decisions.append(f"assess: {quality}")

    # stage: derive — absent only. Every strategy is a stub; log each refusal.
    if quality == QUALITY_ABSENT:
        for name, strategy in _DERIVE_STRATEGIES:
            derived = strategy(blocks, page_count)
            if derived:
                # (unreachable in v1 — kept so the loop shape is real when a
                # strategy lands; a derived outline would flow into canonicalize)
                decisions.append(f"derive: {name} produced {len(derived)} entries")
                raw = derived
                break
            decisions.append(f"derive: {name} not implemented")
        else:
            decisions.append("route: none — no structure; blocks keep splitter keys")
            return TocResolution(ROUTE_NONE, quality, [], {}, decisions)

    # stage: canonicalize — one canonical TOC with unique nested keys.
    canonical = build_outline_from_bookmarks(raw)
    decisions.append(f"canonicalize: {len(canonical)} canonical entries")

    # stage: reconcile — map blocks onto the canonical outline; on total failure,
    # fall back to page-matching the outline onto the blocks (reverse direction).
    block_map = (
        assign_blocks_to_outline(canonical, [(b.order, b.heading, b.page_start) for b in blocks])
        if canonical
        else {}
    )
    if block_map:
        decisions.append(f"reconcile: {len(block_map)}/{len(blocks)} blocks matched")
        decisions.append(f"route: {ROUTE_BOOKMARKS}")
        return TocResolution(ROUTE_BOOKMARKS, quality, canonical, block_map, decisions)

    entries = normalize_outline(raw, blocks)
    decisions.append(
        "reconcile: 0 blocks matched — outline page-matched onto block keys "
        f"({len(entries)} entries; blocks keep splitter keys)"
    )
    decisions.append(f"route: {ROUTE_PAGEMATCHED}")
    return TocResolution(ROUTE_PAGEMATCHED, quality, entries, {}, decisions)
