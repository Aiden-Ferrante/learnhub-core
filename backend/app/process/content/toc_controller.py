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
  absent    derived-headings         toc_strategies/from_headings: font-size
                                     clustering over the heading pages (chapter
                                     titles are set bigger), text fallback from
                                     numbered/markdown levels → canonicalize →
                                     reconcile
  absent    derived-contents-pages   toc_strategies/from_contents_pages: parse
                                     the printed Contents page(s), fit the
                                     printed→physical page offset
  absent    none                     every strategy declined (each with its
                                     reason in the log; from-llm is a stub) →
                                     empty outline, blocks keep splitter keys.

There is deliberately NO derived-llm route: conversion is a non-LLM job; LLM
repair belongs to a future queued job kind, never a synchronous stage here
(from-llm is registered as a declining stub so the log shows it).

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
ROUTE_DERIVED_HEADINGS = "derived-headings"
ROUTE_DERIVED_CONTENTS = "derived-contents-pages"
ROUTE_DERIVED_LLM = "derived-llm"  # declared; strategy is a registered stub
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
# Derive strategies live in toc_strategies/ (contract in its base.py): each is a
# pure function of a TocDeriveContext returning entries in the RAW bookmark shape
# ``[{level, title, page}]`` — so a derived outline flows through the exact same
# canonicalize → reconcile machinery as real bookmarks — or a decline reason.
# --------------------------------------------------------------------------- #

_STRATEGY_ROUTES = {
    "from-headings": ROUTE_DERIVED_HEADINGS,
    "from-contents-pages": ROUTE_DERIVED_CONTENTS,
    "from-llm": ROUTE_DERIVED_LLM,
}


# --------------------------------------------------------------------------- #
# The control loop
# --------------------------------------------------------------------------- #

def resolve_toc(
    raw_outline: list[dict] | None,
    blocks: list[SectionBlock],
    page_count: int,
    *,
    heading_pages: list[tuple[str, int]] | None = None,
    pages: list[tuple[int, str]] | None = None,
    pdf_bytes: bytes | None = None,
) -> TocResolution:
    """Resolve a document's TOC through the routing table above.

    Inputs are exactly what ``persist_document`` has in hand: the PDF bookmarks
    from the reader, the page-annotated split blocks, and the page count. The
    keyword extras feed the derive strategies' TocDeriveContext (all optional —
    strategies decline gracefully without them).
    """
    from app.process.content.toc_strategies import STRATEGIES, TocDeriveContext

    decisions: list[str] = []

    # stage: source — shape only. PDF-level bookmark cleanup is reader.py's job
    # (extract_pdf_outline); re-validating here would grow a second, drifting rule.
    raw = raw_outline or []
    decisions.append(f"source: {len(raw)} bookmark entries, {len(blocks)} content blocks")

    # stage: assess — v1 emits only what it actually knows.
    quality = QUALITY_PRESENT if raw else QUALITY_ABSENT
    decisions.append(f"assess: {quality}")

    # stage: derive — absent only. First strategy that yields an outline wins and
    # stamps the final route; every refusal is logged with its reason.
    derived_route: str | None = None
    if quality == QUALITY_ABSENT:
        ctx = TocDeriveContext(
            pdf_bytes=pdf_bytes,
            blocks=blocks,
            heading_pages=heading_pages or [],
            pages=pages or [],
            page_count=page_count,
        )
        for name, strategy in STRATEGIES:
            out = strategy(ctx)
            if isinstance(out, list) and out:
                decisions.append(f"derive/{name}: {len(out)} entries")
                raw = out
                derived_route = _STRATEGY_ROUTES.get(name, ROUTE_NONE)
                break
            reason = out if isinstance(out, str) else "no usable outline"
            decisions.append(f"derive/{name}: declined ({reason})")
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
        route = derived_route or ROUTE_BOOKMARKS
        decisions.append(f"reconcile: {len(block_map)}/{len(blocks)} blocks matched")
        decisions.append(f"route: {route}")
        return TocResolution(route, quality, canonical, block_map, decisions)

    entries = normalize_outline(raw, blocks)
    route = derived_route or ROUTE_PAGEMATCHED
    decisions.append(
        "reconcile: 0 blocks matched — outline page-matched onto block keys "
        f"({len(entries)} entries; blocks keep splitter keys)"
    )
    decisions.append(f"route: {route}")
    return TocResolution(route, quality, entries, {}, decisions)
