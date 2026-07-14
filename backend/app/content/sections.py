"""Markdown -> section blocks: the splitter that mirrors the KG's section keyspace.

Section keys derive from heading numbering (``toc:{numberKey}``), matching the
frontend's ``makeSectionKey`` rule, so reader content and KG sections share one
hierarchy without fuzzy alignment. Unnumbered headings fall back to a slug key.
Pure functions — no DB.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

TOC_ROOT_KEY = "toc:root"
_HEADING = re.compile(r"^(#{1,6})\s+(.+)$")
_LEADING_NUMBER = re.compile(r"^(\d+(?:\.\d+)*)\s*[.:)\-–]?\s+")
_NUMERIC_KEY = re.compile(r"^\d+(?:\.\d+)*$")


@dataclass
class SectionBlock:
    section_key: str
    heading: str
    level: int
    number_key: str | None
    order: int
    markdown: str
    page_start: int | None = None
    page_end: int | None = None


@dataclass
class PageBlock:
    page_no: int
    markdown: str
    section_path: list[str] = field(default_factory=list)
    section_keys: list[str] = field(default_factory=list)
    headings: list[dict] = field(default_factory=list)


def _clean_heading_markup(s: str) -> str:
    """Strip PDF/HTML export noise from heading text (mirrors cleanHeadingMarkup)."""
    t = s or ""
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("**", "")
    t = re.sub(r"_(.+?)_", r"\1", t)
    return t.strip()


def _slug_key(title: str, index: int) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").lower())
    s = re.sub(r"^-|-$", "", s)[:48]
    return s or f"u{index}"


def split_markdown_sections(markdown: str) -> list[SectionBlock]:
    """Split markdown into per-heading blocks keyed by ``toc:`` like the KG.

    Each block spans from its ATX heading line to the next heading (exclusive), so
    concatenating a section with its descendants reconstructs the full section text.
    Content before the first heading (preamble) is not stored as a block.
    """
    lines = (markdown or "").split("\n")
    heads: list[tuple[int, int, str]] = []  # (line_index, level, raw_heading_text)
    for i, line in enumerate(lines):
        m = _HEADING.match(line)
        if m:
            heads.append((i, len(m.group(1)), m.group(2).strip()))

    blocks: list[SectionBlock] = []
    for order, (line_idx, level, raw) in enumerate(heads):
        end = heads[order + 1][0] if order + 1 < len(heads) else len(lines)
        body = "\n".join(lines[line_idx:end]).strip()
        cleaned = _clean_heading_markup(raw)
        nm = _LEADING_NUMBER.match(cleaned)
        number_key = nm.group(1) if nm else None
        if number_key:
            section_key = f"toc:{number_key}"
        else:
            section_key = f"toc:{_slug_key(cleaned, order)}"
        blocks.append(
            SectionBlock(
                section_key=section_key,
                heading=cleaned,
                level=level,
                number_key=number_key,
                order=order,
                markdown=body,
            )
        )
    return blocks
