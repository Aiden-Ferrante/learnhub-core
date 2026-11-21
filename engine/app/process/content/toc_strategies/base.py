"""The derive-strategy contract (see the TOC controller's routing table).

Every strategy is a pure function with the same signature and the same output
shape — the raw-bookmark shape ``reader.extract_pdf_outline`` already returns —
so whatever a strategy produces flows into the existing canonicalize → reconcile
pipeline exactly as if the PDF had author bookmarks:

    def derive(ctx: TocDeriveContext) -> list[dict] | str | None
        # list  -> [{"level": int>=1, "title": str, "page": int>=1}, ...] reading order
        # str   -> declined, with the reason (the controller logs "declined (<why>)")
        # None  -> declined, no specific reason

(The ``str`` return is the one deliberate extension over the contract's
``list | None``: the decision-log format promises a decline *reason*, and the
signature needs a channel to carry it.)

Strategies must NOT: touch the DB, import api/conductor/gateways, import each
other, mutate the context, or raise on bad input — decline instead.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.process.content.sections import SectionBlock

# entries | decline-reason | silent decline
DeriveOutcome = list[dict] | str | None


@dataclass(frozen=True)
class TocDeriveContext:
    """Everything a strategy may look at — assembled by the controller from what
    persist_document already has in hand."""

    pdf_bytes: bytes | None                  # for strategies that need fitz (fonts, raw text)
    blocks: list[SectionBlock]               # split markdown sections (order, heading, page spans)
    heading_pages: list[tuple[str, int]]     # (heading text, 1-based page), reading order
    pages: list[tuple[int, str]]             # (1-based page, page markdown)
    page_count: int


# --------------------------------------------------------------------------- #
# Shared sanity gates — a strategy that can't pass them returns the reason.
# --------------------------------------------------------------------------- #

def page_sanity_gates(
    entries: list[dict],
    page_count: int,
    *,
    min_entries: int,
    min_span_frac: float = 0.0,
    max_page_frac: float = 1.0,
) -> str | None:
    """Common credibility checks on a candidate outline. Returns a decline reason,
    or None when the outline passes.

    Page-based gates (monotonic, span, concentration) only apply when at least
    half the entries carry a real page — a markdown-only conversion with no page
    side-channel must still be able to derive structure.
    """
    if len(entries) < min_entries:
        return f"only {len(entries)} usable entries (need {min_entries})"

    paged = [int(e["page"]) for e in entries if e.get("page")]
    if len(paged) * 2 < len(entries):
        return None  # too little page data to judge — skip the page gates

    if any(b < a for a, b in zip(paged, paged[1:])):
        return "entry pages are not non-decreasing"
    if page_count and min_span_frac > 0:
        span = max(paged) - min(paged) + 1
        if span / page_count < min_span_frac:
            return f"entries span only {span}/{page_count} pages"
    if max_page_frac < 1.0:
        from collections import Counter

        worst_page, worst_n = Counter(paged).most_common(1)[0]
        # Absolute floor: with few entries every page trivially exceeds the fraction;
        # the gate exists to catch one page contributing MANY entries (a parsed
        # contents page masquerading as headings).
        if worst_n >= 3 and worst_n / len(entries) > max_page_frac:
            return f"page {worst_page} contributes {worst_n}/{len(entries)} entries"
    return None
