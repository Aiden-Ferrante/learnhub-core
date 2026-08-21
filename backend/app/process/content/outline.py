"""Canonical TOC outline from PDF bookmarks + block-to-outline assignment.

One canonical outline (unique nested keys) shared by the reader and concepts, so
the syllabus tree, reader, and numbering line up by construction. Pure — no DB.
"""

from __future__ import annotations

import re

from app.process.content.pages import _heading_text_norm
from app.process.content.sections import SectionBlock, _slug_key

_OUTLINE_NUM = re.compile(r"^\s*(?:chapter|part|appendix|section)?\s*(\d+(?:\.\d+)*)\s*[.:)]?\s+(.*)$", re.IGNORECASE)


def _parse_outline_number(title: str) -> tuple[str | None, str]:
    """Split a leading section number off a bookmark title: "Chapter 1. Intro" -> ("1","Intro")."""
    m = _OUTLINE_NUM.match(title or "")
    if m and m.group(2).strip():
        return m.group(1), m.group(2).strip()
    return None, (title or "").strip()


def _dedup_key(base: str, used: dict[str, int]) -> str:
    """``toc:<base>`` made unique by a deterministic, document-order suffix (~2, ~3 …) so
    repeated headings (every chapter's "Summary") and same-page siblings never collide —
    the root cause of sections being silently dropped from the syllabus tree."""
    n = used.get(base, 0)
    used[base] = n + 1
    return f"toc:{base}" if n == 0 else f"toc:{base}~{n + 1}"


def build_outline_from_bookmarks(raw_outline: list[dict] | None) -> list[dict]:
    """Canonical TOC from the PDF bookmarks: nesting from ``listDepth``, and a
    hierarchically-UNIQUE ``sectionKey`` slugged from each entry's OWN title (not a fuzzy
    page-match to a content block, which mislabeled & collided siblings). This single keyspace
    is shared by the reader content and the extracted concepts (both re-sectioned onto it),
    so the syllabus tree, the reader, and the numbering line up by construction."""
    out: list[dict] = []
    used: dict[str, int] = {}
    for e in raw_outline or []:
        try:
            level = max(1, int(e.get("level", 1)))
            title = str(e.get("title", "")).strip()
            page = int(e.get("page", 0))
        except Exception:  # noqa: BLE001
            continue
        if not title:
            continue
        number_key, clean = _parse_outline_number(title)
        base = number_key or _slug_key(clean, len(out))
        out.append(
            {
                "numberKey": number_key,
                "title": clean,
                "sectionKey": _dedup_key(base, used),
                "listDepth": level - 1,
                "page": page,
            }
        )
    return out


_LIG_SEQS = ("ffi", "ffl", "ff", "fi", "fl")


def _lig_collapse(s: str) -> str:
    """Fold the fi/ff/fl ligature families out of normalized heading text. PDF text
    extraction drops ligature glyphs the font encodes as private-use codepoints
    ("Complexity dened", "le deletion"), so equality against the clean bookmark title
    only holds after both sides shed those sequences."""
    for seq in _LIG_SEQS:
        s = s.replace(seq, "")
    return s


def assign_blocks_by_number(
    outline: list[dict], blocks: list[tuple]
) -> dict[int, str]:
    """Map blocks onto the outline by NUMBER PREFIX — for outlines derived from a
    document's own heading numbering.

    ``1.1.1.1`` belongs under ``1.1.1``; ``1.1.1.1.2`` under the same, since the outline
    stops at three levels. A heading with no number folds into the section it appears
    inside, which is the most recent numbered one.

    This exists because ``assign_blocks_to_outline``'s title matching is actively wrong
    here. That matcher is a *recovery* tool: PDF bookmarks and body headings often differ
    in wording, so it matches on number OR normalized title OR ligature-collapsed title,
    and each match consumes an entry and advances a pointer. Give it a chapter that names
    its own sub-chapters — a taxonomy listing its six axes, a preface summarizing the
    parts — and those mentions match the real entries, consume all of them, and every
    block after the last one folds into whatever entry the pointer stopped on. Observed:
    67 of 81 blocks collapsed into the final section.

    When the outline came from the numbering, none of that ambiguity exists. The document
    stated its own hierarchy; read it literally.
    """
    by_num: dict[str, str] = {}
    for e in outline:
        num = (e.get("numberKey") or "").strip()
        if num and num not in by_num:
            by_num[num] = e["sectionKey"]
    if not by_num:
        return {}

    out: dict[int, str] = {}
    current: str | None = None
    for blk in sorted(blocks, key=lambda b: b[0]):
        order, heading = blk[0], blk[1]
        num, _rest = _parse_outline_number(heading)
        if num:
            parts = num.split(".")
            # Longest numeric prefix that is a real node: 1.1.1.1 -> 1.1.1 -> 1.1 -> 1
            for cut in range(len(parts), 0, -1):
                key = by_num.get(".".join(parts[:cut]))
                if key:
                    current = key
                    break
        if current:
            out[order] = current
    return out


