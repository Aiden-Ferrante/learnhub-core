"""Markdown -> section blocks: the splitter that mirrors the KG's section keyspace.

Section keys derive from heading numbering (``toc:{numberKey}``), matching the
frontend's ``makeSectionKey`` rule, so reader content and KG sections share one
hierarchy without fuzzy alignment. Unnumbered headings fall back to a slug key.
Pure functions — no DB.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

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


def clean_heading_markup(s: str) -> str:
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


_FENCE = re.compile(r"^(`{3,}|~{3,})")
_SETEXT = re.compile(r"^\s{0,3}(=+|-+)\s*$")
_LIST_ITEM = re.compile(r"^\s*([-*+]\s|\d+[.)]\s)")


def split_markdown_sections(markdown: str) -> list[SectionBlock]:
    """Split markdown into per-heading blocks keyed by ``toc:`` like the KG.

    Each block spans from its ATX heading line to the next heading (exclusive), so
    concatenating a section with its descendants reconstructs the full section text.
    Content before the first heading (preamble) is not stored as a block.
    """
    lines = (markdown or "").split("\n")
    heads: list[tuple[int, int, str]] = []  # (line_index, level, raw_heading_text)
    # A `#` inside a fenced code block is a comment, not a heading. Without this, a Python
    # comment becomes a chapter: `# This is a comment` opened a section, chopping the block
    # mid-listing and feeding extraction half a code sample under a heading the author never
    # wrote. 11 of the dev library's 12 books contain fenced code (finding D1).
    #
    # The fence rule follows CommonMark closely enough for real documents: a fence opens on
    # ``` or ~~~ and closes on the same character at the same-or-greater length. Tracking the
    # character matters — a ``` block containing ~~~ must not be closed by it, which happens
    # in any book that shows markdown examples.
    fence_char = ""
    fence_len = 0
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        fm = _FENCE.match(stripped)
        if fm:
            char, run = fm.group(1)[0], len(fm.group(1))
            if not fence_char:
                fence_char, fence_len = char, run
            elif char == fence_char and run >= fence_len:
                fence_char, fence_len = "", 0
            continue
        if fence_char:
            continue
        m = _HEADING.match(line)
        if m:
            heads.append((i, len(m.group(1)), m.group(2).strip()))
            continue
        # Setext headings — a line of text underlined by === or ---. Docling and pymupdf both
        # emit them for some books, and with no handling at all the title became body text of
        # whatever section preceded it, so a real chapter silently vanished from the outline
        # (finding D2). Guarded hard, because `---` is also a horizontal rule and a YAML
        # fence: the line above must be non-blank, must not itself be a heading, and must not
        # look like a table row or a list item.
        if i and _SETEXT.match(line):
            prev = lines[i - 1].strip()
            if (prev and not _HEADING.match(lines[i - 1])
                    and "|" not in prev and not _LIST_ITEM.match(prev)):
                heads.append((i - 1, 1 if line.strip()[0] == "=" else 2, prev))

    blocks: list[SectionBlock] = []
    for order, (line_idx, level, raw) in enumerate(heads):
        end = heads[order + 1][0] if order + 1 < len(heads) else len(lines)
        body = "\n".join(lines[line_idx:end]).strip()
        cleaned = clean_heading_markup(raw)
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
