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
    # sectionKey -> reason for nodes hidden from the SYLLABUS view (front/back matter,
    # orphan Part containers). Stored per node (raw_structure.hidden_reason) so read-time
    # tree assembly filters by flag — the heuristics run once, here, logged.
    hidden: dict[str, str] = field(default_factory=dict)


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
# stage: curate — which nodes the SYLLABUS should hide (the reader always shows
# the whole book). Moved from toc_tree.py's silent read-time filters so the
# verdicts are logged here and stored per node; read time filters by flag only.
# --------------------------------------------------------------------------- #

HIDE_FRONT_BACK = "front-back-matter"
HIDE_ORPHAN_PART = "orphan-part"
HIDE_PART = "part-container"

# Top-level front/back matter to hide so the syllabus reads like the printed Table of
# Contents (these are in the PDF bookmarks but not study content). Matched
# case-insensitively, exact or by prefix, against the entry title.
_FRONT_BACK_EXACT = {
    "cover", "copyright", "title page", "half title", "dedication", "colophon",
    "table of contents", "brief table of contents", "contents", "index",
    "about the author", "about the authors", "acknowledgments", "acknowledgements",
    "notation", "list of figures", "list of tables", "revision history",
    "preface", "foreword", "epilogue", "contributors", "other books you may enjoy",
    "bibliography", "glossary", "references",
}
_FRONT_BACK_PREFIX = ("praise for", "revision history for", "about the author")
_TOC_NUMERIC_KEY = re.compile(r"^toc:\d+(?:\.\d+)*$")


def _is_front_back_title(title: str) -> bool:
    t = re.sub(r"\s+", " ", (title or "")).strip().lower()
    return t in _FRONT_BACK_EXACT or any(t.startswith(p) for p in _FRONT_BACK_PREFIX)


# stage: parts — Part-structured books ("Part I. Foundations" containers with the
# real chapters nested one level down) would otherwise present 3 parts as the
# book's chapters everywhere depth 0 means "chapter" (syllabus tops, reader
# chapter picker, chapter spans). A part container WITH children is hidden and
# its subtree promoted one level, so chapters land at depth 0; the childless
# mis-bookmarked variant stays curate's orphan-part rule.
_PART_TITLE_RE = re.compile(
    r"^\s*(?:part|unit)\s+(?:[ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b",
    re.IGNORECASE,
)


def demote_part_containers(entries: list[dict]) -> tuple[list[dict], dict[str, str], str | None]:
    """(entries', hidden, log line). Depth-0 part-titled entries with children are
    flagged ``part-container`` (kept in the stored structure, hidden from the
    syllabus like curated front matter) and every entry in their subtree moves up
    one level. Books without parts pass through untouched (same list object)."""
    part_idx: set[int] = set()
    for i, e in enumerate(entries):
        if int(e.get("listDepth") or 0) != 0:
            continue
        has_children = i + 1 < len(entries) and int(entries[i + 1].get("listDepth") or 0) > 0
        if has_children and _PART_TITLE_RE.match(e.get("title") or ""):
            part_idx.add(i)
    if not part_idx:
        return entries, {}, None

    out: list[dict] = []
    hidden: dict[str, str] = {}
    in_part = False
    for i, e in enumerate(entries):
        depth = int(e.get("listDepth") or 0)
        if depth == 0:
            in_part = i in part_idx
            if in_part:
                hidden[e["sectionKey"]] = HIDE_PART
            out.append(e)
        else:
            out.append({**e, "listDepth": depth - 1} if in_part else e)
    titles = "; ".join((entries[i].get("title") or entries[i].get("sectionKey")) for i in sorted(part_idx))
    log = f"parts: demoted {len(part_idx)} container(s) ({titles}); nested sections promoted one level"
    return out, hidden, log