def assign_blocks_to_outline(
    outline: list[dict], blocks: list[tuple]
) -> dict[int, str]:
    """Map each content block (``(order, heading[, page])``, document order) to a canonical
    outline section. Order-aware match with per-entry precedence: same section number
    ("5.1" == "5.1" — survives subtitles and ligature-mangled titles), exact normalized
    title, then ligature-collapsed title. When both the block and the entry know their page,
    they must agree within 2 pages — otherwise the book's own contents pages, whose lines
    repeat chapter titles verbatim, hijack the pointer. A block that matches advances the
    pointer and becomes the "current" section; a finer sub-heading with no outline entry of
    its own (e.g. "Transformer architecture") folds into the current section ("Model
    Architecture"), so its concepts attach to a real TOC node — without stealing that
    section's title the way a coarse page-match did."""
    entries: list[dict] = []
    for e in outline:
        t = _heading_text_norm(e.get("title", ""))
        entries.append(
            {
                "key": e["sectionKey"],
                "num": e.get("numberKey"),
                "title": t,
                "lig": _lig_collapse(t),
                "page": e.get("page"),
            }
        )
    out: dict[int, str] = {}
    ptr = 0
    current: str | None = None
    for blk in sorted(blocks, key=lambda b: b[0]):
        order, heading = blk[0], blk[1]
        page = blk[2] if len(blk) > 2 else None
        num, rest = _parse_outline_number(heading)
        h = _heading_text_norm(heading)
        titles = (h, _heading_text_norm(rest))
        ligs = tuple(_lig_collapse(t) for t in titles)
        j = ptr
        while j < len(entries) and j - ptr <= 30:
            e = entries[j]
            pages_agree = (
                page is None or not e["page"] or abs(int(page) - int(e["page"])) <= 2
            )
            if pages_agree and (
                (num is not None and num == e["num"])
                or (e["title"] and e["title"] in titles)
                or (e["lig"] and e["lig"] in ligs)
            ):
                ptr = j + 1
                current = e["key"]
                break
            j += 1
        if current:
            out[order] = current
    return out


def normalize_outline(raw_outline: list[dict] | None, blocks: list[SectionBlock]) -> list[dict]:
    """Turn the PDF's embedded bookmarks into TOC entries whose ``sectionKey`` is the REAL
    ``section_content`` block (mapped by page), so a preview selection always lines up with an
    extractable section. Falls back to a number/slug key when page ranges are unavailable."""
    paged = sorted([b for b in blocks if b.page_start is not None], key=lambda b: b.page_start)

    def section_for_page(page: int) -> str | None:
        chosen = None
        for b in paged:
            if b.page_start is not None and b.page_start <= page:
                chosen = b
            else:
                break
        return chosen.section_key if chosen else None

    out: list[dict] = []
    for e in raw_outline or []:
        try:
            level = max(1, int(e.get("level", 1)))
            title = str(e.get("title", "")).strip()
            page = int(e.get("page", 0))
        except Exception:
            continue
        if not title:
            continue
        number_key, clean = _parse_outline_number(title)
        section_key = section_for_page(page) if page > 0 else None
        if not section_key:
            section_key = f"toc:{number_key}" if number_key else f"toc:{_slug_key(clean, len(out))}"
        out.append(
            {
                "numberKey": number_key,
                "title": clean,
                "sectionKey": section_key,
                "listDepth": level - 1,
                "page": page,
            }
        )
    return out
