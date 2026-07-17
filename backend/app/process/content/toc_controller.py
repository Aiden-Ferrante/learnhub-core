"""TOC controller — staged, logged resolution of a document's structure.

One entry point (``resolve_toc``) walks named stages and returns which route the
book took plus a human-readable decision log (persisted on the convert job's
ledger row), so any book's TOC weirdness is diagnosable without a debugger.

ROUTING TABLE (every path that exists today, named):

  quality      route                    path
  ----------   ---------------------    -------------------------------------------
  clean|messy  bookmarks                canonicalize (build_outline_from_bookmarks)
                                        → reconcile (assign_blocks_to_outline
                                        matched ≥1 block; block_map OVERLAYS
                                        splitter keys). `messy` routes like `clean`
                                        — repair hooks are future work; the failing
                                        signals are named in the decision log.
  clean|messy  bookmarks-pagematched    reconcile matched 0 blocks (or canonicalize
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

import re
from dataclasses import dataclass, field

from app.process.content.outline import (
    assign_blocks_to_outline,
    build_outline_from_bookmarks,
    normalize_outline,
)
from app.process.content.sections import SectionBlock

# -- assess signals — how bookmark quality is scored. A failing signal marks the
# outline `messy` (and names itself in the decision log); `messy` still routes
# like `clean` — repair hooks are future work, the label is the diagnosis. -----

# ENTRY_RATIO: too few bookmarks for the book's size — a 500-page book with 3
# bookmarks is not a real TOC. Required entries = max(floor, pages/divisor); a
# 20-chapter/400-page chapters-only outline still passes.
SIGNAL_ENTRY_FLOOR = 3
SIGNAL_ENTRY_PAGES_PER_ENTRY = 50

# MONOTONIC_PAGES: bookmark pages should be non-decreasing in reading order; more
# than this fraction of adjacent pairs going backwards is disorder, not a stray.
SIGNAL_MAX_NONMONOTONIC_FRAC = 0.02

# JUNK_TITLE_RATIO: URLs / ISBNs / long digit runs / bare numbers as titles.
SIGNAL_MAX_JUNK_TITLE_FRAC = 0.30
_SIGNAL_JUNK_TITLE = re.compile(r"(https?://|www\.|isbn|\b\d{9,}\b)", re.IGNORECASE)
_SIGNAL_BARE_NUMBER = re.compile(r"^\d+(?:\.\d+)*\s*[.:)]?$")

# DEPTH_DISTRIBUTION: a long, completely flat outline (every entry level 1) for a
# book this size means the nesting was lost. Short flat outlines (chapters-only
# books) are legitimate.
SIGNAL_FLAT_SUSPECT_MIN_ENTRIES = 30

QUALITY_CLEAN = "clean"
QUALITY_MESSY = "messy"
QUALITY_ABSENT = "absent"


def assess_bookmarks(raw: list[dict], page_count: int) -> tuple[str, list[str]]:
    """Score the raw bookmarks → (quality, reasons). Empty → absent. Any failing
    signal → messy, with each failure named for the decision log; else clean."""
    if not raw:
        return QUALITY_ABSENT, []
    reasons: list[str] = []

    required = max(SIGNAL_ENTRY_FLOOR, (page_count or 0) // SIGNAL_ENTRY_PAGES_PER_ENTRY)
    if len(raw) < required:
        reasons.append(f"entry-ratio: {len(raw)} entries for {page_count} pages (need {required})")

    pages = [int(e["page"]) for e in raw if e.get("page")]
    if len(pages) >= 2:
        backwards = sum(1 for a, b in zip(pages, pages[1:]) if b < a)
        if backwards / (len(pages) - 1) > SIGNAL_MAX_NONMONOTONIC_FRAC:
            reasons.append(f"monotonic-pages: {backwards}/{len(pages) - 1} adjacent pairs go backwards")

    titles = [str(e.get("title") or "").strip() for e in raw]
    junk = sum(1 for t in titles if not t or _SIGNAL_JUNK_TITLE.search(t) or _SIGNAL_BARE_NUMBER.match(t))
    if junk / len(titles) > SIGNAL_MAX_JUNK_TITLE_FRAC:
        reasons.append(f"junk-titles: {junk}/{len(titles)} titles are noise")

    if len(raw) >= SIGNAL_FLAT_SUSPECT_MIN_ENTRIES and all(int(e.get("level") or 1) <= 1 for e in raw):
        reasons.append(f"depth-distribution: {len(raw)} entries, all level 1 (nesting lost?)")

    return (QUALITY_MESSY if reasons else QUALITY_CLEAN), reasons

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

    # stage: assess — scored: clean | messy (each failing signal named) | absent.
    # `messy` routes like `clean` for now: repair hooks are future work, the
    # label + reasons on the ledger are the diagnosis.
    quality, why = assess_bookmarks(raw, page_count)
    decisions.append(f"assess: {quality}" + (f" ({'; '.join(why)})" if why else ""))

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