def curate_outline(entries: list[dict], pre_hidden: set[str] | None = None) -> dict[str, str]:
    """sectionKey -> hide reason, over the flat canonical entries.

    Front/back matter: a depth-0 entry with a boilerplate title is hidden ALONG WITH its
    descendants (the following entries at greater depth). Orphan Parts: a childless
    depth-0 entry immediately followed by a child-bearing sibling is a mis-bookmarked
    "Part" container — UNLESS it has a numeric ``toc:N`` key: a real chapter may
    legitimately have no subsections (PoSD ch. 11 "Design it Twice"); "Part I/II"
    bookmarks parse to slug keys (roman numerals carry no digits). ``pre_hidden``
    holds keys an earlier stage already hid (demoted part containers) so they are
    neither re-flagged nor counted as visible siblings."""
    hidden: dict[str, str] = {}
    tops: list[tuple[int, dict, bool]] = []  # (entry index, entry, has_children)
    for i, e in enumerate(entries):
        if int(e.get("listDepth") or 0) != 0 or (pre_hidden and e.get("sectionKey") in pre_hidden):
            continue
        has_children = i + 1 < len(entries) and int(entries[i + 1].get("listDepth") or 0) > 0
        tops.append((i, e, has_children))

    def hide_subtree(idx: int, reason: str) -> None:
        hidden[entries[idx]["sectionKey"]] = reason
        for e in entries[idx + 1 :]:
            if int(e.get("listDepth") or 0) == 0:
                break
            hidden[e["sectionKey"]] = reason

    for idx, e, _ in tops:
        if _is_front_back_title(e.get("title") or ""):
            hide_subtree(idx, HIDE_FRONT_BACK)

    # Orphan-part pass over the tops that SURVIVE the front/back pass, preserving the
    # original adjacency semantics ("immediately followed by a chaptered sibling").
    visible_tops = [(i, e, ch) for (i, e, ch) in tops if e["sectionKey"] not in hidden]
    for pos, (idx, e, has_children) in enumerate(visible_tops):
        if has_children or _TOC_NUMERIC_KEY.match(e.get("sectionKey") or ""):
            continue
        if pos + 1 < len(visible_tops) and visible_tops[pos + 1][2]:
            hidden[e["sectionKey"]] = HIDE_ORPHAN_PART
    return hidden


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

    # stage: parts — promote chapters out of "Part N" containers (see the stage
    # comment above demote_part_containers). No-op for part-less books.
    canonical, part_hidden, part_log = demote_part_containers(canonical)
    if part_log:
        decisions.append(part_log)

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
        hidden = {**_curate_logged(canonical, decisions, part_hidden), **part_hidden}
        decisions.append(f"route: {route}")
        return TocResolution(route, quality, canonical, block_map, decisions, hidden)

    entries = normalize_outline(raw, blocks)
    entries, np_hidden, np_log = demote_part_containers(entries)
    if np_log:
        decisions.append(np_log)
    route = derived_route or ROUTE_PAGEMATCHED
    decisions.append(
        "reconcile: 0 blocks matched — outline page-matched onto block keys "
        f"({len(entries)} entries; blocks keep splitter keys)"
    )
    hidden = {**_curate_logged(entries, decisions, np_hidden), **np_hidden}
    decisions.append(f"route: {route}")
    return TocResolution(route, quality, entries, {}, decisions, hidden)


def _curate_logged(
    entries: list[dict], decisions: list[str], pre_hidden: dict[str, str] | None = None
) -> dict[str, str]:
    """Run curate_outline and narrate its verdicts into the decision log."""
    hidden = curate_outline(entries, set(pre_hidden or ()))
    if not hidden:
        decisions.append("curate: nothing hidden")
        return hidden
    by_key = {e["sectionKey"]: e for e in entries if e.get("sectionKey")}
    for reason in (HIDE_FRONT_BACK, HIDE_ORPHAN_PART):
        tops = [
            k for k, r in hidden.items()
            if r == reason and int(by_key.get(k, {}).get("listDepth") or 0) == 0
        ]
        if tops:
            titles = ", ".join((by_key.get(k, {}).get("title") or k) for k in tops)
            decisions.append(f"curate: hid {len(tops)} ({reason}): {titles}")
    return hidden
