"""derive/from-contents-pages — outline from the book's printed Contents (priority 2).

(cf. tocPDF, MIT — read as prior art; reimplemented against our shapes.)

Locate the page whose first non-blank line reads "Contents" / "Table of Contents",
parse dot-leader entries (``title .... 42``, plus no-leader lines ending in a page
number) from it and from continuation pages while entries keep coming. Level comes
from a numbering prefix ("3.2" → 2) or indentation. Printed page numbers are shifted
onto physical pages by fitting a constant offset from sampled titles found in the
page text; with no consistent offset the printed numbers are kept as-is —
reconciliation's ±2-page guard tolerates small drift.

Sanity gates: ≥ 5 entries; resolved pages within [1, page_count]; non-decreasing.
"""

from __future__ import annotations

import re

from app.process.content.pages import _heading_text_norm
from app.process.content.toc_strategies.base import (
    DeriveOutcome,
    TocDeriveContext,
    page_sanity_gates,
)

_MIN_ENTRIES = 5
_MAX_LEVELS = 3
_CONTENTS_HEAD = re.compile(r"^(table of )?contents$", re.IGNORECASE)
# title, optional numbering prefix, dot/space leader, printed page number.
_ENTRY = re.compile(
    r"^(?P<indent>\s*)(?P<num>\d+(?:\.\d+)*)?[.:)]?\s*"
    r"(?P<title>\S.*?)"
    r"(?:[\s.·…]{3,}|\s)"
    r"(?P<page>\d{1,4})\s*$"
)
# A page keeps counting as "contents" while at least this share of its lines parse.
_MIN_LINE_MATCH_FRAC = 0.5
_OFFSET_SAMPLES = 5


def _parse_lines(lines: list[str]) -> list[dict]:
    out = []
    for ln in lines:
        m = _ENTRY.match(ln.rstrip())
        if not m:
            continue
        title = m.group("title").strip(" .·…")
        if not title or len(title) > 120:
            continue
        num = m.group("num")
        level = min(num.count(".") + 1, _MAX_LEVELS) if num else (2 if len(m.group("indent")) >= 2 else 1)
        out.append({"level": level, "title": (f"{num} {title}" if num else title),
                    "page": int(m.group("page"))})
    return out


def _fit_offset(entries: list[dict], pages: list[tuple[int, str]]) -> int | None:
    """Constant printed→physical offset, from entries whose titles are findable in
    the page text. Needs two agreeing samples."""
    normed_pages = [(pn, _heading_text_norm(md)) for pn, md in pages]
    offsets: list[int] = []
    step = max(1, len(entries) // _OFFSET_SAMPLES)
    for e in entries[::step][:_OFFSET_SAMPLES]:
        t = _heading_text_norm(e["title"])
        if len(t) < 8:
            continue
        hit = next((pn for pn, txt in normed_pages if t in txt and pn != 0), None)
        if hit:
            offsets.append(hit - e["page"])
    for off in offsets:
        if offsets.count(off) >= 2:
            return off
    return None


def derive(ctx: TocDeriveContext) -> DeriveOutcome:
    if not ctx.pages:
        return "no per-page text available"

    # Locate the Contents page, then keep consuming pages while entries keep coming.
    start = next(
        (i for i, (_pn, md) in enumerate(ctx.pages)
         if _CONTENTS_HEAD.match(next((l.strip() for l in md.splitlines() if l.strip()), ""))),
        None,
    )
    if start is None:
        return "no printed Contents page found"

    entries: list[dict] = []
    for _pn, md in ctx.pages[start:]:
        lines = [l for l in md.splitlines() if l.strip()]
        body = [l for l in lines if not _CONTENTS_HEAD.match(l.strip())]
        parsed = _parse_lines(body)
        if entries and (not body or len(parsed) / max(1, len(body)) < _MIN_LINE_MATCH_FRAC):
            break  # continuation ended
        entries.extend(parsed)
        if not entries:
            break  # a "Contents" heading with nothing parseable on its own page

    if len(entries) < _MIN_ENTRIES:
        return f"only {len(entries)} parsed entries (need {_MIN_ENTRIES})"

    offset = _fit_offset(entries, ctx.pages)
    if offset is not None and offset != 0:
        for e in entries:
            e["page"] += offset
    # TODO(decision-log): no channel exists yet for a success-path note — when one
    # lands, record whether an offset was fitted or printed numbers were kept.

    if ctx.page_count and any(not (1 <= e["page"] <= ctx.page_count) for e in entries):
        return "resolved pages fall outside the document"
    return page_sanity_gates(entries, ctx.page_count, min_entries=_MIN_ENTRIES) or entries
