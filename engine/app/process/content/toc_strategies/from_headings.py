"""derive/from-headings — outline from detected headings (priority 1).

Two passes, best first (cf. pdf.tocgen's approach — reimplemented, no code copied):

FONT pass (needs ``pdf_bytes``): one fitz sweep over the heading pages recovers
each heading's font size (matched by page + normalized text). Sizes cluster
(rounded to 0.5pt); descending size clusters map to levels 1..3 — chapter titles
are set in bigger type, which is exactly the signal the text pass lacks.

TEXT pass (fallback — no PDF bytes, or the font match found too few headings):
levels from the blocks themselves — a numbered heading's depth comes from its
number ("2" → 1, "2.1" → 2), an unnumbered one from its markdown level — then
shifted so the shallowest level is 1.

Both passes end at the same sanity gates: ≥ 3 entries, non-decreasing pages,
entries spanning ≥ 30% of the page range, no single page contributing > 20%.
"""

from __future__ import annotations

import re

from app.process.content.pages import _heading_text_norm
from app.process.content.toc_strategies.base import (
    DeriveOutcome,
    TocDeriveContext,
    page_sanity_gates,
)

_MIN_ENTRIES = 3
_MIN_SPAN_FRAC = 0.30
_MAX_PAGE_FRAC = 0.20
_MAX_LEVELS = 3                # deeper distinctions are noise at this stage
_MIN_FONT_MATCH_FRAC = 0.5     # font pass needs sizes for at least half the headings

# Titles that are noise, not structure; and paragraph-length mis-splits.
_JUNK_TITLE = re.compile(r"(https?://|www\.|isbn|\b\d{9,}\b)", re.IGNORECASE)
_MAX_TITLE_CHARS = 120


def _usable(title: str) -> bool:
    t = (title or "").strip()
    return bool(t) and len(t) <= _MAX_TITLE_CHARS and not _JUNK_TITLE.search(t)


def _gate(entries: list[dict], page_count: int) -> str | None:
    return page_sanity_gates(
        entries, page_count,
        min_entries=_MIN_ENTRIES, min_span_frac=_MIN_SPAN_FRAC, max_page_frac=_MAX_PAGE_FRAC,
    )


# --------------------------------------------------------------------------- #
# FONT pass
# --------------------------------------------------------------------------- #

def _heading_font_sizes(pdf_bytes: bytes, wanted: list[tuple[str, int]]) -> dict[tuple[str, int], float]:
    """(normalized heading text, page) -> font size, via one fitz text sweep of the
    pages that carry headings. A heading matches a line whose normalized text equals
    it, or is a prefix of it (wrapped headings)."""
    import fitz  # pymupdf — a library dependency, not an app layer

    by_page: dict[int, list[str]] = {}
    for text, page in wanted:
        by_page.setdefault(page, []).append(text)

    sizes: dict[tuple[str, int], float] = {}
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:  # noqa: BLE001 — unreadable bytes → no font data, caller falls back
        return sizes
    try:
        for page_no, targets in by_page.items():
            if not (1 <= page_no <= doc.page_count):
                continue
            try:
                d = doc[page_no - 1].get_text("dict")
            except Exception:  # noqa: BLE001
                continue
            for block in d.get("blocks", []):
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    line_norm = _heading_text_norm("".join(s.get("text", "") for s in spans))
                    if not line_norm:
                        continue
                    size = max((float(s.get("size", 0)) for s in spans), default=0.0)
                    for t in targets:
                        key = (t, page_no)
                        if key in sizes:
                            continue
                        if line_norm == t or (len(line_norm) >= 5 and t.startswith(line_norm)):
                            sizes[key] = max(sizes.get(key, 0.0), size)
    finally:
        doc.close()
    return sizes


def _font_pass(ctx: TocDeriveContext) -> list[dict] | None:
    wanted = [
        (_heading_text_norm(t), int(p))
        for (t, p) in ctx.heading_pages
        if _usable(t) and p
    ]
    if not ctx.pdf_bytes or len(wanted) < _MIN_ENTRIES:
        return None
    sizes = _heading_font_sizes(ctx.pdf_bytes, wanted)
    if len(sizes) < len(wanted) * _MIN_FONT_MATCH_FRAC:
        return None

    # Cluster sizes (0.5pt buckets), biggest cluster = level 1, cap at _MAX_LEVELS.
    buckets = sorted({round(s * 2) / 2 for s in sizes.values()}, reverse=True)
    level_of = {b: min(i + 1, _MAX_LEVELS) for i, b in enumerate(buckets)}

    entries: list[dict] = []
    unmatched_level = max(level_of.values()) if level_of else _MAX_LEVELS
    for (text, page) in ctx.heading_pages:
        if not (_usable(text) and page):
            continue
        size = sizes.get((_heading_text_norm(text), int(page)))
        level = level_of[round(size * 2) / 2] if size is not None else unmatched_level
        entries.append({"level": level, "title": text.strip(), "page": int(page)})
    return entries or None


# --------------------------------------------------------------------------- #
# TEXT pass (fallback)
# --------------------------------------------------------------------------- #

def _text_pass(ctx: TocDeriveContext) -> list[dict] | None:
    entries: list[dict] = []
    for b in ctx.blocks:
        if not _usable(b.heading):
            continue
        if b.number_key:
            level = b.number_key.count(".") + 1
        else:
            level = b.level if (b.level or 0) >= 1 else 1
        entries.append({"level": level, "title": b.heading.strip(), "page": b.page_start or 0})
    if not entries:
        return None
    shift = min(e["level"] for e in entries) - 1
    if shift:
        for e in entries:
            e["level"] -= shift
    for e in entries:
        e["level"] = min(e["level"], _MAX_LEVELS)
    return entries


# --------------------------------------------------------------------------- #
# The strategy
# --------------------------------------------------------------------------- #

def derive(ctx: TocDeriveContext) -> DeriveOutcome:
    last_reason = "no usable headings"
    for entries in (_font_pass(ctx), _text_pass(ctx)):
        if not entries:
            continue
        reason = _gate(entries, ctx.page_count)
        if reason is None:
            return entries
        last_reason = reason
    return last_reason
