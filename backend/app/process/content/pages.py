"""Page provenance — pages as a first-class unit (pure, unit-testable, no DB).

Joins the converter's per-heading page numbers and per-page markdown into
page-primary blocks, each carrying its section coordinate trail (``sectionPath``),
and cross-links section blocks with their ``[pageStart, pageEnd]``.
"""

from __future__ import annotations

import re

from app.process.content.sections import PageBlock, SectionBlock, _NUMERIC_KEY, clean_heading_markup

# --------------------------------------------------------------------------- #
# Page provenance (pure, unit-testable — no DB)
# --------------------------------------------------------------------------- #

def _heading_text_norm(s: str) -> str:
    return re.sub(r"\s+", " ", clean_heading_markup(s or "")).strip().lower()


def match_section_start_pages(
    sections: list[SectionBlock], heading_pages: list[tuple[str, int]]
) -> dict[int, int]:
    """``order -> 1-based start page``, matching each section heading to the ordered
    ``heading_pages`` (text match with an advancing pointer so duplicate headings and
    extra/missing heading items don't cascade into wrong page numbers)."""
    hp = [(_heading_text_norm(t), int(p)) for (t, p) in heading_pages]
    out: dict[int, int] = {}
    idx = 0
    for b in sorted(sections, key=lambda s: s.order):
        target = _heading_text_norm(b.heading)
        j = idx
        while j < len(hp) and j - idx <= 12:
            if hp[j][0] == target:
                out[b.order] = hp[j][1]
                idx = j + 1
                break
            j += 1
    return out


def _forward_filled_starts(
    sections: list[SectionBlock], start_pages: dict[int, int]
) -> dict[int, int | None]:
    """Carry the last known start page forward over unmatched sections (reading order)."""
    resolved: dict[int, int | None] = {}
    last: int | None = None
    for b in sorted(sections, key=lambda s: s.order):
        p = start_pages.get(b.order)
        if p is None:
            p = last
        if p is not None:
            last = p
        resolved[b.order] = p
    return resolved


def section_page_ranges(
    sections: list[SectionBlock], heading_pages: list[tuple[str, int]], total_pages: int
) -> dict[int, tuple[int | None, int | None]]:
    """``order -> (pageStart, pageEnd)``. End = the next section's start page (the
    section runs until the next heading), or ``total_pages`` for the last section."""
    resolved = _forward_filled_starts(sections, match_section_start_pages(sections, heading_pages))
    ordered = sorted(sections, key=lambda s: s.order)
    ranges: dict[int, tuple[int | None, int | None]] = {}
    for i, b in enumerate(ordered):
        ps = resolved[b.order]
        if ps is None:
            ranges[b.order] = (None, None)
            continue
        nxt = resolved[ordered[i + 1].order] if i + 1 < len(ordered) else None
        pe = nxt if nxt is not None else (total_pages or ps)
        ranges[b.order] = (ps, max(ps, pe))
    return ranges


def _numeric_trail(section_key: str) -> list[str] | None:
    """Ancestor chain of a numeric ``toc:`` key, e.g. ``toc:1.2.3`` →
    ``[toc:1, toc:1.2, toc:1.2.3]``. Returns ``None`` for slug keys (preface,
    theorems, definitions) — those are content, not chapter coordinates."""
    if not section_key.startswith("toc:"):
        return None
    body = section_key[4:]
    if not _NUMERIC_KEY.match(body):
        return None
    parts = body.split(".")
    return [f"toc:{'.'.join(parts[: i + 1])}" for i in range(len(parts))]


def _section_paths_from_events(
    events: list[tuple[int, str]], total_pages: int
) -> dict[int, list[str]]:
    """``1-based page -> numeric breadcrumb``. ``events`` = ``(start_page, section_key)``
    in reading order; the breadcrumb at a page is the ancestor chain of the most recent
    *numbered* section seen so far (Chapter ▸ subchapter ▸ section)."""
    if not total_pages or total_pages < 1:
        return {}
    ordered = sorted(enumerate(events), key=lambda e: (e[1][0], e[0]))
    paths: dict[int, list[str]] = {}
    current: list[str] = []
    ei = 0
    for page in range(1, total_pages + 1):
        while ei < len(ordered) and ordered[ei][1][0] <= page:
            trail = _numeric_trail(ordered[ei][1][1])
            if trail is not None:
                current = trail
            ei += 1
        paths[page] = list(current)
    return paths


def page_section_paths(
    sections: list[SectionBlock], heading_pages: list[tuple[str, int]], total_pages: int
) -> dict[int, list[str]]:
    """``1-based page -> numeric drill-down breadcrumb`` (Chapter ▸ subchapter ▸ section).

    Built from the numeric ``toc:`` key structure (true depth), not Docling's markdown
    heading levels (which are flat/unreliable), so a page inside section 1.2 reads as
    ``[toc:1, toc:1.2]`` even when a theorem/definition heading sits on it.
    """
    resolved = _forward_filled_starts(sections, match_section_start_pages(sections, heading_pages))
    events = [
        (resolved[b.order], b.section_key)
        for b in sorted(sections, key=lambda s: s.order)
        if resolved[b.order] is not None
    ]
    return _section_paths_from_events(events, total_pages)


def headings_starting_on_page(
    sections: list[SectionBlock], heading_pages: list[tuple[str, int]]
) -> dict[int, list[dict]]:
    starts = match_section_start_pages(sections, heading_pages)
    by_page: dict[int, list[dict]] = {}
    for b in sorted(sections, key=lambda s: s.order):
        p = starts.get(b.order)
        if p is not None:
            by_page.setdefault(p, []).append(
                {"sectionKey": b.section_key, "heading": b.heading, "level": b.level}
            )
    return by_page


def build_page_blocks(
    pages: list[tuple[int, str]],
    sections: list[SectionBlock],
    heading_pages: list[tuple[str, int]],
    total_pages: int,
) -> list[PageBlock]:
    """One ``PageBlock`` per page, tagged with its section coordinate trail."""
    paths = page_section_paths(sections, heading_pages, total_pages)
    heads = headings_starting_on_page(sections, heading_pages)
    blocks: list[PageBlock] = []
    for page_no, md in pages:
        path = paths.get(int(page_no), [])
        blocks.append(
            PageBlock(
                page_no=int(page_no),
                markdown=md or "",
                section_path=path,
                section_keys=list(path),
                headings=heads.get(int(page_no), []),
            )
        )
    return blocks
