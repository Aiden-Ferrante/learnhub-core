This file is a merged representation of a subset of the codebase, containing specifically included files, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: assets/deploy/services/learn/app/**/*.py
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
assets/
  deploy/
    services/
      learn/
        app/
          __init__.py
          arango_content.py
          arango_learn.py
          arango_tree.py
          concept_resolve.py
          concepts_extract.py
          extract_routes.py
          extract.py
          ingest_routes.py
          llm.py
          main.py
          mastery.py
          math_markdown.py
          pdf_convert.py
          quiz_gen.py
          rate_limit.py
          reader.py
          seedling_client.py
          study_routes.py
```

# Files

## File: assets/deploy/services/learn/app/__init__.py
````python

````

## File: assets/deploy/services/learn/app/arango_content.py
````python
"""Persist and serve source markdown for the built-in reader.

The KG pipeline (frontend ``utils/toc-processing.ts``) derives section keys from
heading numbering: ``makeSectionKey(numberKey, ...) -> toc:{numberKey}``. We mirror
that rule here when splitting the converted markdown into blocks, so reader content
and KG sections share one hierarchy (``toc:1``, ``toc:1.2`` ...) without re-running
the frontend's fuzzy alignment. Unnumbered headings fall back to a slug key.

Page provenance: pages are a first-class unit. From the converter we also receive
per-heading page numbers (``heading_pages``) and per-page markdown (``pages``); we join
them into a page-primary ``page_content`` collection where each page carries its section
coordinate trail (``sectionPath``), and we cross-link each ``section_content`` block with
its ``[pageStart, pageEnd]``. All page fields are nullable — documents converted before
this change (no heading/page side channels) keep working with page data absent.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from arango.database import StandardDatabase

from app.arango_tree import connect_arango

DOCUMENTS = "documents"
SECTION_CONTENT = "section_content"
PAGE_CONTENT = "page_content"

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


# --------------------------------------------------------------------------- #
# Page provenance (pure, unit-testable — no DB)
# --------------------------------------------------------------------------- #

def _heading_text_norm(s: str) -> str:
    return re.sub(r"\s+", " ", _clean_heading_markup(s or "")).strip().lower()


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


def is_ancestor_section_key(ancestor: str, child: str) -> bool:
    """True when ``ancestor`` is the same section or a numeric parent of ``child``."""
    if ancestor == child:
        return True
    if ancestor == TOC_ROOT_KEY:
        return True
    a = ancestor[4:] if ancestor.startswith("toc:") else ancestor
    c = child[4:] if child.startswith("toc:") else child
    if _NUMERIC_KEY.match(a) and _NUMERIC_KEY.match(c):
        return c == a or c.startswith(f"{a}.")
    return child.startswith(f"{ancestor}/")


def _ensure_collections(db: StandardDatabase) -> None:
    if not db.has_collection(DOCUMENTS):
        db.create_collection(DOCUMENTS)
    if not db.has_collection(SECTION_CONTENT):
        col = db.create_collection(SECTION_CONTENT)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["sectionKey"])
    if not db.has_collection(PAGE_CONTENT):
        col = db.create_collection(PAGE_CONTENT)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["docId", "pageNo"])


_OUTLINE_NUM = re.compile(r"^\s*(?:chapter|part|appendix|section)?\s*(\d+(?:\.\d+)*)\s*[.:)]?\s+(.*)$", re.IGNORECASE)


def _parse_outline_number(title: str) -> tuple[str | None, str]:
    """Split a leading section number off a bookmark title: "Chapter 1. Intro" -> ("1","Intro")."""
    m = _OUTLINE_NUM.match(title or "")
    if m and m.group(2).strip():
        return m.group(1), m.group(2).strip()
    return None, (title or "").strip()


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


def persist_document(
    *,
    doc_id: str,
    title: str,
    source_filename: str,
    markdown: str,
    page_count: int,
    heading_pages: list[tuple[str, int]] | None = None,
    pages: list[tuple[int, str]] | None = None,
    outline: list[dict] | None = None,
) -> str | None:
    """Store full markdown + section blocks + page-primary blocks. Best-effort.

    ``heading_pages`` = ordered ``(heading_text, 1-based page)`` and ``pages`` =
    ``(1-based page, markdown)`` come from ``reader.convert_document``; when absent the
    document is stored without page provenance (backward compatible).
    """
    try:
        db = connect_arango()
        _ensure_collections(db)
        blocks = split_markdown_sections(markdown)

        hp = [(t, int(p)) for (t, p) in (heading_pages or [])]
        page_list = [(int(pn), md) for (pn, md) in (pages or [])]

        if hp:
            ranges = section_page_ranges(blocks, hp, page_count)
            for b in blocks:
                b.page_start, b.page_end = ranges.get(b.order, (None, None))
        page_blocks = build_page_blocks(page_list, blocks, hp, page_count) if page_list else []
        has_page_provenance = bool(page_blocks) and any(b.page_start is not None for b in blocks)
        outline_entries = normalize_outline(outline, blocks)

        docs = db.collection(DOCUMENTS)
        docs.insert(
            {
                "_key": doc_id,
                "title": title,
                "sourceFilename": source_filename,
                "markdown": markdown,
                "pageCount": page_count,
                "charCount": len(markdown),
                "sectionCount": len(blocks),
                "pageBlockCount": len(page_blocks),
                "hasPageProvenance": has_page_provenance,
                "outline": outline_entries,
                "createdAt": int(time.time()),
            },
            overwrite=True,
        )

        sc = db.collection(SECTION_CONTENT)
        sc.delete_match({"docId": doc_id})
        if blocks:
            sc.import_bulk(
                [
                    {
                        "_key": f"{doc_id}__{b.order}",
                        "docId": doc_id,
                        "sectionKey": b.section_key,
                        "heading": b.heading,
                        "level": b.level,
                        "numberKey": b.number_key,
                        "order": b.order,
                        "markdown": b.markdown,
                        "pageStart": b.page_start,
                        "pageEnd": b.page_end,
                    }
                    for b in blocks
                ],
                on_duplicate="replace",
            )

        pc = db.collection(PAGE_CONTENT)
        pc.delete_match({"docId": doc_id})
        if page_blocks:
            pc.import_bulk(
                [
                    {
                        "_key": f"{doc_id}__p{pb.page_no}",
                        "docId": doc_id,
                        "pageNo": pb.page_no,
                        "markdown": pb.markdown,
                        "charCount": len(pb.markdown),
                        "sectionPath": pb.section_path,
                        "sectionKeys": pb.section_keys,
                        "headings": pb.headings,
                    }
                    for pb in page_blocks
                ],
                on_duplicate="replace",
            )
        return doc_id
    except Exception:
        return None


def fetch_latest_document(doc_id: str | None = None) -> dict:
    """Latest stored document metadata + full markdown (or a specific id)."""
    try:
        db = connect_arango()
        if not db.has_collection(DOCUMENTS):
            return {"document": None}
        if doc_id:
            aql = "FOR d IN documents FILTER d._key == @id LIMIT 1 RETURN d"
            binds = {"id": doc_id}
        else:
            aql = "FOR d IN documents SORT d.createdAt DESC LIMIT 1 RETURN d"
            binds = {}
        rows = list(db.aql.execute(aql, bind_vars=binds))
        if not rows:
            return {"document": None}
        d = rows[0]
        return {
            "document": {
                "id": d.get("_key"),
                "title": d.get("title"),
                "sourceFilename": d.get("sourceFilename"),
                "markdown": d.get("markdown", ""),
                "pageCount": d.get("pageCount", 0),
                "charCount": d.get("charCount", 0),
                "sectionCount": d.get("sectionCount", 0),
                "pageBlockCount": d.get("pageBlockCount", 0),
                "hasPageProvenance": d.get("hasPageProvenance", False),
                "outline": d.get("outline", []),
                "createdAt": d.get("createdAt", 0),
            }
        }
    except Exception as exc:
        return {"document": None, "error": str(exc)}


def fetch_section_content(section_key: str, doc_id: str | None = None) -> dict:
    """Markdown for a section, including its descendant sub-sections, ordered.

    Mirrors ``isAncestorSectionKey`` so requesting ``toc:1`` returns 1 plus 1.x. The
    response resolves the section's page coordinates (``pageStart``/``pageEnd``) as the
    min/max across the matched blocks — the "section 3 → pages X–Y" drill-down answer.
    """
    try:
        db = connect_arango()
        if not db.has_collection(SECTION_CONTENT):
            return {"sectionKey": section_key, "blocks": [], "markdown": ""}

        if doc_id is None:
            latest = fetch_latest_document()
            doc = latest.get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"sectionKey": section_key, "blocks": [], "markdown": ""}

        aql = """
        FOR b IN section_content
          FILTER b.docId == @docId
          SORT b.order
          RETURN b
        """
        rows = list(db.aql.execute(aql, bind_vars={"docId": doc_id}))
        matched = [r for r in rows if is_ancestor_section_key(section_key, r.get("sectionKey", ""))]
        blocks = [
            {
                "sectionKey": r.get("sectionKey"),
                "heading": r.get("heading"),
                "level": r.get("level"),
                "order": r.get("order"),
                "pageStart": r.get("pageStart"),
                "pageEnd": r.get("pageEnd"),
            }
            for r in matched
        ]
        markdown = "\n\n".join(r.get("markdown", "") for r in matched if r.get("markdown"))
        starts = [r.get("pageStart") for r in matched if r.get("pageStart") is not None]
        ends = [r.get("pageEnd") for r in matched if r.get("pageEnd") is not None]
        return {
            "sectionKey": section_key,
            "docId": doc_id,
            "blocks": blocks,
            "markdown": markdown,
            "pageStart": min(starts) if starts else None,
            "pageEnd": max(ends) if ends else None,
        }
    except Exception as exc:
        return {"sectionKey": section_key, "blocks": [], "markdown": "", "error": str(exc)}


def fetch_page(page_no: int, doc_id: str | None = None) -> dict:
    """A single page's content + its section coordinate trail (page-primary read)."""
    try:
        db = connect_arango()
        if not db.has_collection(PAGE_CONTENT):
            return {"page": None}
        if doc_id is None:
            latest = fetch_latest_document()
            doc = latest.get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"page": None}
        rows = list(
            db.aql.execute(
                "FOR p IN page_content FILTER p.docId == @d AND p.pageNo == @n LIMIT 1 RETURN p",
                bind_vars={"d": doc_id, "n": int(page_no)},
            )
        )
        if not rows:
            return {"page": None}
        p = rows[0]
        return {
            "page": {
                "docId": doc_id,
                "pageNo": p.get("pageNo"),
                "markdown": p.get("markdown", ""),
                "sectionPath": p.get("sectionPath", []),
                "sectionKeys": p.get("sectionKeys", []),
                "headings": p.get("headings", []),
            }
        }
    except Exception as exc:
        return {"page": None, "error": str(exc)}
````

## File: assets/deploy/services/learn/app/arango_learn.py
````python
"""AQL helpers for graph-grounded study (flashcards, quiz, Socratic context)."""

from __future__ import annotations

import hashlib
import os
from typing import Any

from arango.exceptions import ArangoError

from app.arango_tree import (
    HIERARCHY_PREDICATE,
    MENTIONS_PREDICATE,
    connect_arango,
    fetch_section_mentions_by_section,
)

DEFAULT_SKIP_PREDICATES = (HIERARCHY_PREDICATE, MENTIONS_PREDICATE)
MAX_EDGES_SECTION = 200
MAX_EDGES_SAMPLE = 400

# --- Read-time noise filter --------------------------------------------------
# Automatic extraction over running prose produces triples that are syntactically
# valid but useless to *study* from: pronoun/deictic subjects ("we", "this
# chapter"), page-number/layout artifacts, and bibliographic citations. They make
# flashcards like "Subject: we — what predicate relates this to «...»?" and pad
# quizzes with un-answerable noise. We drop them at the single chokepoint every
# triple query passes through, so decks, quizzes, section-stats and the Socratic
# tutor all see the cleaned set. Disable with LEARN_FILTER_NOISE=0 to A/B.
FILTER_NOISE = os.getenv("LEARN_FILTER_NOISE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "",
)

# Bare pronouns / deictic references — never standalone knowledge as a triple end.
_PRONOUN_ENDPOINTS = frozenset(
    {
        "we", "i", "it", "they", "there", "this", "that", "he", "she", "you",
        "these", "those", "one", "them", "us",
        "this chapter", "this section", "this book", "the chapter", "the section",
        "the book", "the author", "the authors", "the following",
    }
)

# Predicate marks bibliographic / page-layout noise rather than real knowledge.
_NOISE_PREDICATE_SUBSTRINGS = ("page number",)


def _is_noise_triple(s: str, p: str, o: str) -> bool:
    """True when a triple is an extraction artifact, not studyable knowledge."""
    if s.lower() in _PRONOUN_ENDPOINTS or o.lower() in _PRONOUN_ENDPOINTS:
        return True
    pl = p.lower().replace("_", " ")
    if any(sub in pl for sub in _NOISE_PREDICATE_SUBSTRINGS):
        return True
    # Bibliographic citations: "published", "published in", "published_in".
    if pl.startswith("publish"):
        return True
    return False


def _triple_rows_from_cursor(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for r in rows:
        s = (r.get("subject") or "").strip()
        p = (r.get("predicate") or "").strip()
        o = (r.get("object") or "").strip()
        if not (s and p and o):
            continue
        if FILTER_NOISE and _is_noise_triple(s, p, o):
            continue
        out.append({"subject": s, "predicate": p, "object": o})
    return out


def sample_triples(
    limit: int = 50,
    skip_predicates: tuple[str, ...] | None = DEFAULT_SKIP_PREDICATES,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Random triples from relationships (structural predicates skipped by default)."""
    db = connect_arango()
    skip = list(skip_predicates or ())
    aql = """
    FOR edge IN relationships
      FILTER @doc == null OR @doc IN NOT_NULL(edge.docIds, [])
      FILTER LENGTH(@skip) == 0 OR edge.type NOT IN @skip
      LET s = DOCUMENT(edge._from)
      LET t = DOCUMENT(edge._to)
      FILTER s != null AND t != null
      SORT RAND()
      LIMIT @limit
      RETURN { subject: s.name, predicate: edge.type, object: t.name }
    """
    cur = db.aql.execute(
        aql, bind_vars={"limit": min(limit, MAX_EDGES_SAMPLE), "skip": skip, "doc": doc}
    )
    return _triple_rows_from_cursor(list(cur))


def triples_for_section(
    section_name: str,
    limit: int = MAX_EDGES_SECTION,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Edges touching the section entity, capped (includes structural + content)."""
    db = connect_arango()
    aql = """
    FOR v IN entities
      FILTER v.name == @section
      LIMIT 1
      FOR edge IN relationships
        FILTER edge._from == v._id OR edge._to == v._id
        FILTER @doc == null OR @doc IN NOT_NULL(edge.docIds, [])
        LIMIT @limit
        LET s = DOCUMENT(edge._from)
        LET t = DOCUMENT(edge._to)
        FILTER s != null AND t != null
        RETURN { subject: s.name, predicate: edge.type, object: t.name }
    """
    cur = db.aql.execute(
        aql,
        bind_vars={"section": section_name, "limit": min(limit, MAX_EDGES_SECTION), "doc": doc},
    )
    return _triple_rows_from_cursor(list(cur))


def content_triples_for_section(
    section_name: str,
    limit: int = MAX_EDGES_SECTION,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Content triples whose subject OR object is an entity mentioned in the section.

    Unlike ``triples_for_section`` (which returns edges touching the TOC node itself,
    mostly structural), this resolves the section's ``section_mentions`` entities and
    fetches real content triples among them — the actual knowledge to test.
    """
    db = connect_arango()
    mentions = fetch_section_mentions_by_section(db, doc)
    names = mentions.get(section_name.strip(), [])
    if not names:
        return []
    aql = """
    FOR edge IN relationships
      FILTER @doc == null OR @doc IN NOT_NULL(edge.docIds, [])
      FILTER edge.type NOT IN @skip
      LET s = DOCUMENT(edge._from)
      LET t = DOCUMENT(edge._to)
      FILTER s != null AND t != null
      FILTER s.name IN @names OR t.name IN @names
      LIMIT @limit
      RETURN { subject: s.name, predicate: edge.type, object: t.name }
    """
    cur = db.aql.execute(
        aql,
        bind_vars={
            "names": names,
            "skip": list(DEFAULT_SKIP_PREDICATES),
            "limit": min(limit, MAX_EDGES_SECTION),
            "doc": doc,
        },
    )
    return _triple_rows_from_cursor(list(cur))


def triples_for_study_scope(
    scope: str | None,
    limit: int = 50,
    include_structural: bool = False,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Triples for a TOC section name, or global random sample.

    For a section scope we want the *content* triples among the entities the
    section mentions. Edges touching the TOC node itself are purely structural
    (``has_subsection`` / ``section_mentions``), so the old query — fetch those
    edges, then drop structural predicates — left ~0 triples for every section.
    That made the section panel show "0 triples / 0 entities", left flashcard
    decks empty, and starved the Socratic tutor of context, even though the
    quiz worked (it already used the content path). Mirror that path here:
    resolve content triples first, and fall back to the TOC-node edges only
    when there are none, or when structural triples are explicitly requested.
    """
    skip: tuple[str, ...] = () if include_structural else DEFAULT_SKIP_PREDICATES
    if scope and scope.strip():
        if not include_structural:
            content = content_triples_for_section(
                scope.strip(), limit=max(limit, MAX_EDGES_SECTION), doc=doc
            )
            if content:
                return content[:limit] if len(content) > limit else content
        rows = triples_for_section(scope.strip(), limit=max(limit, 200), doc=doc)
        if not include_structural:
            rows = [r for r in rows if r["predicate"] not in DEFAULT_SKIP_PREDICATES]
        return rows[:limit] if len(rows) > limit else rows
    return sample_triples(limit=limit, skip_predicates=skip if skip else (), doc=doc)


def triples_for_exam_scope(
    scope: str | None,
    limit: int = 200,
    include_structural: bool = False,
    doc: str | None = None,
) -> list[dict[str, str]]:
    """Exam-grade triple selection.

    For a TOC section, prefer content triples among the section's mentioned
    entities; fall back to the generic scope query when that yields nothing
    (e.g. no section_mentions). For a null scope, a global random sample.
    """
    if scope and scope.strip():
        rows = content_triples_for_section(
            scope.strip(), limit=max(limit, MAX_EDGES_SECTION), doc=doc
        )
        if rows:
            return rows[:limit] if len(rows) > limit else rows
    return triples_for_study_scope(
        scope, limit=limit, include_structural=include_structural, doc=doc
    )


def entity_distractor_pool(triples: list[dict[str, str]], exclude: set[str]) -> list[str]:
    """Distinct entity strings from subjects/objects for MCQ distractors."""
    pool: set[str] = set()
    for t in triples:
        pool.add(t["subject"])
        pool.add(t["object"])
    pool -= exclude
    return sorted(pool, key=str.casefold)


def predicate_distractor_pool(triples: list[dict[str, str]], exclude: set[str]) -> list[str]:
    """Distinct predicate strings for predicate-style MCQ distractors."""
    pool: set[str] = set()
    for t in triples:
        pool.add(t["predicate"])
    pool -= exclude
    return sorted(pool, key=str.casefold)


def triple_line(t: dict[str, str]) -> str:
    return f'{t["subject"]} | {t["predicate"]} | {t["object"]}'


def triple_id(t: dict[str, str]) -> str:
    return hashlib.sha256(triple_line(t).encode()).hexdigest()[:16]


def format_triples_block(triples: list[dict[str, str]], max_lines: int = 120) -> str:
    lines = [triple_line(t) for t in triples[:max_lines]]
    body = "\n".join(lines)
    if len(triples) > max_lines:
        body += f"\n... ({len(triples) - max_lines} more triples omitted)"
    return body


def fetch_triples_or_error(
    scope: str | None, limit: int, include_structural: bool, doc: str | None = None
) -> tuple[list[dict[str, str]], str | None]:
    try:
        return (
            triples_for_study_scope(
                scope, limit=limit, include_structural=include_structural, doc=doc
            ),
            None,
        )
    except ArangoError as e:
        return [], str(e)
    except Exception as e:
        return [], str(e)


def fetch_exam_triples_or_error(
    scope: str | None, limit: int, include_structural: bool, doc: str | None = None
) -> tuple[list[dict[str, str]], str | None]:
    try:
        return (
            triples_for_exam_scope(
                scope, limit=limit, include_structural=include_structural, doc=doc
            ),
            None,
        )
    except ArangoError as e:
        return [], str(e)
    except Exception as e:
        return [], str(e)
````

## File: assets/deploy/services/learn/app/arango_tree.py
````python
"""Fetch TOC hierarchy (has_subsection) from ArangoDB and build a nested tree."""

from __future__ import annotations

import html
import os
import re
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from arango import ArangoClient
from arango.database import StandardDatabase
from arango.exceptions import ArangoError

# Matches TOC_SUBSECTION_PREDICATE / SECTION_MENTIONS_PREDICATE in toc-processing.ts
HIERARCHY_PREDICATE = "has_subsection"
MENTIONS_PREDICATE = "section_mentions"


@dataclass
class TreeNode:
    """JSON-serializable tree node."""

    id: str
    label: str
    title: str | None = None
    children: list[TreeNode] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        is_section = (self.id or "").startswith("toc:")
        return {
            "id": self.id,
            "label": self.label,
            "title": self.title if is_section else None,
            "sectionKey": self.id if is_section else None,
            "isSection": is_section,
            "children": [c.as_dict() for c in self.children],
        }


# Per-request database override (multi-tenancy). Set from the X-User-Db header
# by middleware in main.py; falls back to the env default when absent.
_REQUEST_DB_NAME: ContextVar[str | None] = ContextVar("request_db_name", default=None)
_DB_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def set_request_db_name(db_name: str | None) -> None:
    if db_name and not _DB_NAME_RE.match(db_name):
        db_name = None
    _REQUEST_DB_NAME.set(db_name)


def _get_db() -> StandardDatabase:
    url = (os.environ.get("ARANGODB_URL") or "http://localhost:8529").rstrip("/")
    db_name = _REQUEST_DB_NAME.get() or os.environ.get("ARANGODB_DB") or "txt2kg"
    user = os.environ.get("ARANGODB_USER") or "root"
    password = os.environ.get("ARANGODB_PASSWORD") or ""
    client = ArangoClient(hosts=url)
    return client.db(db_name, username=user, password=password)


TOC_NUMERIC = re.compile(r"^toc:(\d+(?:\.\d+)*)$")


def _toc_sort_key(name: str) -> tuple:
    """Sort toc:1.2 before toc:1.10 lexicographically."""
    if name == "toc:root":
        return (-1,)
    m = TOC_NUMERIC.match(name or "")
    if m:
        return tuple(int(p) for p in m.group(1).split("."))
    return (10_000, name or "")


def fetch_has_subsection_edges(
    db: StandardDatabase, doc: str | None = None
) -> list[dict[str, str]]:
    aql = """
    FOR edge IN relationships
      FILTER edge.type == @pred
      FILTER @doc == null OR @doc IN NOT_NULL(edge.docIds, [])
      LET parent = DOCUMENT(edge._from)
      LET child = DOCUMENT(edge._to)
      FILTER parent != null AND child != null
      RETURN {
        parentKey: parent._key,
        parentName: parent.name,
        childKey: child._key,
        childName: child.name
      }
    """
    cursor = db.aql.execute(aql, bind_vars={"pred": HIERARCHY_PREDICATE, "doc": doc})
    return list(cursor)


def fetch_section_mentions_by_section(
    db: StandardDatabase, doc: str | None = None
) -> dict[str, list[str]]:
    """section entity name -> sorted unique mentioned entity names."""
    aql = """
    FOR edge IN relationships
      FILTER edge.type == @pred
      FILTER @doc == null OR @doc IN NOT_NULL(edge.docIds, [])
      LET sec = DOCUMENT(edge._from)
      LET ent = DOCUMENT(edge._to)
      FILTER sec != null AND ent != null
      RETURN { sectionName: sec.name, entityName: ent.name }
    """
    cursor = db.aql.execute(aql, bind_vars={"pred": MENTIONS_PREDICATE, "doc": doc})
    by_section: dict[str, set[str]] = {}
    for row in cursor:
        sec = (row.get("sectionName") or "").strip()
        ent = (row.get("entityName") or "").strip()
        if not sec or not ent:
            continue
        by_section.setdefault(sec, set()).add(ent)
    return {k: sorted(v, key=str.casefold) for k, v in by_section.items()}


def _resolve_section_doc_id(db: StandardDatabase) -> str | None:
    """``_key`` of the most recently ingested document (section_content scope).

    section_content.docId is the learn-service convert-pdf UUID, a different id
    namespace from the frontend doc id used on KG edges — so titles are scoped to
    the latest ingested document rather than joined by the edge doc id.
    """
    if not db.has_collection("documents"):
        return None
    rows = list(
        db.aql.execute("FOR d IN documents SORT d.createdAt DESC LIMIT 1 RETURN d._key")
    )
    return rows[0] if rows else None


# Headings that are chapter labels / front-matter, not the chapter's real title.
_CHAPTER_LABEL_RE = re.compile(r"^\s*(chapter|part|appendix|section)\b", re.IGNORECASE)
_FRONTMATTER_RE = re.compile(
    r"^\s*(contents|table of contents|preface|foreword|index|bibliography|"
    r"references|acknowledg|epigraph|dedication)",
    re.IGNORECASE,
)


def _is_bare_chapter_number(heading: str, chapter: int) -> bool:
    """True for a heading that is just the chapter number (e.g. ``1`` or ``1.``)."""
    return bool(re.match(rf"^\s*{chapter}\s*[.:)\-–—]?\s*$", heading))


def _chapter_titles(blocks: list[dict[str, Any]]) -> dict[str, str]:
    """Map numeric chapter keys (``toc:N``) to a human title.

    The KG hierarchy keys chapters by number, but the converted markdown stores the
    chapter heading under a *slug* key (e.g. ``toc:introduction-...``) just before the
    chapter's first numbered subsection. For each chapter we take the last "real"
    slug heading appearing before that first numbered block (skipping ``CHAPTER N``
    labels and front-matter). ``blocks`` must be ordered by ``order`` ascending.
    """
    chapter_first: dict[int, int] = {}
    for b in blocks:
        m = TOC_NUMERIC.match(b["key"])
        if not m:
            continue
        chapter = int(m.group(1).split(".")[0])
        if chapter not in chapter_first or b["order"] < chapter_first[chapter]:
            chapter_first[chapter] = b["order"]

    titles: dict[str, str] = {}
    ordered = sorted(chapter_first)
    for idx, chapter in enumerate(ordered):
        start = chapter_first[chapter]
        prev_start = chapter_first[ordered[idx - 1]] if idx > 0 else -1
        candidate: str | None = None
        for b in blocks:
            if not (prev_start < b["order"] < start):
                continue
            if TOC_NUMERIC.match(b["key"]):
                continue  # numbered, not a chapter-title slug
            heading = b["heading"]
            if _CHAPTER_LABEL_RE.match(heading) or _FRONTMATTER_RE.match(heading):
                continue
            candidate = heading  # keep the last (closest to the chapter start)
        if candidate:
            titles[f"toc:{chapter}"] = candidate
    return titles


def fetch_section_titles(
    db: StandardDatabase, doc_id: str | None = None
) -> dict[str, str]:
    """sectionKey -> human heading, scoped to one document's section_content.

    Scoping to a single document stops titles from bleeding across books that share
    ``toc:N.N`` keys (the previous all-docs query picked an arbitrary book's heading).
    ``doc_id`` is a section_content docId; when omitted the most recently ingested
    document is used. Numbered nodes get their own heading; chapter nodes (``toc:N``),
    which the markdown keys by slug, are backfilled via ``_chapter_titles``.
    """
    if not db.has_collection("section_content"):
        return {}
    if doc_id is None:
        doc_id = _resolve_section_doc_id(db)
    if not doc_id:
        return {}

    aql = """
    FOR b IN section_content
      FILTER b.docId == @doc AND b.heading != null AND b.heading != ""
      SORT b.order
      RETURN { key: b.sectionKey, heading: b.heading, order: b.order }
    """
    blocks = [
        {
            "key": row.get("key"),
            "heading": (row.get("heading") or "").strip(),
            "order": row.get("order") or 0,
        }
        for row in db.aql.execute(aql, bind_vars={"doc": doc_id})
    ]
    blocks = [b for b in blocks if b["key"] and b["heading"]]

    out: dict[str, str] = {}
    for b in blocks:
        if b["key"].startswith("toc:") and b["key"] not in out:
            out[b["key"]] = b["heading"]

    # Backfill chapter-level nodes (toc:N), overriding a bare-number heading.
    for key, title in _chapter_titles(blocks).items():
        chapter = int(key.split(":")[1])
        existing = out.get(key)
        if not existing or _is_bare_chapter_number(existing, chapter):
            out[key] = title
    return out


def apply_section_titles(roots: list[TreeNode], titles_by_key: dict[str, str]) -> None:
    """Attach the human heading to each section node (pre-order, in place)."""

    def visit(node: TreeNode) -> None:
        if (node.id or "").startswith("toc:"):
            heading = titles_by_key.get(node.id)
            if heading:
                node.title = heading
        for child in node.children:
            visit(child)

    for root in roots:
        visit(root)


def enrich_tree_with_section_mentions(
    roots: list[TreeNode], mentions_by_section: dict[str, list[str]]
) -> None:
    """Append each section's mentioned entities as leaf nodes (post-order on structure)."""

    def visit(node: TreeNode) -> None:
        for child in node.children:
            visit(child)
        for entity in mentions_by_section.get(node.label, []):
            node.children.append(TreeNode(id=entity, label=entity, children=[]))

    for root in roots:
        visit(root)


def build_nested_tree(edges: list[dict[str, str]]) -> list[TreeNode]:
    """Build a forest from flat parent/child rows; multiple roots if disconnected."""
    if not edges:
        return []

    children_by_parent: dict[str, list[str]] = {}
    all_names: set[str] = set()
    child_names: set[str] = set()

    for row in edges:
        p = row.get("parentName") or ""
        c = row.get("childName") or ""
        if not p or not c:
            continue
        all_names.add(p)
        all_names.add(c)
        child_names.add(c)
        children_by_parent.setdefault(p, []).append(c)

    for p in children_by_parent:
        children_by_parent[p] = sorted(set(children_by_parent[p]), key=_toc_sort_key)

    roots = sorted(all_names - child_names, key=_toc_sort_key)

    if not roots:
        return []

    def walk(name: str, path: frozenset[str]) -> TreeNode:
        if name in path:
            return TreeNode(id=name, label=f"{name} (cycle)", children=[])
        next_path = path | {name}
        node = TreeNode(id=name, label=name)
        for ch in children_by_parent.get(name, []):
            node.children.append(walk(ch, next_path))
        return node

    return [walk(r, frozenset()) for r in roots]


def render_toc_tree_html(forest: list[dict[str, Any]]) -> str:
    """Build nested <ul> HTML (escaped); avoids Jinja recursive macros."""

    def walk(nodes: list[dict[str, Any]]) -> str:
        if not nodes:
            return ""
        parts: list[str] = ['<ul class="toc-tree">']
        for node in nodes:
            raw_label = str(node.get("label", ""))
            label = html.escape(raw_label)
            css = (
                "node-label toc-node"
                if raw_label.startswith("toc:")
                else "node-label entity-leaf"
            )
            parts.append(f'<li><span class="{css}">{label}</span>')
            children = node.get("children")
            if isinstance(children, list) and len(children) > 0:
                parts.append(walk(children))
            parts.append("</li>")
        parts.append("</ul>")
        return "".join(parts)

    return walk(forest)


def get_toc_tree(doc: str | None = None) -> tuple[list[dict[str, Any]], int, str | None, int]:
    """
    Returns (forest_as_dicts, hierarchy_edge_count, error_message, mention_edge_count).
    Tree = has_subsection structure plus section_mentions entities under each section node.
    When ``doc`` is given, only edges/content tagged with that document id are used.
    """
    try:
        db = _get_db()
        edges = fetch_has_subsection_edges(db, doc)
        mentions_by_section = fetch_section_mentions_by_section(db, doc)
        titles_by_key = fetch_section_titles(db)
    except ArangoError as e:
        return [], 0, str(e), 0
    except OSError as e:
        return [], 0, str(e), 0
    except Exception as e:
        return [], 0, str(e), 0

    mention_edge_count = sum(len(v) for v in mentions_by_section.values())
    forest_nodes = build_nested_tree(edges)
    apply_section_titles(forest_nodes, titles_by_key)
    enrich_tree_with_section_mentions(forest_nodes, mentions_by_section)
    return [n.as_dict() for n in forest_nodes], len(edges), None, mention_edge_count


def connect_arango() -> StandardDatabase:
    """Return database handle for other learn modules (e.g. study / AQL)."""
    return _get_db()
````

## File: assets/deploy/services/learn/app/concept_resolve.py
````python
"""Within-document concept resolution: merge duplicate concepts (the same idea taught or
referenced across several sections) into ONE canonical concept by embedding similarity.

Non-destructive: every concept row gets a ``canonicalKey`` (the representative's ``_key``;
the representative points to itself). Reads group by ``canonicalKey``; all section/page
provenance is kept. Degrades to a no-op (each concept canonical to itself) when the embedding
service is unavailable, so extraction never hard-breaks.

Reuses the already-running GPU ``sentence-transformers`` service (MiniLM) via ``/embed``.
The clustering is a pure, unit-testable function; only ``embed_texts`` and the DB write touch
the outside world.
"""

from __future__ import annotations

import json
import math
import os
import re
import urllib.request

# The embedding service is reachable by compose hostname even though the learn container has
# no env var for it (verified: learn -> http://sentence-transformers:80/health = 200).
_EMBED_URL = (os.environ.get("SENTENCE_TRANSFORMER_URL") or "http://sentence-transformers:80").rstrip("/")
_DEFAULT_SIM = float(os.environ.get("LEARN_CONCEPT_SIM", "0.85"))

_ALPHA = re.compile(r"[a-z]")

# Generic words that don't distinguish one concept from another — ignored when comparing names
# so "Decomposition Axiom" vs "Intersection Axiom" compare as {decomposition} vs {intersection}.
_GENERIC_NAME_TOKENS = {
    "axiom", "theorem", "rule", "law", "principle", "definition", "lemma", "corollary",
    "proposition", "property", "method", "result", "notation", "the", "of", "a", "an",
    "for", "and", "to", "in", "on", "s",
}


def _alpha_len(name: str) -> int:
    return len(_ALPHA.findall((name or "").lower()))


def is_notation(name: str) -> bool:
    """A name that is essentially a single letter / short notation (X, Z, P, σ) is too
    polysemous to merge on — the X/Y/Z guard from the prerequisite-learning literature."""
    return _alpha_len(name) <= 2


def _sig_tokens(name: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", (name or "").lower()) if t not in _GENERIC_NAME_TOKENS and len(t) > 1}


def names_compatible(a: str, b: str) -> bool:
    """True unless the two names carry DIFFERENT distinctive words. Blocks merging distinct
    same-kind concepts with similar signals (Decomposition vs Intersection axiom); allows true
    duplicates, which the extractor canonicalises to the same/overlapping name. Falls back to
    permissive when a name has no distinctive token (rely on the embedding then)."""
    ta, tb = _sig_tokens(a), _sig_tokens(b)
    if not ta or not tb:
        return True
    return bool(ta & tb) or ta <= tb or tb <= ta


def embed_texts(texts: list[str], timeout: int = 60) -> list[list[float]] | None:
    """POST to the sentence-transformers ``/embed`` endpoint. Returns the embeddings, or
    ``None`` if the service is unreachable (caller then degrades to no dedup)."""
    if not texts:
        return []
    try:
        req = urllib.request.Request(
            f"{_EMBED_URL}/embed",
            data=json.dumps({"texts": texts}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp).get("embeddings")
    except Exception:  # noqa: BLE001 — any failure = degrade, never break extraction
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def cluster_duplicates(
    concepts: list[dict],
    embeddings: list[list[float]],
    ranks: dict[str, int],
    threshold: float,
) -> dict[str, str]:
    """Pure: union concepts whose embeddings are >= ``threshold`` AND share a ``kind`` AND are
    not bare notation; return ``{concept_key: canonical_key}``. The canonical representative of
    a group is a ``definition`` if present, else the earliest in reading order, else the one
    with the fullest signal."""
    keys = [c["key"] for c in concepts]
    parent = {k: k for k in keys}

    def find(x: str) -> str:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:  # path compression
            parent[x], x = root, parent[x]
        return root

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    n = len(concepts)
    for i in range(n):
        for j in range(i + 1, n):
            ci, cj = concepts[i], concepts[j]
            if ci["kind"] != cj["kind"]:
                continue
            if is_notation(ci["name"]) or is_notation(cj["name"]):
                continue
            if not names_compatible(ci["name"], cj["name"]):
                continue
            if _cosine(embeddings[i], embeddings[j]) >= threshold:
                union(ci["key"], cj["key"])

    groups: dict[str, list[dict]] = {}
    for c in concepts:
        groups.setdefault(find(c["key"]), []).append(c)

    canonical: dict[str, str] = {}
    for members in groups.values():
        rep = min(
            members,
            key=lambda c: (
                0 if c.get("kind") == "definition" else 1,
                ranks.get(c["key"], 1_000_000),
                -len(c.get("signal") or ""),
            ),
        )
        for c in members:
            canonical[c["key"]] = rep["key"]
    return canonical


def _write_canonical(db, canonical: dict[str, str]) -> None:
    items = [{"key": k, "canon": v} for k, v in canonical.items()]
    if not items:
        return
    db.aql.execute(
        "FOR it IN @items UPDATE it.key WITH { canonicalKey: it.canon } IN concepts",
        bind_vars={"items": items},
    )


def resolve_concepts_document(
    db, doc_id: str, ranks: dict[str, int] | None = None, threshold: float | None = None
) -> dict:
    """Tag every concept of a document with a ``canonicalKey`` (within-document dedup).
    Idempotent and re-runnable. If the embedding service is down, each concept is made
    canonical to itself (no merges) so extraction still completes."""
    threshold = _DEFAULT_SIM if threshold is None else threshold
    ranks = ranks or {}
    rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d "
            "RETURN {key: c._key, name: c.name, kind: c.kind, signal: c.signal}",
            bind_vars={"d": doc_id},
        )
    )
    if not rows:
        return {"concepts": 0, "canonical": 0, "merged": 0, "embedded": False}

    texts = [f"{r['name']}: {r.get('signal') or ''}" for r in rows]
    embeddings = embed_texts(texts)
    if not embeddings or len(embeddings) != len(rows):
        _write_canonical(db, {r["key"]: r["key"] for r in rows})
        return {"concepts": len(rows), "canonical": len(rows), "merged": 0, "embedded": False}

    canonical = cluster_duplicates(rows, embeddings, ranks, threshold)
    _write_canonical(db, canonical)
    n_canon = len(set(canonical.values()))
    return {
        "concepts": len(rows),
        "canonical": n_canon,
        "merged": len(rows) - n_canon,
        "embedded": True,
    }
````

## File: assets/deploy/services/learn/app/concepts_extract.py
````python
"""Concept-course extraction: turn a section of text into atomic concept-lessons.

The product is a *course*, not a triple graph. Each concept is one learnable idea
(definition / theorem / principle / result / method) carrying a self-contained lesson:
``signal`` (distilled explanation), ``source`` (verbatim passage), ``questions``
(retrieval practice) and ``prereqNames`` (concepts to learn first). Concepts link by a
``concept_prereq`` edge into a learning path.

Reuses the extraction engine from ``app.extract`` (section loading + chapter scope, the
domain-aware user prompt, the per-section model, structured-output transport, the
structural ``has_subsection`` edges) and only swaps the schema / system prompt / write
target. The pure parse/assemble/key/prereq functions are unit-tested without LLM or DB.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import time
from dataclasses import dataclass

from app.arango_content import fetch_latest_document
from app.arango_tree import connect_arango
from app.extract import (
    _domain,
    _extract_model,
    _load_section_blocks,
    _norm_part,
    normalize_entity,
    structural_subsection_triples,
    upsert_structural_edges,
)
from app.llm import ollama_structured_completion

CONCEPTS = "concepts"
CONCEPT_PREREQ = "concept_prereq"

_KINDS = ("definition", "theorem", "principle", "result", "method")

# Grounding gate: a concept with no verbatim source_sentence is almost always manufactured
# from motivational/narrative prose (the observed failure mode). Requiring grounding doubles
# as the domain-specificity filter. Disable with LEARN_REQUIRE_SOURCE=0 to A/B.
_REQUIRE_SOURCE = os.environ.get("LEARN_REQUIRE_SOURCE", "1") != "0"

CONCEPT_SYSTEM_PROMPT = (
    "You are building a self-study course from {domain}. From ONE section of the text, "
    "extract each ATOMIC CONCEPT the section TEACHES — a single definition, theorem, "
    "principle, result, or method — and write a self-contained mini-lesson for each.\n\n"
    "For every concept give:\n"
    "- name: a short canonical name (noun phrase, e.g. \"d-separation\", \"Bayes' rule\").\n"
    "- kind: one of definition | theorem | principle | result | method.\n"
    "- signal: a distilled, self-contained explanation in 1-3 sentences — exactly what a "
    "learner needs to know. No \"this\", \"it\", \"we\", \"the author\", no section/page "
    "references; name every concept in full.\n"
    "- source_sentence: the verbatim sentence(s) from the text that state the concept.\n"
    "- questions: 1-3 short retrieval-practice questions with answers, suited to the kind "
    "(definition -> state or recognise it; theorem/result -> its statement or when it "
    "applies; method -> the procedure; principle -> a 'why'). A question must not contain "
    "its own answer.\n"
    "- prerequisites: canonical names of other concepts a learner must understand first.\n\n"
    "Rules:\n"
    "- One concept per atomic idea; never pack two ideas into one.\n"
    "- Extract only real concepts the section TEACHES; skip motivational, narrative, and "
    "historical prose. Always set source_sentence to the verbatim sentence stating the "
    "concept.\n"
    "- Do not invent anything not stated. Canonicalize names (collapse variants to one).\n"
    "- Return ONLY data conforming to the schema."
)

CONCEPT_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "concepts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "kind": {"type": "string", "enum": list(_KINDS)},
                    "signal": {"type": "string"},
                    "source_sentence": {"type": "string"},
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"q": {"type": "string"}, "a": {"type": "string"}},
                            "required": ["q", "a"],
                        },
                    },
                    "prerequisites": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "kind", "signal", "questions"],
            },
        }
    },
    "required": ["concepts"],
}


# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class ConceptQuestion:
    q: str
    a: str


@dataclass(frozen=True)
class ExtractedConcept:
    name: str
    kind: str
    signal: str
    source: str
    questions: tuple[ConceptQuestion, ...]
    prereq_names: tuple[str, ...]


@dataclass(frozen=True)
class SectionConcepts:
    doc_id: str
    section_key: str
    page_start: int | None
    page_end: int | None
    concepts: tuple[ExtractedConcept, ...]


# --------------------------------------------------------------------------- #
# Pure functions (unit-testable)
# --------------------------------------------------------------------------- #

def build_concept_system_prompt() -> str:
    return CONCEPT_SYSTEM_PROMPT.format(domain=_domain())


def normalize_concept_name(name: object) -> str:
    return normalize_entity(name)


def _name_norm(name: str) -> str:
    return normalize_concept_name(name).lower()


def parse_concepts_response(obj: object) -> list[ExtractedConcept]:
    """Validate the model's structured output into concepts (drop malformed)."""
    if not isinstance(obj, dict):
        return []
    items = obj.get("concepts")
    if not isinstance(items, list):
        return []
    out: list[ExtractedConcept] = []
    for c in items:
        if not isinstance(c, dict):
            continue
        name = normalize_concept_name(c.get("name"))
        signal = _norm_part(c.get("signal"))
        if not name or not signal:
            continue
        source = _norm_part(c.get("source_sentence"))
        if _REQUIRE_SOURCE and not source:
            continue  # ungrounded -> almost always prose/narrative noise (domain-specificity gate)
        kind = str(c.get("kind") or "").strip().lower()
        if kind not in _KINDS:
            kind = "result"
        questions: list[ConceptQuestion] = []
        for q in c.get("questions") or []:
            if isinstance(q, dict):
                qq, aa = _norm_part(q.get("q")), _norm_part(q.get("a"))
                if qq and aa:
                    questions.append(ConceptQuestion(q=qq, a=aa))
        prereqs = []
        seen: set[str] = set()
        for p in c.get("prerequisites") or []:
            pn = normalize_concept_name(p)
            if pn and pn.lower() not in seen and pn.lower() != name.lower():
                seen.add(pn.lower())
                prereqs.append(pn)
        out.append(
            ExtractedConcept(
                name=name,
                kind=kind,
                signal=signal,
                source=source,
                questions=tuple(questions),
                prereq_names=tuple(prereqs),
            )
        )
    return out


def assemble_section_concepts(
    doc_id: str, section_key: str, page_start: int | None, page_end: int | None,
    concepts: list[ExtractedConcept],
) -> SectionConcepts:
    return SectionConcepts(
        doc_id=doc_id,
        section_key=section_key,
        page_start=page_start,
        page_end=page_end,
        concepts=tuple(concepts),
    )


def concept_key(doc_id: str, section_key: str, name: str) -> str:
    return hashlib.sha256(f"{doc_id}|{section_key}|{name.lower()}".encode()).hexdigest()[:16]


def resolve_prereq_pairs(
    concepts: list[tuple[str, str, list[str]]]
) -> list[tuple[str, str]]:
    """``concepts`` = ``(key, name, prereq_names)`` for all of a document's concepts.
    Returns ``(from_key, to_key)`` prerequisite pairs for names that resolve to a concept
    (unresolved prereq names are dropped, not invented). ``from`` requires ``to``."""
    by_name: dict[str, str] = {}
    for key, name, _prereqs in concepts:
        by_name.setdefault(_name_norm(name), key)
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for key, _name, prereqs in concepts:
        for pn in prereqs:
            to = by_name.get(_name_norm(pn))
            if to and to != key and (key, to) not in seen:
                seen.add((key, to))
                pairs.append((key, to))
    return pairs


def orient_prereq_edges(
    pairs: list[tuple[str, str]],
    ranks: dict[str, int],
    texts: dict[str, str],
    names: dict[str, str],
) -> list[tuple[str, str, int]]:
    """Give each model-proposed prerequisite pair a DIRECTION from reading order, and a
    mention-based RefD confidence.

    The model is good at saying two concepts are *related* but unreliable about which comes
    first; within a single text the concept introduced earlier is the prerequisite (RefD
    intuition). Orienting every edge from the later concept to the earlier one both enforces
    that direction and guarantees an acyclic graph (a strict reading-order rank can't cycle).

    ``pairs`` = ``(dependent_key, prereq_key)`` as named by the model. ``ranks`` = global
    reading rank per concept key; ``texts`` = lowercased signal+source per key; ``names`` =
    normalized lowercased name per key. Returns deduped ``(from_key, to_key, refd)`` where the
    edge means ``from`` (later) requires ``to`` (earlier). ``refd`` ∈ {-1,0,1}: +1 = the
    dependent's text references the prerequisite (strong signal), -1 = only the reverse."""

    def mentions(of_key: str, in_key: str) -> bool:
        n = names.get(of_key, "")
        return len(n) > 2 and n in texts.get(in_key, "")

    oriented: dict[tuple[str, str], int] = {}
    for a, b in pairs:
        if a == b:
            continue
        ra, rb = ranks.get(a), ranks.get(b)
        if ra is not None and rb is not None and ra != rb:
            later, earlier = (a, b) if ra > rb else (b, a)
        else:
            later, earlier = a, b  # no order signal — keep the model's direction (a requires b)
        refd = int(mentions(earlier, later)) - int(mentions(later, earlier))
        edge = (later, earlier)
        if edge not in oriented or refd > oriented[edge]:
            oriented[edge] = refd
    return [(f, t, r) for (f, t), r in oriented.items()]


# --------------------------------------------------------------------------- #
# ArangoDB write path
# --------------------------------------------------------------------------- #

def ensure_concept_collections(db) -> None:
    if not db.has_collection(CONCEPTS):
        col = db.create_collection(CONCEPTS)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["sectionKey"])
    if not db.has_collection(CONCEPT_PREREQ):
        col = db.create_collection(CONCEPT_PREREQ, edge=True)
        col.add_persistent_index(fields=["docId"])
    # The structural TOC tree (has_subsection) is written by upsert_structural_edges into
    # entities/relationships so get_toc_tree still renders. Ensure they exist — on a fresh
    # DB (no prior triple run) they otherwise wouldn't, and the structural write would throw.
    if not db.has_collection("entities"):
        db.create_collection("entities")
    if not db.has_collection("relationships"):
        db.create_collection("relationships", edge=True)


def write_section_concepts(db, sc: SectionConcepts, batch: int = 500) -> None:
    # Re-extraction must be idempotent: clear this section's existing concepts first, else
    # concepts the new run no longer produces (renamed/dropped) linger (import_bulk only
    # overwrites same-key rows, never deletes).
    db.aql.execute(
        "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey == @s REMOVE c IN concepts",
        bind_vars={"d": sc.doc_id, "s": sc.section_key},
    )
    rows = []
    for idx, c in enumerate(sc.concepts):
        rows.append(
            {
                "_key": concept_key(sc.doc_id, sc.section_key, c.name),
                "docId": sc.doc_id,
                "sectionKey": sc.section_key,
                "pageStart": sc.page_start,
                "pageEnd": sc.page_end,
                "name": c.name,
                "kind": c.kind,
                "signal": c.signal,
                "source": c.source,
                "questions": [{"q": q.q, "a": q.a} for q in c.questions],
                "prereqNames": list(c.prereq_names),
                "order": idx,
                "createdAt": int(time.time()),
            }
        )
    if rows:
        db.collection(CONCEPTS).import_bulk(rows, on_duplicate="replace")


def _concept_reading_ranks(db, doc_id: str, rows: list[dict]) -> dict[str, int]:
    """Global reading rank per concept: section reading order, then within-section order.
    A strict unique rank makes the oriented prereq graph provably acyclic."""
    sec_order: dict[str, int] = {}
    for r in db.aql.execute(
        "FOR s IN section_content FILTER s.docId == @d RETURN {k: s.sectionKey, o: s.order}",
        bind_vars={"d": doc_id},
    ):
        k, o = r.get("k"), r.get("o") or 0
        if k is not None and (k not in sec_order or o < sec_order[k]):
            sec_order[k] = o
    ordered = sorted(
        rows,
        key=lambda r: (sec_order.get(r["sk"], 1_000_000), r.get("ord") or 0, r["key"]),
    )
    return {r["key"]: i for i, r in enumerate(ordered)}


def rebuild_prereq_edges(db, doc_id: str, min_refd: int | None = None) -> int:
    """Recompute ``concept_prereq`` edges from all of a document's concepts' prereqNames.

    The model names *related* concepts; we resolve those to keys, then orient each edge by
    reading order (RefD intuition — earlier concept is the prerequisite), which enforces
    direction and guarantees acyclicity, and attach a mention-based ``refd`` confidence.
    ``min_refd`` (env ``LEARN_PREREQ_MIN_REFD``, default -1 = keep all) drops weaker edges.
    Idempotent: clears the doc's existing prereq edges first."""
    db.aql.execute(
        "FOR e IN concept_prereq FILTER e.docId == @d REMOVE e IN concept_prereq",
        bind_vars={"d": doc_id},
    )
    rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d RETURN {key: c._key, name: c.name, "
            "sk: c.sectionKey, ord: c.order, prereqs: c.prereqNames, signal: c.signal, "
            "source: c.source, canon: c.canonicalKey}",
            bind_vars={"d": doc_id},
        )
    )
    ranks = _concept_reading_ranks(db, doc_id, rows)
    names = {r["key"]: _name_norm(r["name"]) for r in rows}
    texts = {r["key"]: f"{r.get('signal') or ''} {r.get('source') or ''}".lower() for r in rows}
    triples = [(r["key"], r["name"], list(r.get("prereqs") or [])) for r in rows]

    # Collapse onto canonical concepts (within-doc dedup): edges between duplicate concepts
    # become edges between their canonical representatives; self-loops after collapse drop out.
    canon = {r["key"]: (r.get("canon") or r["key"]) for r in rows}
    pairs = resolve_prereq_pairs(triples)
    pairs = [(canon.get(a, a), canon.get(b, b)) for a, b in pairs]
    pairs = [(a, b) for a, b in pairs if a != b]
    edges = orient_prereq_edges(pairs, ranks, texts, names)
    if min_refd is None:
        env = os.environ.get("LEARN_PREREQ_MIN_REFD")
        min_refd = int(env) if env not in (None, "") else -1
    edges = [e for e in edges if e[2] >= min_refd]
    if edges:
        db.collection(CONCEPT_PREREQ).import_bulk(
            [
                {
                    "_key": hashlib.md5(f"{a}|{b}".encode()).hexdigest()[:16],
                    "_from": f"concepts/{a}",
                    "_to": f"concepts/{b}",
                    "type": "prerequisite",
                    "refd": r,
                    "docId": doc_id,
                }
                for a, b, r in edges
            ],
            on_duplicate="replace",
        )
    return len(edges)


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def _extract_one_section_concepts(inp, model: str | None = None) -> tuple[SectionConcepts | None, str | None]:
    from app.extract import build_user_prompt  # reuse the templated user message

    messages = [
        {"role": "system", "content": build_concept_system_prompt()},
        {"role": "user", "content": build_user_prompt(inp)},
    ]
    # Precedence: the request's model (UI picker) > LEARN_EXTRACT_MODEL > OLLAMA_MODEL.
    use_model = model or _extract_model()
    last_err: str | None = None
    for _ in range(3):
        obj, err = ollama_structured_completion(
            messages, CONCEPT_JSON_SCHEMA, temperature=0.2, model=use_model
        )
        if obj is not None:
            concepts = parse_concepts_response(obj)
            return assemble_section_concepts(
                inp.doc_id, inp.section_key, inp.page_start, inp.page_end, concepts
            ), None
        last_err = err
    return None, last_err


async def extract_concepts_document(
    doc_id: str | None = None,
    section_keys: list[str] | None = None,
    scope: str | None = None,
    concurrency: int = 3,
    model: str | None = None,
) -> dict:
    """Build concept-lessons for a document (``scope=toc:1`` = one chapter). Background-job
    friendly; failures are isolated per section. ``model`` overrides the extraction model
    (the UI-selected Ollama model); falls back to LEARN_EXTRACT_MODEL / OLLAMA_MODEL."""
    t0 = time.time()
    db = connect_arango()
    if doc_id is None:
        doc = (fetch_latest_document() or {}).get("document")
        doc_id = doc.get("id") if doc else None
    if not doc_id:
        return {"error": "no document found"}

    ensure_concept_collections(db)
    sections = _load_section_blocks(db, doc_id, section_keys=section_keys, scope=scope)
    if not sections:
        return {"docId": doc_id, "scope": scope, "sections": 0, "concepts": 0, "errors": ["no sections with content"]}

    sem = asyncio.Semaphore(max(1, concurrency))
    results: list[SectionConcepts] = []
    errors: list[str] = []

    async def run(inp) -> None:
        async with sem:
            sc, err = await asyncio.to_thread(_extract_one_section_concepts, inp, model)
            if err:
                errors.append(f"{inp.section_key}: {err}")
            elif sc is not None:
                results.append(sc)

    await asyncio.gather(*(run(s) for s in sections))

    total_concepts = 0
    total_questions = 0
    for sc in results:
        write_section_concepts(db, sc)
        total_concepts += len(sc.concepts)
        total_questions += sum(len(c.questions) for c in sc.concepts)

    # Keep the structural TOC tree.
    upsert_structural_edges(db, structural_subsection_triples([s.section_key for s in sections]), doc_id)

    # Within-document concept resolution (dedup): tag each concept with a canonicalKey BEFORE
    # building prereq edges, so the prereq graph is over canonical concepts (duplicates merged).
    from app.concept_resolve import resolve_concepts_document

    rank_rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d RETURN {key: c._key, sk: c.sectionKey, ord: c.order}",
            bind_vars={"d": doc_id},
        )
    )
    ranks = _concept_reading_ranks(db, doc_id, rank_rows)
    resolution = resolve_concepts_document(db, doc_id, ranks=ranks)
    prereq_edges = rebuild_prereq_edges(db, doc_id)

    return {
        "docId": doc_id,
        "scope": scope,
        "sections": len(sections),
        "extracted": len(results),
        "concepts": total_concepts,
        "questions": total_questions,
        "canonicalConcepts": resolution.get("canonical"),
        "mergedConcepts": resolution.get("merged"),
        "prereqEdges": prereq_edges,
        "seconds": round(time.time() - t0, 1),
        "errors": errors,
    }


def fetch_section_concepts(section_key: str, doc_id: str | None = None) -> dict:
    """Stored concept-lessons for a section (the course view + verification)."""
    try:
        db = connect_arango()
        if not db.has_collection(CONCEPTS):
            return {"sectionKey": section_key, "concepts": []}
        if doc_id is None:
            doc = (fetch_latest_document() or {}).get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"sectionKey": section_key, "concepts": []}
        rows = list(
            db.aql.execute(
                "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey == @s SORT c.order "
                "RETURN { name: c.name, kind: c.kind, signal: c.signal, source: c.source, "
                "questions: c.questions, prereqNames: c.prereqNames, "
                "pageStart: c.pageStart, pageEnd: c.pageEnd }",
                bind_vars={"d": doc_id, "s": section_key},
            )
        )
        return {"sectionKey": section_key, "docId": doc_id, "concepts": rows}
    except Exception as exc:
        return {"sectionKey": section_key, "concepts": [], "error": str(exc)}


def fetch_document_concepts(doc_id: str | None = None) -> dict:
    """Document-level CANONICAL concept list (within-doc dedup applied): one entry per
    canonicalKey, in reading order, each carrying the merged provenance of where it appears
    (``appearsIn`` = every section/page the concept — or a duplicate of it — was taught in)."""
    try:
        db = connect_arango()
        if not db.has_collection(CONCEPTS):
            return {"docId": doc_id, "concepts": []}
        if doc_id is None:
            doc = (fetch_latest_document() or {}).get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"docId": None, "concepts": []}
        rows = list(
            db.aql.execute(
                "FOR c IN concepts FILTER c.docId == @d RETURN {key: c._key, canon: c.canonicalKey, "
                "name: c.name, kind: c.kind, signal: c.signal, source: c.source, questions: c.questions, "
                "prereqNames: c.prereqNames, sectionKey: c.sectionKey, pageStart: c.pageStart, "
                "pageEnd: c.pageEnd, order: c.order}",
                bind_vars={"d": doc_id},
            )
        )
        if not rows:
            return {"docId": doc_id, "concepts": []}
        ranks = _concept_reading_ranks(
            db, doc_id, [{"key": r["key"], "sk": r["sectionKey"], "ord": r["order"]} for r in rows]
        )
        by_key = {r["key"]: r for r in rows}
        groups: dict[str, list[dict]] = {}
        for r in rows:
            groups.setdefault(r.get("canon") or r["key"], []).append(r)
        out: list[dict] = []
        for canon_key, members in groups.items():
            rep = by_key.get(canon_key) or min(members, key=lambda m: ranks.get(m["key"], 10**9))
            members_sorted = sorted(members, key=lambda m: ranks.get(m["key"], 10**9))
            out.append(
                {
                    "_rank": ranks.get(rep["key"], 10**9),
                    "name": rep["name"],
                    "kind": rep["kind"],
                    "signal": rep["signal"],
                    "source": rep.get("source"),
                    "questions": rep.get("questions") or [],
                    "prereqNames": rep.get("prereqNames") or [],
                    "sectionKey": rep["sectionKey"],
                    "pageStart": rep.get("pageStart"),
                    "pageEnd": rep.get("pageEnd"),
                    "appearsIn": [
                        {"sectionKey": m["sectionKey"], "pageStart": m.get("pageStart"), "pageEnd": m.get("pageEnd")}
                        for m in members_sorted
                    ],
                    "aliasCount": len(members) - 1,
                }
            )
        out.sort(key=lambda c: c["_rank"])
        for c in out:
            c.pop("_rank", None)
        return {"docId": doc_id, "concepts": out}
    except Exception as exc:  # noqa: BLE001
        return {"docId": doc_id, "concepts": [], "error": str(exc)}
````

## File: assets/deploy/services/learn/app/extract_routes.py
````python
"""API routes for server-side KG extraction (propositions + triples).

Extraction is long (~15-20 min/chapter), so ``POST /api/extract`` starts a background
job and returns immediately; the client polls ``GET /api/extract/status``.
"""

from __future__ import annotations

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.concepts_extract import fetch_document_concepts, fetch_section_concepts
from app.extract import extraction_status, fetch_section_propositions, start_extraction

router = APIRouter()


@router.post("/api/extract")
async def api_extract(
    doc: str | None = None,
    scope: str | None = None,
    body: dict | None = Body(default=None),
) -> JSONResponse:
    """Start a background concept extraction. ``?scope=toc:1`` = one chapter (and everything
    under it); body ``sectionKeys`` = an exact set (the TOC-preview selection); neither =
    the whole document (slow). Returns immediately with ``status:running``."""
    body = body or {}
    concurrency = int(body.get("concurrency") or 3)
    raw_keys = body.get("sectionKeys")
    section_keys = [str(k) for k in raw_keys if k] if isinstance(raw_keys, list) else None
    model = body.get("model")
    model = str(model).strip() if model else None
    data = start_extraction(
        doc, scope, concurrency=concurrency, section_keys=section_keys or None, model=model
    )
    return JSONResponse(data, status_code=503 if data.get("status") == "error" else 200)


@router.get("/api/extract/status")
def api_extract_status(doc: str | None = None, scope: str | None = None) -> JSONResponse:
    """Poll a background extraction's status (idle | running | done | error)."""
    return JSONResponse(extraction_status(doc, scope))


@router.get("/api/concepts")
def api_document_concepts(doc: str | None = None) -> JSONResponse:
    """Document-level canonical (deduped) concept list with merged provenance."""
    data = fetch_document_concepts(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/section/{key:path}/concepts")
def api_section_concepts(key: str, doc: str | None = None) -> JSONResponse:
    """Concept-lessons for a section (the course view)."""
    data = fetch_section_concepts(key, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@router.get("/api/section/{key:path}/propositions")
def api_section_propositions(key: str, doc: str | None = None) -> JSONResponse:
    data = fetch_section_propositions(key, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)
````

## File: assets/deploy/services/learn/app/extract.py
````python
"""Server-side, section-aware KG extraction: context-rich propositions + SPO triples.

Replaces the old client-side per-512-char extraction. For each TOC section of a stored
document we read its ``section_content`` markdown (a whole heading-delimited span, not a
fragment) and run Ollama with a domain-aware prompt + JSON-schema structured output to
extract (a) propositions — self-contained claims with their verbatim source sentence —
and (b) normalized triples. Everything is tagged with ``{docId, sectionKey, pageStart,
pageEnd}``: propositions in a new ``propositions`` collection, content edges with
``sectionKeys[]``/page provenance. Structural (``has_subsection``) and ``section_mentions``
edges are produced here too (they used to come from the frontend).

The parse/normalize/assemble/provenance logic is pure (unit-tested); the Ollama call and
ArangoDB writes are thin wrappers around it.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
from dataclasses import dataclass

from app.arango_content import _clean_heading_markup, fetch_latest_document, is_ancestor_section_key
from app.arango_learn import triple_id
from app.arango_tree import connect_arango
from app.llm import ollama_structured_completion

ENTITIES = "entities"
RELATIONSHIPS = "relationships"
PROPOSITIONS = "propositions"
SECTION_CONTENT = "section_content"

HAS_SUBSECTION = "has_subsection"
SECTION_MENTIONS = "section_mentions"
TOC_ROOT = "toc:root"

_NUMERIC = re.compile(r"^\d+(?:\.\d+)*$")
_MIN_SECTION_BODY_CHARS = 80  # skip heading-only / structural blocks with no real content
# Front-matter noise that the splitter mis-detects as a heading (copyright URLs, ISBNs).
_JUNK_HEADING = re.compile(r"(https?://|www\.|isbn|cambridge\.org|\b\d{9,}\b)", re.IGNORECASE)

_DEFAULT_DOMAIN = "a mathematics / causal-inference textbook"

EXTRACTION_SYSTEM_PROMPT = (
    "You are a knowledge extractor for a personal study tool. You are given one section "
    "of {domain}. Extract the *teachable claims* of the section as structured data.\n\n"
    "Extract two things:\n\n"
    "1. PROPOSITIONS — each a single, self-contained statement of one definition, claim, "
    "theorem, property, or relation the section asserts. Each proposition must:\n"
    "   - be understandable on its own, with no \"this\", \"it\", \"the above\", \"we\", "
    "\"the author\", or section/page references;\n"
    "   - name its concepts in full (write \"conditional independence\", not \"it\");\n"
    "   - quote, verbatim, the source sentence or span it came from.\n\n"
    "2. TRIPLES — for each proposition, the normalized subject-predicate-object facts it "
    "encodes. Subjects and objects are canonical concept names (noun phrases, singular); "
    "predicates are short verb phrases (e.g. \"is defined as\", \"implies\", \"is a special "
    "case of\", \"is denoted by\"). A proposition may yield one or several triples.\n\n"
    "Rules:\n"
    "- Cover ONLY the section's substantive content. Skip running heads, page numbers, "
    "figure/table captions with no claim, bibliographic citations, exercise numbering, and "
    "cross-references (\"see Chapter 3\").\n"
    "- Do not invent facts not stated in the text.\n"
    "- Canonicalize: collapse \"Conditional Independence\", \"conditionally independent\", "
    "\"cond. indep.\" to one name \"conditional independence\".\n"
    "- Single-letter variables (X, Y, Z) are kept only when the section defines them; "
    "otherwise prefer the concept they denote.\n"
    "- Return ONLY data conforming to the schema. No commentary."
)

EXTRACTION_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "propositions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "proposition_text": {"type": "string"},
                    "source_sentence": {"type": "string"},
                    "triples": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "subject": {"type": "string"},
                                "predicate": {"type": "string"},
                                "object": {"type": "string"},
                            },
                            "required": ["subject", "predicate", "object"],
                        },
                    },
                },
                "required": ["proposition_text", "source_sentence", "triples"],
            },
        }
    },
    "required": ["propositions"],
}


# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class SectionExtractInput:
    doc_id: str
    section_key: str
    heading: str
    page_start: int | None
    page_end: int | None
    markdown: str


@dataclass(frozen=True)
class ExtractedTriple:
    subject: str
    predicate: str
    object: str


@dataclass(frozen=True)
class ExtractedProposition:
    text: str
    source_sentence: str
    triples: tuple[ExtractedTriple, ...]


@dataclass(frozen=True)
class SectionExtraction:
    doc_id: str
    section_key: str
    page_start: int | None
    page_end: int | None
    propositions: tuple[ExtractedProposition, ...]
    triples: tuple[ExtractedTriple, ...]  # deduped union across this section's propositions


# --------------------------------------------------------------------------- #
# Pure functions (unit-testable; no LLM, no DB)
# --------------------------------------------------------------------------- #

def _domain() -> str:
    return os.environ.get("LEARN_EXTRACT_DOMAIN") or _DEFAULT_DOMAIN


def build_system_prompt() -> str:
    return EXTRACTION_SYSTEM_PROMPT.format(domain=_domain())


def build_user_prompt(inp: SectionExtractInput) -> str:
    if inp.page_start is None:
        pages = ""
    elif inp.page_end and inp.page_end != inp.page_start:
        pages = f", pages {inp.page_start}-{inp.page_end}"
    else:
        pages = f", page {inp.page_start}"
    return (
        f"Section: {inp.heading}  ({inp.section_key}{pages})\n\n"
        f"<section_markdown>\n{inp.markdown}\n</section_markdown>"
    )


def normalize_entity(name: object) -> str:
    return _clean_heading_markup(str(name or "")).strip()


def _norm_part(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def normalize_triple(subject: object, predicate: object, object_: object) -> ExtractedTriple | None:
    s, p, o = normalize_entity(subject), _norm_part(predicate), normalize_entity(object_)
    if not s or not p or not o:
        return None
    return ExtractedTriple(subject=s, predicate=p, object=o)


def parse_extraction_response(obj: object) -> list[dict]:
    """Validate the model's structured output into raw proposition dicts (drop malformed)."""
    if not isinstance(obj, dict):
        return []
    props = obj.get("propositions")
    if not isinstance(props, list):
        return []
    out: list[dict] = []
    for p in props:
        if not isinstance(p, dict):
            continue
        text = _norm_part(p.get("proposition_text"))
        if not text:
            continue
        triples: list[ExtractedTriple] = []
        for t in p.get("triples") or []:
            if isinstance(t, dict):
                nt = normalize_triple(t.get("subject"), t.get("predicate"), t.get("object"))
                if nt is not None:
                    triples.append(nt)
        out.append(
            {"text": text, "source_sentence": _norm_part(p.get("source_sentence")), "triples": triples}
        )
    return out


def assemble_section_extraction(inp: SectionExtractInput, raw_props: list[dict]) -> SectionExtraction:
    """Build the section extraction: propositions keep their own triples; the section's
    ``triples`` are the case-insensitive dedupe union, with provenance attached."""
    propositions: list[ExtractedProposition] = []
    seen: dict[tuple[str, str, str], ExtractedTriple] = {}
    for rp in raw_props:
        trips = tuple(rp["triples"])
        propositions.append(
            ExtractedProposition(text=rp["text"], source_sentence=rp["source_sentence"], triples=trips)
        )
        for t in trips:
            key = (t.subject.lower(), t.predicate.lower(), t.object.lower())
            seen.setdefault(key, t)
    return SectionExtraction(
        doc_id=inp.doc_id,
        section_key=inp.section_key,
        page_start=inp.page_start,
        page_end=inp.page_end,
        propositions=tuple(propositions),
        triples=tuple(seen.values()),
    )


def section_mention_entities(extraction: SectionExtraction) -> list[str]:
    """Distinct subject/object names (first-seen order) — the section's mentioned entities."""
    seen: set[str] = set()
    out: list[str] = []
    for t in extraction.triples:
        for name in (t.subject, t.object):
            k = name.lower()
            if k not in seen:
                seen.add(k)
                out.append(name)
    return out


def structural_subsection_triples(section_keys: list[str]) -> list[ExtractedTriple]:
    """Numeric-prefix ``has_subsection`` chain (toc:root→toc:1→toc:1.2→…), deduped.

    Mirrors the frontend ``numberPrefixChainTriples`` so ``get_toc_tree`` still renders.
    """
    seen: set[tuple[str, str]] = set()
    out: list[ExtractedTriple] = []
    for key in section_keys:
        if not key.startswith("toc:"):
            continue
        body = key[4:]
        if not _NUMERIC.match(body):
            continue
        parts = body.split(".")
        prev = TOC_ROOT
        for i in range(len(parts)):
            cur = "toc:" + ".".join(parts[: i + 1])
            pair = (prev, cur)
            if prev != cur and pair not in seen:
                seen.add(pair)
                out.append(ExtractedTriple(subject=prev, predicate=HAS_SUBSECTION, object=cur))
            prev = cur
    return out


def edge_provenance_merge(old: dict, new: dict) -> dict:
    """Merge content-edge provenance (the pure form of the UPSERT clause): union sectionKeys,
    min pageStart, max pageEnd, tolerating nulls."""
    keys = list(dict.fromkeys([*(old.get("sectionKeys") or []), *(new.get("sectionKeys") or [])]))
    starts = [v for v in (old.get("pageStart"), new.get("pageStart")) if v is not None]
    ends = [v for v in (old.get("pageEnd"), new.get("pageEnd")) if v is not None]
    return {
        "sectionKeys": keys,
        "pageStart": min(starts) if starts else None,
        "pageEnd": max(ends) if ends else None,
    }


def section_body_len(markdown: str) -> int:
    """Length of a section block's body (markdown minus its leading heading line)."""
    parts = (markdown or "").split("\n", 1)
    return len(parts[1].strip()) if len(parts) > 1 else 0


# --------------------------------------------------------------------------- #
# Deterministic keys (mirror lib/arangodb.ts importTriples + arango_learn.triple_id)
# --------------------------------------------------------------------------- #

def entity_key(name: str) -> str:
    return hashlib.md5(name.lower().strip().encode()).hexdigest()[:16]


def edge_key(from_key: str, predicate: str, to_key: str) -> str:
    return hashlib.md5(f"{from_key}|{predicate.lower().strip()}|{to_key}".encode()).hexdigest()[:16]


def proposition_key(doc_id: str, section_key: str, text: str) -> str:
    return hashlib.sha256(f"{doc_id}|{section_key}|{text}".encode()).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# ArangoDB write path (python-arango UPSERT, mirrors importTriples semantics)
# --------------------------------------------------------------------------- #

def ensure_kg_collections(db) -> None:
    if not db.has_collection(ENTITIES):
        db.create_collection(ENTITIES)
    if not db.has_collection(RELATIONSHIPS):
        db.create_collection(RELATIONSHIPS, edge=True)
    if not db.has_collection(PROPOSITIONS):
        col = db.create_collection(PROPOSITIONS)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["sectionKey"])


def upsert_entities(db, names: list[str], doc_id: str, batch: int = 1000) -> None:
    seen: set[str] = set()
    items: list[dict] = []
    for n in names:
        k = entity_key(n)
        if k in seen:
            continue
        seen.add(k)
        items.append({"_key": k, "name": n})
    doc_ids = [doc_id] if doc_id else []
    for i in range(0, len(items), batch):
        db.aql.execute(
            """
            FOR item IN @batch
              UPSERT { _key: item._key }
              INSERT MERGE(item, { docIds: @docIds })
              UPDATE { docIds: UNION_DISTINCT(NOT_NULL(OLD.docIds, []), @docIds) }
              IN entities
            """,
            bind_vars={"batch": items[i : i + batch], "docIds": doc_ids},
        )


def upsert_content_edges(
    db,
    triples: list[ExtractedTriple],
    doc_id: str,
    section_key: str,
    page_start: int | None,
    page_end: int | None,
    batch: int = 1000,
) -> None:
    seen: set[str] = set()
    edges: list[dict] = []
    for t in triples:
        fk, tk = entity_key(t.subject), entity_key(t.object)
        ek = edge_key(fk, t.predicate, tk)
        if ek in seen:
            continue
        seen.add(ek)
        edges.append({"_key": ek, "_from": f"entities/{fk}", "_to": f"entities/{tk}", "type": t.predicate})
    binds = {
        "docIds": [doc_id] if doc_id else [],
        "sectionKeys": [section_key] if section_key else [],
        "pageStart": page_start,
        "pageEnd": page_end,
    }
    for i in range(0, len(edges), batch):
        db.aql.execute(
            """
            FOR item IN @batch
              UPSERT { _key: item._key }
              INSERT MERGE(item, { docIds: @docIds, sectionKeys: @sectionKeys,
                                   pageStart: @pageStart, pageEnd: @pageEnd })
              UPDATE {
                docIds:      UNION_DISTINCT(NOT_NULL(OLD.docIds, []), @docIds),
                sectionKeys: UNION_DISTINCT(NOT_NULL(OLD.sectionKeys, []), @sectionKeys),
                pageStart:   MIN([NOT_NULL(OLD.pageStart, @pageStart), @pageStart]),
                pageEnd:     MAX([NOT_NULL(OLD.pageEnd, @pageEnd), @pageEnd])
              }
              IN relationships
            """,
            bind_vars={**binds, "batch": edges[i : i + batch]},
        )


def upsert_structural_edges(db, triples: list[ExtractedTriple], doc_id: str, batch: int = 1000) -> None:
    """has_subsection / section_mentions edges (docIds provenance only). Ensures endpoints exist."""
    names: set[str] = set()
    for t in triples:
        names.add(t.subject)
        names.add(t.object)
    if names:
        upsert_entities(db, list(names), doc_id, batch)
    seen: set[str] = set()
    edges: list[dict] = []
    for t in triples:
        fk, tk = entity_key(t.subject), entity_key(t.object)
        ek = edge_key(fk, t.predicate, tk)
        if ek in seen:
            continue
        seen.add(ek)
        edges.append({"_key": ek, "_from": f"entities/{fk}", "_to": f"entities/{tk}", "type": t.predicate})
    doc_ids = [doc_id] if doc_id else []
    for i in range(0, len(edges), batch):
        db.aql.execute(
            """
            FOR item IN @batch
              UPSERT { _key: item._key }
              INSERT MERGE(item, { docIds: @docIds })
              UPDATE { docIds: UNION_DISTINCT(NOT_NULL(OLD.docIds, []), @docIds) }
              IN relationships
            """,
            bind_vars={"batch": edges[i : i + batch], "docIds": doc_ids},
        )


def write_propositions(db, extraction: SectionExtraction, batch: int = 500) -> None:
    rows = []
    for p in extraction.propositions:
        tids = [
            triple_id({"subject": t.subject, "predicate": t.predicate, "object": t.object})
            for t in p.triples
        ]
        rows.append(
            {
                "_key": proposition_key(extraction.doc_id, extraction.section_key, p.text),
                "docId": extraction.doc_id,
                "sectionKey": extraction.section_key,
                "pageStart": extraction.page_start,
                "pageEnd": extraction.page_end,
                "text": p.text,
                "sourceSentence": p.source_sentence,
                "tripleIds": tids,
                "createdAt": int(time.time()),
            }
        )
    if rows:
        db.collection(PROPOSITIONS).import_bulk(rows, on_duplicate="replace")


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def _section_depth(key: str) -> int:
    """Numeric depth of a ``toc:`` key (toc:1 → 1, toc:1.2 → 2); slug keys → large
    (they never act as a chapter boundary)."""
    if key.startswith("toc:"):
        body = key[4:]
        if _NUMERIC.match(body):
            return body.count(".") + 1
    return 99


def _blocks_in_scope(rows: list[dict], scope: str) -> list[dict]:
    """All section_content rows belonging to a chapter/section ``scope``, by reading-order
    span: from the scope's first block to the next same-or-shallower numbered section.

    This captures the scope's numbered subsections AND the interspersed slug blocks
    (theorems, definitions) that a pure numeric-descendant match would miss.
    """
    ordered = sorted(rows, key=lambda r: r.get("order", 0))
    start_idx = next(
        (i for i, r in enumerate(ordered) if is_ancestor_section_key(scope, r.get("sectionKey", ""))),
        None,
    )
    if start_idx is None:
        return []
    scope_depth = _section_depth(scope)
    end_idx = len(ordered)
    for j in range(start_idx + 1, len(ordered)):
        sk = ordered[j].get("sectionKey", "")
        if not is_ancestor_section_key(scope, sk) and _section_depth(sk) <= scope_depth:
            end_idx = j
            break
    return ordered[start_idx:end_idx]


def _load_section_blocks(
    db, doc_id: str, section_keys: list[str] | None = None, scope: str | None = None
) -> list[SectionExtractInput]:
    rows = list(
        db.aql.execute(
            "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
            bind_vars={"d": doc_id},
        )
    )
    if scope:
        rows = _blocks_in_scope(rows, scope)
    wanted = set(section_keys) if section_keys else None
    out: list[SectionExtractInput] = []
    for r in rows:
        sk = r.get("sectionKey")
        if wanted is not None and sk not in wanted:
            continue
        md = r.get("markdown") or ""
        if section_body_len(md) < _MIN_SECTION_BODY_CHARS:
            continue
        if _JUNK_HEADING.search(r.get("heading") or ""):
            continue
        out.append(
            SectionExtractInput(
                doc_id=doc_id,
                section_key=sk,
                heading=r.get("heading") or sk,
                page_start=r.get("pageStart"),
                page_end=r.get("pageEnd"),
                markdown=md,
            )
        )
    return out


def _extract_model() -> str | None:
    """Optional extraction-specific model (``LEARN_EXTRACT_MODEL``); else the default
    ``OLLAMA_MODEL`` is used. Lets the batch pick a faster/better model than the Socratic one."""
    return os.environ.get("LEARN_EXTRACT_MODEL") or None


def _extract_one_section(inp: SectionExtractInput, retries: int = 2) -> tuple[SectionExtraction | None, str | None]:
    messages = [
        {"role": "system", "content": build_system_prompt()},
        {"role": "user", "content": build_user_prompt(inp)},
    ]
    last_err: str | None = None
    for _ in range(retries + 1):
        obj, err = ollama_structured_completion(
            messages, EXTRACTION_JSON_SCHEMA, temperature=0.2, model=_extract_model()
        )
        if obj is not None:
            return assemble_section_extraction(inp, parse_extraction_response(obj)), None
        last_err = err
    return None, last_err


async def extract_document(
    doc_id: str | None = None,
    section_keys: list[str] | None = None,
    scope: str | None = None,
    concurrency: int = 3,
) -> dict:
    """Extract propositions + triples for a document into the KG.

    ``scope`` (e.g. ``toc:1``) extracts one chapter/section and everything under it —
    the intended "one chapter at a time" batch. ``section_keys`` extracts an exact set.
    Neither → the whole document. Bounded concurrency (Ollama is the bottleneck); a
    failed section is isolated and recorded in ``errors[]``.
    """
    t0 = time.time()
    db = connect_arango()
    if doc_id is None:
        doc = (fetch_latest_document() or {}).get("document")
        doc_id = doc.get("id") if doc else None
    if not doc_id:
        return {"error": "no document found"}

    ensure_kg_collections(db)
    sections = _load_section_blocks(db, doc_id, section_keys=section_keys, scope=scope)
    if not sections:
        return {"docId": doc_id, "sections": 0, "propositions": 0, "triples": 0, "errors": ["no sections with content"]}

    sem = asyncio.Semaphore(max(1, concurrency))
    extractions: list[SectionExtraction] = []
    errors: list[str] = []

    async def run(inp: SectionExtractInput) -> None:
        async with sem:
            ext, err = await asyncio.to_thread(_extract_one_section, inp)
            if err:
                errors.append(f"{inp.section_key}: {err}")
            elif ext is not None:
                extractions.append(ext)

    await asyncio.gather(*(run(s) for s in sections))

    total_props = 0
    total_triples = 0
    for ext in extractions:
        mentions = section_mention_entities(ext)
        upsert_entities(db, mentions, doc_id)
        upsert_content_edges(db, list(ext.triples), doc_id, ext.section_key, ext.page_start, ext.page_end)
        mention_edges = [
            ExtractedTriple(subject=ext.section_key, predicate=SECTION_MENTIONS, object=e) for e in mentions
        ]
        upsert_structural_edges(db, mention_edges, doc_id)
        write_propositions(db, ext)
        total_props += len(ext.propositions)
        total_triples += len(ext.triples)

    # Document-wide has_subsection hierarchy (once, from every section key).
    upsert_structural_edges(db, structural_subsection_triples([s.section_key for s in sections]), doc_id)

    return {
        "docId": doc_id,
        "scope": scope,
        "sections": len(sections),
        "extracted": len(extractions),
        "propositions": total_props,
        "triples": total_triples,
        "seconds": round(time.time() - t0, 1),
        "errors": errors,
    }


# --------------------------------------------------------------------------- #
# Background jobs (extraction is 15-20 min — never block the HTTP request)
# --------------------------------------------------------------------------- #

_JOBS: dict[str, dict] = {}


def _job_key(doc_id: str, scope: str | None) -> str:
    return f"{doc_id}:{scope or 'ALL'}"


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


async def _run_job(
    key: str,
    doc_id: str,
    scope: str | None,
    concurrency: int,
    section_keys: list[str] | None,
    model: str | None = None,
) -> None:
    try:
        # Concept-course extraction is the product now (lazy import avoids a cycle).
        from app.concepts_extract import extract_concepts_document

        summary = await extract_concepts_document(
            doc_id=doc_id, section_keys=section_keys, scope=scope, concurrency=concurrency, model=model
        )
        _JOBS[key] = {"status": "done", "scope": scope, "docId": doc_id, "summary": summary}
    except Exception as exc:  # noqa: BLE001 — surface in status, never crash the loop
        _JOBS[key] = {"status": "error", "scope": scope, "docId": doc_id, "error": str(exc)}


def start_extraction(
    doc_id: str | None,
    scope: str | None,
    concurrency: int = 3,
    section_keys: list[str] | None = None,
    model: str | None = None,
) -> dict:
    """Kick off concept extraction as a background task and return immediately. Idempotent
    while a job for the same (doc, scope) slot is already running.

    ``section_keys`` extracts an exact set of sections (the TOC-preview selection); it is
    keyed under the ``scope`` slot, so the "Process documents" flow passes ``scope=None``
    (the per-document slot) while the syllabus tree uses ``scope=toc:N`` per chapter."""
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "error", "error": "no document found"}
    key = _job_key(doc_id, scope)
    current = _JOBS.get(key)
    if current and current.get("status") == "running":
        return {"status": "running", "scope": scope, "docId": doc_id, "alreadyRunning": True}
    _JOBS[key] = {"status": "running", "scope": scope, "docId": doc_id}
    asyncio.create_task(_run_job(key, doc_id, scope, concurrency, section_keys, model))
    return {"status": "running", "scope": scope, "docId": doc_id}


def extraction_status(doc_id: str | None, scope: str | None) -> dict:
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "idle", "scope": scope}
    return _JOBS.get(_job_key(doc_id, scope), {"status": "idle", "scope": scope, "docId": doc_id})


def fetch_section_propositions(section_key: str, doc_id: str | None = None) -> dict:
    """Stored propositions for a section (drill-down + verification)."""
    try:
        db = connect_arango()
        if not db.has_collection(PROPOSITIONS):
            return {"sectionKey": section_key, "propositions": []}
        if doc_id is None:
            doc = (fetch_latest_document() or {}).get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"sectionKey": section_key, "propositions": []}
        rows = list(
            db.aql.execute(
                "FOR p IN propositions FILTER p.docId == @d AND p.sectionKey == @s "
                "RETURN { text: p.text, sourceSentence: p.sourceSentence, "
                "pageStart: p.pageStart, pageEnd: p.pageEnd, tripleIds: p.tripleIds }",
                bind_vars={"d": doc_id, "s": section_key},
            )
        )
        return {"sectionKey": section_key, "docId": doc_id, "propositions": rows}
    except Exception as exc:
        return {"sectionKey": section_key, "propositions": [], "error": str(exc)}
````

## File: assets/deploy/services/learn/app/ingest_routes.py
````python
"""Ingestion: PDF -> Markdown as a background job.

Converting a large book takes minutes (Docling layout + formula models), which is longer
than the ~5-min undici fetch timeout on the app->learn hop. So ``POST /api/convert-pdf``
starts a background job and returns a ``jobId`` immediately; the client polls
``GET /api/convert-pdf/status``. This never holds a request open for the whole conversion
and survives an app restart (the browser just keeps polling).
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.pdf_convert import PdfConvertError, convert_pdf_bytes, pdf_convert_health

router = APIRouter()

# In-memory conversion jobs: jobId -> {status, filename, result?|error?}.
_CONVERT_JOBS: dict[str, dict] = {}
_MAX_JOBS = 50


def _result_payload(result) -> dict:
    return {
        "markdown": result.markdown,
        "sourceFilename": result.source_filename,
        "outputFilename": result.output_filename,
        "pageCount": result.page_count,
        "savedPath": result.saved_path,
        "docId": result.doc_id,
        "engine": result.engine,
        "hasPageProvenance": result.has_page_provenance,
    }


def _prune_jobs() -> None:
    """Bound the jobs map: drop the oldest finished jobs (dict keeps insertion order)."""
    if len(_CONVERT_JOBS) <= _MAX_JOBS:
        return
    for key in list(_CONVERT_JOBS)[: len(_CONVERT_JOBS) - _MAX_JOBS]:
        if _CONVERT_JOBS[key].get("status") in ("done", "error"):
            _CONVERT_JOBS.pop(key, None)


async def _run_convert(job_id: str, data: bytes, filename: str) -> None:
    try:
        result = await asyncio.to_thread(convert_pdf_bytes, data, filename)
        _CONVERT_JOBS[job_id] = {"status": "done", "filename": filename, "result": _result_payload(result)}
    except PdfConvertError as e:
        _CONVERT_JOBS[job_id] = {"status": "error", "filename": filename, "error": str(e), "statusCode": e.status_code}
    except Exception as e:  # noqa: BLE001 — surface in status, never crash the loop
        _CONVERT_JOBS[job_id] = {"status": "error", "filename": filename, "error": str(e), "statusCode": 500}


@router.get("/api/convert-pdf/health")
def convert_pdf_health() -> JSONResponse:
    return JSONResponse(pdf_convert_health())


@router.post("/api/convert-pdf")
async def convert_pdf(file: UploadFile = File(...)) -> JSONResponse:
    """Start a background PDF->markdown conversion; returns ``{jobId, status:"running"}``."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only .pdf files are accepted")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    job_id = uuid.uuid4().hex
    _prune_jobs()
    _CONVERT_JOBS[job_id] = {"status": "running", "filename": file.filename}
    asyncio.create_task(_run_convert(job_id, data, file.filename))
    return JSONResponse({"jobId": job_id, "status": "running", "filename": file.filename})


@router.get("/api/convert-pdf/status")
def convert_pdf_status(jobId: str) -> JSONResponse:
    """Poll a conversion job: ``running`` | ``done`` (+result) | ``error`` (+error) | ``unknown``."""
    job = _CONVERT_JOBS.get(jobId)
    if job is None:
        return JSONResponse({"status": "unknown", "error": "job not found"}, status_code=404)
    return JSONResponse(job)
````

## File: assets/deploy/services/learn/app/llm.py
````python
"""Ollama chat completions: free-text (Socratic) + JSON-schema-constrained (extraction)."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

DEFAULT_TIMEOUT = 120.0


def _ollama_base() -> str:
    return (os.environ.get("OLLAMA_BASE_URL") or "http://localhost:11434/v1").rstrip("/")


def _ollama_native_base() -> str:
    """Base URL for Ollama's native API (strip the OpenAI-compat ``/v1`` suffix)."""
    base = _ollama_base()
    return base[:-3].rstrip("/") if base.endswith("/v1") else base


def _ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL") or "llama3.1:8b"


def ollama_chat_completion(
    messages: list[dict[str, str]],
    temperature: float = 0.6,
) -> tuple[str | None, str | None]:
    """
    Returns (assistant_content, error_message).
    """
    url = f"{_ollama_base()}/chat/completions"
    payload: dict[str, Any] = {
        "model": _ollama_model(),
        "messages": messages,
        "temperature": temperature,
    }
    try:
        with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
        choices = data.get("choices") or []
        if not choices:
            return None, "Empty choices from Ollama"
        msg = (choices[0].get("message") or {}).get("content")
        if not msg or not isinstance(msg, str):
            return None, "No assistant content in response"
        return msg.strip(), None
    except httpx.HTTPStatusError as e:
        return None, f"Ollama HTTP {e.response.status_code}: {e.response.text[:500]}"
    except httpx.RequestError as e:
        return None, f"Ollama request failed: {e}"
    except Exception as e:
        return None, str(e)


def ollama_structured_completion(
    messages: list[dict[str, str]],
    json_schema: dict[str, Any],
    temperature: float = 0.2,
    model: str | None = None,
    timeout: float = 300.0,
) -> tuple[dict[str, Any] | None, str | None]:
    """Chat completion constrained to a JSON schema. Returns ``(parsed_obj, error)``.

    Tries the OpenAI-compatible ``/v1`` shim with ``response_format: json_schema`` first
    (no compose changes), and falls back to Ollama's native ``/api/chat`` with ``format``
    if the shim rejects it (older Ollama). Either way the model is forced to emit JSON
    matching ``json_schema``, so parsing is a plain ``json.loads`` — no regex salvage.
    """
    mdl = model or _ollama_model()
    url = f"{_ollama_base()}/chat/completions"
    payload: dict[str, Any] = {
        "model": mdl,
        "messages": messages,
        "temperature": temperature,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "extraction", "strict": True, "schema": json_schema},
        },
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(url, json=payload)
            if r.status_code == 400:  # shim lacks response_format → native fallback
                return _ollama_native_structured(messages, json_schema, temperature, mdl, timeout)
            r.raise_for_status()
            data = r.json()
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
        if not content or not isinstance(content, str):
            return None, "No assistant content in structured response"
        try:
            return json.loads(content), None
        except Exception as e:
            return None, f"JSON parse failed: {e}: {content[:300]}"
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 400:
            return _ollama_native_structured(messages, json_schema, temperature, mdl, timeout)
        return None, f"Ollama HTTP {e.response.status_code}: {e.response.text[:500]}"
    except httpx.RequestError as e:
        return None, f"Ollama request failed: {e}"
    except Exception as e:
        return None, str(e)


def _ollama_native_structured(
    messages: list[dict[str, str]],
    json_schema: dict[str, Any],
    temperature: float,
    model: str,
    timeout: float,
) -> tuple[dict[str, Any] | None, str | None]:
    url = f"{_ollama_native_base()}/api/chat"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "format": json_schema,
        "stream": False,
        "options": {"temperature": temperature},
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
        content = (data.get("message") or {}).get("content")
        if not content or not isinstance(content, str):
            return None, "No content from native Ollama"
        try:
            return json.loads(content), None
        except Exception as e:
            return None, f"native JSON parse failed: {e}: {content[:300]}"
    except Exception as e:
        return None, f"native Ollama failed: {e}"
````

## File: assets/deploy/services/learn/app/main.py
````python
"""Learning environment: TOC tree + graph-grounded study."""

from pathlib import Path

import os

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.templating import Jinja2Templates

from app.arango_content import fetch_latest_document, fetch_page, fetch_section_content
from app.arango_tree import get_toc_tree, render_toc_tree_html, set_request_db_name
from app.extract_routes import router as extract_router
from app.ingest_routes import router as ingest_router
from app.mastery import compute_activity, compute_mastery
from app.study_routes import router as study_router

BASE_DIR = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app = FastAPI(title="txt2kg Learning", version="0.2.0")
app.include_router(study_router)
app.include_router(ingest_router)
app.include_router(extract_router)


@app.middleware("http")
async def user_db_middleware(request: Request, call_next):
    # Multi-tenancy: the Next.js proxy forwards the session user's ArangoDB
    # database in X-User-Db. Invalid/absent values fall back to the env default.
    set_request_db_name(request.headers.get("x-user-db"))
    return await call_next(request)


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/api/toc-tree")
def api_toc_tree(doc: str | None = None) -> JSONResponse:
    forest, edge_count, err, mention_count = get_toc_tree(doc)
    if err:
        return JSONResponse(
            {
                "error": err,
                "tree": [],
                "edgeCount": 0,
                "mentionEdgeCount": 0,
            },
            status_code=503,
        )
    return JSONResponse(
        {
            "tree": forest,
            "edgeCount": edge_count,
            "mentionEdgeCount": mention_count,
        }
    )


@app.get("/api/mastery")
def api_mastery(doc: str | None = None) -> JSONResponse:
    data = compute_mastery(doc=doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/activity")
def api_activity(doc: str | None = None) -> JSONResponse:
    data = compute_activity(doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/document")
def api_document(id: str | None = None) -> JSONResponse:
    data = fetch_latest_document(id)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/section/{key:path}/content")
def api_section_content(key: str, doc: str | None = None) -> JSONResponse:
    data = fetch_section_content(key, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/api/page/{page_no}")
def api_page(page_no: int, doc: str | None = None) -> JSONResponse:
    data = fetch_page(page_no, doc)
    return JSONResponse(data, status_code=503 if data.get("error") else 200)


@app.get("/tree")
def tree_page(request: Request):
    forest, edge_count, err, mention_count = get_toc_tree()
    tree_html = render_toc_tree_html(forest) if forest and not err else ""
    return templates.TemplateResponse(
        request,
        "tree.html",
        {
            "tree": forest,
            "tree_html": tree_html,
            "edge_count": edge_count,
            "mention_edge_count": mention_count,
            "error": err,
        },
    )


@app.get("/flashcards")
def flashcards_page(request: Request):
    return templates.TemplateResponse(request, "flashcards.html", {})


@app.get("/quiz")
def quiz_page(request: Request):
    return templates.TemplateResponse(request, "quiz.html", {})


@app.get("/socratic")
def socratic_page(request: Request):
    return templates.TemplateResponse(request, "socratic.html", {})


@app.get("/", response_class=HTMLResponse)
def landing() -> str:
    shared = os.environ.get("SHARED_DIR", "/shared")
    arango_url = os.environ.get("ARANGODB_URL", "")
    arango_db = os.environ.get("ARANGODB_DB", "")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Learning environment</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }}
    code {{ background: #eee; padding: 0.15rem 0.4rem; border-radius: 4px; }}
    a {{ color: #1a6; }}
    ul.links {{ list-style: none; padding: 0; }}
    ul.links li {{ margin: 0.35rem 0; }}
  </style>
</head>
<body>
  <h1>Learning environment</h1>
  <p>Graph-grounded study using the same ArangoDB as txt2kg. Optional query <code>?scope=toc:1.1.1</code> on study pages.</p>
  <ul class="links">
    <li><a href="/tree">TOC hierarchy + entities</a></li>
    <li><a href="/flashcards">Flashcards</a> (triples)</li>
    <li><a href="/quiz">Exam / quiz</a> (section-scoped multiple choice)</li>
    <li><a href="/socratic">Socratic chat</a> (Ollama + subgraph)</li>
  </ul>
  <p>Shared volume: <code>{shared}</code></p>
  <p>ArangoDB: <code>{arango_url}</code> / DB <code>{arango_db}</code></p>
</body>
</html>"""
````

## File: assets/deploy/services/learn/app/mastery.py
````python
"""Persisted study events + view-time mastery computation.

Mastery per section = coverage x accuracy x decay:
  - coverage: distinct quizzed content-triples / total content triples in the section
  - accuracy: Beta-Binomial posterior mean of quiz correctness (quizzes only)
  - decay:    exp(-dt / tau), dt = days since last quiz, tau = MASTERY_TAU_DAYS

Only raw events persist; mastery is recomputed on read because decay is
time-dependent. Internal sections roll up as a triple-count-weighted average
over their descendant leaf sections.
"""

from __future__ import annotations

import math
import os
import time
from typing import Any

from arango.database import StandardDatabase

from app.arango_learn import content_triples_for_section, triple_id
from app.arango_tree import connect_arango, get_toc_tree

EVENTS_COLLECTION = "study_events"


def _alpha() -> float:
    return float(os.environ.get("MASTERY_ALPHA", "1"))


def _beta() -> float:
    return float(os.environ.get("MASTERY_BETA", "1"))


def _tau_days() -> float:
    return float(os.environ.get("MASTERY_TAU_DAYS", "14"))


# --------------------------------------------------------------------------- #
# The floor: append-only study events
# --------------------------------------------------------------------------- #

def _ensure_collection(db: StandardDatabase):
    if not db.has_collection(EVENTS_COLLECTION):
        db.create_collection(EVENTS_COLLECTION)
    return db.collection(EVENTS_COLLECTION)


def record_quiz_event(
    section_key: str | None,
    tid: str | None,
    correct: bool,
    doc: str | None = None,
    stem: str | None = None,
    expected: str | None = None,
) -> None:
    """Append one graded quiz answer. No-op for whole-graph quizzes (no section
    to attribute). Never raises: event recording must not break the quiz flow."""
    if not section_key or not section_key.strip():
        return
    try:
        db = connect_arango()
        coll = _ensure_collection(db)
        coll.insert(
            {
                "section_key": section_key.strip(),
                "triple_id": tid or "",
                "correct": bool(correct),
                "ts": time.time(),
                "doc": doc or None,
                "stem": stem or None,
                "expected": expected or None,
            }
        )
    except Exception:
        pass


def _fetch_events(db: StandardDatabase, doc: str | None = None) -> list[dict[str, Any]]:
    if not db.has_collection(EVENTS_COLLECTION):
        return []
    # Untagged (legacy) events count in every doc scope.
    aql = """
    FOR e IN study_events
      FILTER @doc == null OR e.doc == @doc OR e.doc == null
      RETURN {
        section_key: e.section_key,
        triple_id: e.triple_id,
        correct: e.correct,
        ts: e.ts,
        doc: e.doc,
        stem: e.stem,
        expected: e.expected
      }
    """
    return list(db.aql.execute(aql, bind_vars={"doc": doc}))


def compute_activity(doc: str | None = None) -> dict[str, Any]:
    """Daily study volume (UTC) from the event floor, for a heatmap.

    Returns a sparse list of {date: 'YYYY-MM-DD', count} (days with no quizzes
    are omitted; the frontend lays out the full calendar grid).
    """
    try:
        db = connect_arango()
        events = _fetch_events(db, doc)
    except Exception as exc:  # noqa: BLE001 — surface as a soft error, never 500
        return {"days": [], "total": 0, "max": 0, "error": str(exc)}

    counts: dict[str, int] = {}
    for e in events:
        ts = e.get("ts")
        if not ts:
            continue
        day = time.strftime("%Y-%m-%d", time.gmtime(ts))
        counts[day] = counts.get(day, 0) + 1

    return {
        "days": [{"date": d, "count": c} for d, c in sorted(counts.items())],
        "total": sum(counts.values()),
        "max": max(counts.values()) if counts else 0,
    }


# --------------------------------------------------------------------------- #
# Pure math (no DB) — unit-testable
# --------------------------------------------------------------------------- #

def compute_leaf_mastery(
    events: list[dict[str, Any]],
    content_ids: set[str],
    total: int,
    now: float,
    alpha: float,
    beta: float,
    tau_days: float,
) -> dict[str, Any]:
    """Mastery for one leaf section from its own events.

    ``events`` are this section's quiz events; ``content_ids`` the triple_ids of
    its content triples; ``total`` their count (coverage denominator).
    """
    if not events:
        return {
            "mastery": 0.0,
            "coverage": 0.0,
            "accuracy": 0.0,
            "decay": 0.0,
            "attempts": 0,
            "lastSeen": None,
        }
    attempts = len(events)
    correct = sum(1 for e in events if e.get("correct"))
    accuracy = (correct + alpha) / (attempts + alpha + beta)

    tested = {e["triple_id"] for e in events if e.get("triple_id")}
    covered = len(tested & content_ids)
    coverage = (covered / total) if total > 0 else 0.0

    last_seen = max(e["ts"] for e in events)
    dt_days = max(0.0, (now - last_seen) / 86400.0)
    decay = math.exp(-dt_days / tau_days) if tau_days > 0 else 1.0

    return {
        "mastery": coverage * accuracy * decay,
        "coverage": coverage,
        "accuracy": accuracy,
        "decay": decay,
        "attempts": attempts,
        "lastSeen": last_seen,
    }


def collect_sections(
    forest: list[dict[str, Any]],
) -> tuple[dict[str, str], dict[str, str | None], dict[str, list[str]]]:
    """Walk the TOC forest → ({key: label}, {key: heading title}, {key: [child keys]}).

    Entity leaves (non-section nodes) are ignored. A section is a *leaf section*
    when its child-section list is empty.
    """
    labels: dict[str, str] = {}
    titles: dict[str, str | None] = {}
    children: dict[str, list[str]] = {}

    def visit(node: dict[str, Any], parent_key: str | None) -> None:
        key = node.get("sectionKey")
        if node.get("isSection") and key:
            labels[key] = node.get("label") or key
            titles[key] = node.get("title")
            children.setdefault(key, [])
            if parent_key:
                children[parent_key].append(key)
            parent_key = key
        for child in node.get("children", []) or []:
            visit(child, parent_key)

    for root in forest:
        visit(root, None)
    return labels, titles, children


def descendant_leaves(
    key: str, children: dict[str, list[str]], _seen: frozenset[str] = frozenset()
) -> list[str]:
    kids = children.get(key) or []
    # Guard against cyclic has_subsection edges: a node reached on its own path is
    # treated as a leaf so the walk terminates instead of recursing forever.
    if not kids or key in _seen:
        return [key]
    next_seen = _seen | {key}
    out: list[str] = []
    for k in kids:
        out.extend(descendant_leaves(k, children, next_seen))
    return out


def _weighted_average(pairs: list[tuple[float, float]]) -> float:
    num = sum(value * weight for value, weight in pairs)
    den = sum(weight for _value, weight in pairs)
    return (num / den) if den > 0 else 0.0


# --------------------------------------------------------------------------- #
# Top-level: DB-backed assembly
# --------------------------------------------------------------------------- #

def compute_mastery(now: float | None = None, doc: str | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    alpha, beta, tau = _alpha(), _beta(), _tau_days()

    forest, _edges, err, _mentions = get_toc_tree(doc)
    if err:
        return {"bySection": {}, "overall": 0.0, "weakest": [], "error": err}

    labels, titles, children = collect_sections(forest)
    leaf_keys = [k for k in labels if not children.get(k)]

    db = connect_arango()
    events = _fetch_events(db, doc)
    events_by_section: dict[str, list[dict[str, Any]]] = {}
    for e in events:
        sk = (e.get("section_key") or "").strip()
        if sk:
            events_by_section.setdefault(sk, []).append(e)

    leaf_stats: dict[str, dict[str, Any]] = {}
    weights: dict[str, int] = {}
    for k in leaf_keys:
        content_ids = {triple_id(t) for t in content_triples_for_section(k, doc=doc)}
        total = len(content_ids)
        weights[k] = total
        leaf_stats[k] = compute_leaf_mastery(
            events_by_section.get(k, []), content_ids, total, now, alpha, beta, tau
        )

    by_section: dict[str, dict[str, Any]] = {}
    for k in labels:
        if children.get(k):  # internal section → rollup over descendant leaves
            leaves = descendant_leaves(k, children)
            mastery = _weighted_average(
                [(leaf_stats[lk]["mastery"], weights[lk]) for lk in leaves if lk in leaf_stats]
            )
            attempts = sum(leaf_stats[lk]["attempts"] for lk in leaves if lk in leaf_stats)
            seen = [leaf_stats[lk]["lastSeen"] for lk in leaves if leaf_stats.get(lk, {}).get("lastSeen")]
            by_section[k] = {
                "mastery": mastery,
                "attempts": attempts,
                "lastSeen": max(seen) if seen else None,
                "isRollup": True,
            }
        else:  # leaf section → its own stats
            st = leaf_stats.get(k, {})
            by_section[k] = {
                "mastery": st.get("mastery", 0.0),
                "coverage": st.get("coverage", 0.0),
                "accuracy": st.get("accuracy", 0.0),
                "attempts": st.get("attempts", 0),
                "lastSeen": st.get("lastSeen"),
            }

    overall = _weighted_average([(leaf_stats[k]["mastery"], weights[k]) for k in leaf_keys])

    studyable = [k for k in leaf_keys if weights.get(k, 0) > 0]
    studyable.sort(key=lambda k: (leaf_stats[k]["mastery"], k))
    weakest = [
        {
            "sectionKey": k,
            "label": labels[k],
            "title": titles.get(k),
            "mastery": leaf_stats[k]["mastery"],
        }
        for k in studyable[:3]
    ]

    return {
        "bySection": by_section,
        "overall": overall,
        "weakest": weakest,
        "params": {"alpha": alpha, "beta": beta, "tauDays": tau},
    }
````

## File: assets/deploy/services/learn/app/math_markdown.py
````python
"""Normalize mathematical notation in PDF-derived Markdown for KaTeX / MathJax."""

from __future__ import annotations

import re

# Common PDF text-layer replacements (U+FFFD) when fonts lack Unicode cmap.
_REPLACEMENT_CHAR = "\ufffd"

# Unicode superscript / subscript digits and signs → LaTeX exponents/subscripts.
_SUPER_CHARS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"
_SUPER_TO_ASCII = "0123456789+-=()ni"
_SUB_CHARS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎"
_SUB_TO_ASCII = "0123456789+-=()"

# Greek and common math symbols → LaTeX command (no leading backslash in value).
_MATH_SYMBOL_MAP: dict[str, str] = {
    "α": r"\alpha",
    "β": r"\beta",
    "γ": r"\gamma",
    "δ": r"\delta",
    "ε": r"\epsilon",
    "ζ": r"\zeta",
    "η": r"\eta",
    "θ": r"\theta",
    "ι": r"\iota",
    "κ": r"\kappa",
    "λ": r"\lambda",
    "μ": r"\mu",
    "ν": r"\nu",
    "ξ": r"\xi",
    "π": r"\pi",
    "ρ": r"\rho",
    "σ": r"\sigma",
    "τ": r"\tau",
    "υ": r"\upsilon",
    "φ": r"\phi",
    "χ": r"\chi",
    "ψ": r"\psi",
    "ω": r"\omega",
    "Γ": r"\Gamma",
    "Δ": r"\Delta",
    "Θ": r"\Theta",
    "Λ": r"\Lambda",
    "Ξ": r"\Xi",
    "Π": r"\Pi",
    "Σ": r"\Sigma",
    "Υ": r"\Upsilon",
    "Φ": r"\Phi",
    "Ψ": r"\Psi",
    "Ω": r"\Omega",
    "∞": r"\infty",
    "±": r"\pm",
    "∓": r"\mp",
    "×": r"\times",
    "÷": r"\div",
    "·": r"\cdot",
    "∘": r"\circ",
    "∙": r"\bullet",
    "√": r"\sqrt",
    "∑": r"\sum",
    "∏": r"\prod",
    "∫": r"\int",
    "∂": r"\partial",
    "∇": r"\nabla",
    "≤": r"\leq",
    "≥": r"\geq",
    "≠": r"\neq",
    "≈": r"\approx",
    "≡": r"\equiv",
    "≪": r"\ll",
    "≫": r"\gg",
    "∈": r"\in",
    "∉": r"\notin",
    "⊂": r"\subset",
    "⊃": r"\supset",
    "⊆": r"\subseteq",
    "⊇": r"\supseteq",
    "∪": r"\cup",
    "∩": r"\cap",
    "∧": r"\land",
    "∨": r"\lor",
    "¬": r"\neg",
    "∀": r"\forall",
    "∃": r"\exists",
    "∅": r"\emptyset",
    "→": r"\rightarrow",
    "←": r"\leftarrow",
    "↔": r"\leftrightarrow",
    "⇒": r"\Rightarrow",
    "⇐": r"\Leftarrow",
    "⇔": r"\Leftrightarrow",
    "ℝ": r"\mathbb{R}",
    "ℤ": r"\mathbb{Z}",
    "ℕ": r"\mathbb{N}",
    "ℚ": r"\mathbb{Q}",
    "ℂ": r"\mathbb{C}",
    "½": r"\frac{1}{2}",
    "⅓": r"\frac{1}{3}",
    "¼": r"\frac{1}{4}",
    "¾": r"\frac{3}{4}",
    "°": r"^{\circ}",
    "′": r"'",
    "″": r"''",
    "…": r"\ldots",
    "−": r"-",  # unicode minus
    "―": r"-",
    "‖": r"\|",
    "⟨": r"\langle",
    "⟩": r"\rangle",
    "⌊": r"\lfloor",
    "⌋": r"\rfloor",
    "⌈": r"\lceil",
    "⌉": r"\rceil",
}

# Mathematical alphanumeric symbols (italic/bold Unicode) → ASCII for LaTeX math mode.
_MATH_ALPHABET_RANGES: list[tuple[int, int, str]] = [
    (0x1D434, 0x1D467, "A"),  # italic capitals
    (0x1D468, 0x1D49B, "a"),  # italic small
    (0x1D49C, 0x1D4CF, "A"),  # script capitals (approximate)
    (0x1D4D0, 0x1D503, "a"),
    (0x1D5A0, 0x1D5D3, "A"),  # sans-serif bold capitals
    (0x1D5D4, 0x1D607, "a"),
    (0x1D608, 0x1D63B, "A"),  # sans-serif italic capitals
    (0x1D63C, 0x1D66F, "a"),
]

_FENCE_RE = re.compile(r"^```[\w-]*$")

# A protected-code placeholder: NUL + index + NUL. NUL never appears in markdown,
# is matched by no math heuristic, and is easy to restore.
_CODE_PLACEHOLDER = re.compile("\x00(\\d+)\x00")

# Signals that an `ident = expr` span is actually math, not prose (e.g. "the = symbol").
# `=` itself doesn't count — it's always present in the candidate.
_INLINE_MATH_SIGNAL = re.compile(r"[0-9^_\\+\-*/<>]")


def _protect_code(text: str) -> tuple[str, "re.Pattern | object"]:
    """Mask fenced and inline code so no math heuristic can touch it.

    Returns ``(masked_text, restore)`` where ``restore(s)`` re-inserts the
    original code segments verbatim.
    """
    store: list[str] = []

    def stash(m: re.Match[str]) -> str:
        store.append(m.group(0))
        return f"\x00{len(store) - 1}\x00"

    masked = re.sub(r"```.*?```", stash, text, flags=re.DOTALL)
    masked = re.sub(r"`[^`\n]+`", stash, masked)

    def restore(s: str) -> str:
        return _CODE_PLACEHOLDER.sub(lambda m: store[int(m.group(1))], s)

    return masked, restore


def _super_to_ascii(chunk: str) -> str:
    table = str.maketrans(_SUPER_CHARS, _SUPER_TO_ASCII)
    return chunk.translate(table)


def _sub_to_ascii(chunk: str) -> str:
    table = str.maketrans(_SUB_CHARS, _SUB_TO_ASCII)
    return chunk.translate(table)


def _convert_super_sub_scripts(text: str) -> str:
    """Turn unicode super/sub scripts into LaTeX ^{} / _{} on adjacent identifiers."""

    def repl_super(m: re.Match[str]) -> str:
        base, sup = m.group(1), m.group(2)
        return f"{base}^{{{_super_to_ascii(sup)}}}"

    def repl_sub(m: re.Match[str]) -> str:
        base, sub = m.group(1), m.group(2)
        return f"{base}_{{{_sub_to_ascii(sub)}}}"

    text = re.sub(
        rf"([A-Za-z0-9])\s*([{_SUPER_CHARS}]+)",
        repl_super,
        text,
    )
    text = re.sub(
        rf"([A-Za-z0-9])\s*([{_SUB_CHARS}]+)",
        repl_sub,
        text,
    )
    return text


def _normalize_math_alphabet(text: str) -> str:
    out: list[str] = []
    for ch in text:
        o = ord(ch)
        mapped = None
        for start, end, base in _MATH_ALPHABET_RANGES:
            if start <= o <= end:
                mapped = base[o - start] if o - start < len(base) else ch
                break
        out.append(mapped if mapped is not None else ch)
    return "".join(out)


def _replace_math_symbols(text: str) -> str:
    """Replace unicode math glyphs with LaTeX commands (outside existing $...$)."""
    parts = re.split(r"(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)", text)
    for i in range(0, len(parts), 2):
        chunk = parts[i]
        for sym, latex in sorted(_MATH_SYMBOL_MAP.items(), key=lambda x: -len(x[0])):
            chunk = chunk.replace(sym, latex)
        parts[i] = chunk
    return "".join(parts)


def _wrap_display_equation_lines(text: str) -> str:
    lines = text.split("\n")
    out: list[str] = []
    in_fence = False

    for line in lines:
        stripped = line.strip()
        if _FENCE_RE.match(stripped):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence or not stripped:
            out.append(line)
            continue
        if "\x00" in stripped:  # protected code placeholder — never wrap
            out.append(line)
            continue
        if stripped.startswith("$$") and stripped.endswith("$$"):
            out.append(line)
            continue
        if stripped.startswith("$") and stripped.endswith("$") and stripped.count("$") >= 2:
            out.append(line)
            continue
        # Centered short equation lines (common in PDF exports).
        math_chars = sum(
            1
            for c in stripped
            if c in _MATH_SYMBOL_MAP
            or c in _SUPER_CHARS
            or c in _SUB_CHARS
            or c in "+-=()[]{}^_\\0123456789./"
            or ("α" <= c <= "ω")
            or ("Α" <= c <= "Ω")
        )
        density = math_chars / max(len(stripped), 1)
        if density >= 0.55 and len(stripped) <= 200 and not stripped.startswith("#"):
            out.append(f"$${stripped}$$")
            continue
        out.append(line)

    return "\n".join(out)


def _wrap_simple_inline_equations(text: str) -> str:
    """Wrap patterns like E=mc^2, f(x)=..., σ² when not already delimited."""

    def wrap_eq(m: re.Match[str]) -> str:
        expr = m.group(1).strip()
        if not expr or "$" in expr or "\x00" in expr:
            return m.group(0)
        # Require a real math signal so prose ("the = symbol") isn't wrapped.
        if not _INLINE_MATH_SIGNAL.search(expr):
            return m.group(0)
        return f"${expr}$"

    # Identifier = expression (includes LaTeX fragments from symbol pass).
    text = re.sub(
        r"(?<!\$)(?<![\\\w])([A-Za-z][A-Za-z0-9]*(?:_\{[^}]+\}|\^[^{]+|\^{[^}]+})?"
        r"\s*=\s*[^$\n]{1,80}?)(?=\s|[,.;:!?\n]|$)",
        wrap_eq,
        text,
    )
    return text


def _collapse_duplicate_delimiters(text: str) -> str:
    # Drop empty display blocks ($$ $$) and empty inline math ($ $). The inline
    # rule requires *actual whitespace* between the dollars ([ \t]+) so it never
    # eats the adjacent `$$` of a real display equation like $$x = y$$ — that
    # collateral match (from the old \$(\s*)\$) silently stripped every decoded
    # display formula once Docling formula-enrichment started emitting them.
    text = re.sub(r"\$\$\s*\$\$", "", text)
    text = re.sub(r"\$([ \t]+)\$", r"\1", text)
    return text


def normalize_math_in_markdown(text: str, *, profile: str = "full") -> str:
    """Post-process PDF-derived Markdown so formulas use LaTeX delimiters.

    ``profile`` selects how aggressive the rewriting is:

    - ``"full"`` (pymupdf4llm fallback): the original heuristics — unicode→LaTeX
      symbol/script mapping plus display- and inline-equation wrapping — but now
      every transform runs with fenced and inline code masked out, and the inline
      wrapper requires a real math signal (so prose like "the = symbol" is left
      alone).
    - ``"light"`` (Docling, the default converter): Docling's text is already
      clean, so we trust it and only collapse stray empty ``$$`` delimiters. We
      deliberately skip symbol mapping here: converting ``≤`` → ``\\leq`` outside a
      wrapped equation would render the literal backslash command, which is worse
      than the perfectly readable unicode glyph.

    Code is always preserved verbatim.
    """
    if not text or not text.strip():
        return text

    masked, restore = _protect_code(text)

    if profile == "light":
        return restore(_collapse_duplicate_delimiters(masked))

    masked = _normalize_math_alphabet(masked)
    masked = _convert_super_sub_scripts(masked)
    masked = _replace_math_symbols(masked)
    masked = _wrap_display_equation_lines(masked)
    masked = _wrap_simple_inline_equations(masked)
    masked = _collapse_duplicate_delimiters(masked)
    return restore(masked)


def replacement_char_ratio(text: str) -> float:
    if not text:
        return 0.0
    return text.count(_REPLACEMENT_CHAR) / len(text)
````

## File: assets/deploy/services/learn/app/pdf_convert.py
````python
"""PDF to Markdown conversion for txt2kg ingestion (digital/text PDFs)."""

from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

from app.arango_content import persist_document
from app.math_markdown import normalize_math_in_markdown
from app.reader import PdfConvertError, convert_document

# Limits are env-tunable; 0 disables a limit. Conversion runs as a background job, so there's
# no request-timeout reason to cap page count — default it OFF (unlimited). The byte limit is a
# memory safety valve (the whole PDF is read into RAM), defaulting generously to 500 MB.
MAX_PDF_PAGES = int(os.environ.get("LEARN_MAX_PDF_PAGES", "0"))  # 0 = unlimited
MAX_PDF_BYTES = int(os.environ.get("LEARN_MAX_PDF_MB", "500")) * 1024 * 1024  # 0 = unlimited
PDF_MAGIC = b"%PDF"

__all__ = [
    "ConvertResult",
    "PdfConvertError",
    "convert_pdf_bytes",
    "pdf_convert_health",
]


@dataclass
class ConvertResult:
    markdown: str
    source_filename: str
    output_filename: str
    page_count: int
    saved_path: str | None
    doc_id: str | None
    engine: str
    has_page_provenance: bool = False


def _normalize_markdown(text: str, engine: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    # Docling output is clean; the heavy heuristics are only for messy pymupdf text.
    profile = "light" if engine == "docling" else "full"
    text = normalize_math_in_markdown(text, profile=profile)
    return text.strip()


def _output_name(source_filename: str) -> str:
    base = Path(source_filename).name
    if base.lower().endswith(".pdf"):
        return base[:-4] + ".md"
    return base + ".md"


def _save_artifacts(data: bytes, markdown: str, source_filename: str, job_id: str) -> str | None:
    shared = os.environ.get("SHARED_DIR", "/shared")
    ingest_root = Path(shared) / "ingest"
    job_dir = ingest_root / job_id
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "original.pdf").write_bytes(data)
        md_path = job_dir / "converted.md"
        md_path.write_text(markdown, encoding="utf-8")
        return str(md_path)
    except OSError:
        return None


def convert_pdf_bytes(data: bytes, filename: str, *, save: bool = True) -> ConvertResult:
    if not data.startswith(PDF_MAGIC):
        raise PdfConvertError("File does not look like a PDF (%PDF header missing).", 400)
    if MAX_PDF_BYTES and len(data) > MAX_PDF_BYTES:
        raise PdfConvertError(f"PDF exceeds maximum size ({MAX_PDF_BYTES // (1024 * 1024)} MB).", 413)

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:
        raise PdfConvertError(f"Could not open PDF: {e}", 400) from e

    page_count = doc.page_count
    doc.close()
    if page_count == 0:
        raise PdfConvertError("PDF has no pages.", 400)
    if MAX_PDF_PAGES and page_count > MAX_PDF_PAGES:
        raise PdfConvertError(f"PDF exceeds maximum page count ({MAX_PDF_PAGES}).", 413)

    converted = convert_document(data, filename or "document.pdf")
    engine = converted.engine

    markdown = _normalize_markdown(converted.markdown or "", engine)
    if not markdown:
        raise PdfConvertError(
            "No extractable text found. This may be a scanned PDF; OCR is not enabled in v1.",
            400,
        )

    # Page-provenance side channels: ordered (heading text, page) and per-page markdown.
    # Page markdown is stored as-is (pymupdf source view); the high-fidelity reader uses
    # the Docling section markdown above.
    heading_pages = [(hp.text, hp.page_no) for hp in converted.heading_pages]
    pages = [(pt.page_no, pt.markdown) for pt in converted.pages]
    has_page_provenance = bool(pages) and bool(heading_pages)

    output_filename = _output_name(filename or "document.pdf")
    doc_id = str(uuid.uuid4())
    saved_path = _save_artifacts(data, markdown, filename, doc_id) if save else None
    persisted_id = (
        persist_document(
            doc_id=doc_id,
            title=Path(filename or "document.pdf").stem,
            source_filename=filename or "document.pdf",
            markdown=markdown,
            page_count=page_count,
            heading_pages=heading_pages,
            pages=pages,
            outline=converted.outline,
        )
        if save
        else None
    )

    return ConvertResult(
        markdown=markdown,
        source_filename=filename or "document.pdf",
        output_filename=output_filename,
        page_count=page_count,
        saved_path=saved_path,
        doc_id=persisted_id,
        engine=engine,
        has_page_provenance=has_page_provenance,
    )


def pdf_convert_health() -> dict[str, str]:
    """Report converter availability (selected engine + fallback)."""
    from app.reader import converter_health

    return converter_health()
````

## File: assets/deploy/services/learn/app/quiz_gen.py
````python
"""Exam question generation: deterministic builder + optional Ollama enrichment.

This module is intentionally free of database/HTTP imports at module scope so the
pure generation logic can be unit-tested without ArangoDB or Ollama. The Ollama
client is imported lazily inside ``generate_llm_questions``.

A *question* is a dict with the full server-side shape::

    {
      "id": "q1",
      "stem": str,
      "choices": [str, str, str, str],
      "answer_index": int,        # correct index into choices
      "expected": str,            # choices[answer_index]
      "explanation": str,
      "triple": {subject,predicate,object} | None,
      "source": "deterministic" | "llm",
    }

Use ``public_question`` to produce the client-facing form (answers withheld).
"""

from __future__ import annotations

import json
import random
from typing import Any

Triple = dict[str, str]
Question = dict[str, Any]

MAX_LLM_TRIPLE_LINES = 80

EXAM_AUTHOR_SYSTEM = (
    "You are an exam author. Using ONLY the knowledge-graph triples provided "
    "(each line is `subject | predicate | object`), write multiple-choice exam "
    "questions that check understanding of the material.\n"
    "Rules:\n"
    "- Each question tests exactly one fact supported by the triples.\n"
    "- Provide exactly 4 options: one correct answer and three plausible but "
    "wrong distractors drawn from other entities in the triples.\n"
    "- Do not invent facts outside the triples.\n"
    "- Output STRICT JSON only, no prose, no code fences, in this exact shape:\n"
    '{"questions": [{"stem": "...", "options": ["...","...","...","..."], '
    '"answerIndex": 0, "explanation": "..."}]}'
)


# --------------------------------------------------------------------------- #
# Pure helpers (generation-local; no DB import)
# --------------------------------------------------------------------------- #

def _triple_line(t: Triple) -> str:
    return f'{t["subject"]} | {t["predicate"]} | {t["object"]}'


def _format_triples_block(triples: list[Triple], max_lines: int = MAX_LLM_TRIPLE_LINES) -> str:
    lines = [_triple_line(t) for t in triples[:max_lines]]
    body = "\n".join(lines)
    if len(triples) > max_lines:
        body += f"\n... ({len(triples) - max_lines} more triples omitted)"
    return body


def _entity_pool(triples: list[Triple], exclude: set[str]) -> list[str]:
    pool: set[str] = set()
    for t in triples:
        pool.add(t["subject"])
        pool.add(t["object"])
    pool -= exclude
    return sorted(pool, key=str.casefold)


def _predicate_pool(triples: list[Triple], exclude: set[str]) -> list[str]:
    pool: set[str] = {t["predicate"] for t in triples}
    pool -= exclude
    return sorted(pool, key=str.casefold)


def _finalize_choices(
    correct: str, distractors: list[str], rng: random.Random
) -> tuple[list[str], int]:
    """Assemble exactly 4 unique choices (correct + up to 3 distractors), padded, shuffled."""
    choices = [correct]
    for d in distractors:
        if len(choices) >= 4:
            break
        if d and d != correct and d not in choices:
            choices.append(d)
    pad = 0
    while len(choices) < 4:
        pad += 1
        choices.append(f"(none of these · {pad})")
    rng.shuffle(choices)
    return choices, choices.index(correct)


def _make_question(
    stem: str,
    choices: list[str],
    answer_index: int,
    triple: Triple | None,
    source: str,
    explanation: str | None = None,
) -> Question:
    if explanation is None:
        explanation = f"Stored triple: {_triple_line(triple)}" if triple else ""
    return {
        "stem": stem,
        "choices": choices,
        "answer_index": answer_index,
        "expected": choices[answer_index],
        "explanation": explanation,
        "triple": triple,
        "source": source,
    }


# --------------------------------------------------------------------------- #
# Deterministic question variants
# --------------------------------------------------------------------------- #

def _object_question(t: Triple, triples: list[Triple], rng: random.Random) -> Question:
    correct = t["object"]
    pool = _entity_pool(triples, {correct, t["subject"]})
    rng.shuffle(pool)
    choices, ai = _finalize_choices(correct, pool, rng)
    stem = f'In the knowledge graph: «{t["subject"]}» — {t["predicate"]} — ?'
    return _make_question(stem, choices, ai, t, "deterministic")


def _subject_question(t: Triple, triples: list[Triple], rng: random.Random) -> Question:
    correct = t["subject"]
    pool = _entity_pool(triples, {correct, t["object"]})
    rng.shuffle(pool)
    choices, ai = _finalize_choices(correct, pool, rng)
    stem = f'In the knowledge graph: ? — {t["predicate"]} — «{t["object"]}». What is the subject?'
    return _make_question(stem, choices, ai, t, "deterministic")


def _predicate_question(t: Triple, triples: list[Triple], rng: random.Random) -> Question:
    correct = t["predicate"]
    pool = _predicate_pool(triples, {correct})
    rng.shuffle(pool)
    choices, ai = _finalize_choices(correct, pool, rng)
    stem = f'Which relationship connects «{t["subject"]}» to «{t["object"]}»?'
    return _make_question(stem, choices, ai, t, "deterministic")


# object weighted x2 vs subject/predicate
_VARIANTS = (_object_question, _object_question, _subject_question, _predicate_question)


def _candidate_triples(triples: list[Triple]) -> list[Triple]:
    return [
        t
        for t in triples
        if t.get("subject") and t.get("object") and t.get("predicate")
        and t["subject"] != t["object"]
    ]


def build_deterministic_questions(
    triples: list[Triple], count: int, rng: random.Random | None = None
) -> list[Question]:
    rng = rng or random.Random()
    candidates = _candidate_triples(triples)
    rng.shuffle(candidates)
    out: list[Question] = []
    seen: set[str] = set()
    for t in candidates:
        if len(out) >= count:
            break
        builder = rng.choice(_VARIANTS)
        q = builder(t, triples, rng)
        key = q["stem"].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
    return out


# --------------------------------------------------------------------------- #
# LLM parsing / validation
# --------------------------------------------------------------------------- #

def _extract_json(text: str) -> Any:
    if not isinstance(text, str):
        return None
    t = text.strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    i, j = t.find("{"), t.rfind("}")
    if i != -1 and j != -1 and j > i:
        try:
            return json.loads(t[i : j + 1])
        except Exception:
            return None
    return None


def _validate_llm_item(item: Any) -> Question | None:
    if not isinstance(item, dict):
        return None
    stem = item.get("stem")
    options = item.get("options")
    ai = item.get("answerIndex")
    if not isinstance(stem, str) or not stem.strip():
        return None
    if not isinstance(options, list) or len(options) != 4:
        return None
    opts = [o.strip() for o in options if isinstance(o, str) and o.strip()]
    if len(opts) != 4 or len(set(opts)) != 4:
        return None
    # bool is a subclass of int — reject it explicitly
    if isinstance(ai, bool) or not isinstance(ai, int) or not (0 <= ai < 4):
        return None
    explanation = item.get("explanation")
    explanation = explanation.strip() if isinstance(explanation, str) else ""
    return _make_question(stem.strip(), opts, ai, None, "llm", explanation=explanation)


def parse_llm_questions(raw: str, max_items: int) -> list[Question]:
    data = _extract_json(raw)
    if not isinstance(data, dict):
        return []
    items = data.get("questions")
    if not isinstance(items, list):
        return []
    out: list[Question] = []
    for it in items:
        q = _validate_llm_item(it)
        if q is not None:
            out.append(q)
        if len(out) >= max_items:
            break
    return out


def generate_llm_questions(triples: list[Triple], count: int) -> list[Question]:
    """Best-effort LLM generation. Returns [] on any error (caller falls back)."""
    block = _format_triples_block(triples)
    user = (
        f"Write {count} multiple-choice questions from these triples. "
        f"Return strict JSON as specified.\n\nTriples:\n{block}"
    )
    try:
        from app.llm import ollama_chat_completion
    except Exception:
        return []
    messages = [
        {"role": "system", "content": EXAM_AUTHOR_SYSTEM},
        {"role": "user", "content": user},
    ]
    reply, err = ollama_chat_completion(messages, temperature=0.2)
    if err or not reply:
        return []
    return parse_llm_questions(reply, count)


# --------------------------------------------------------------------------- #
# Top-level assembly
# --------------------------------------------------------------------------- #

def build_exam(
    triples: list[Triple],
    count: int = 8,
    use_llm: bool = True,
    rng: random.Random | None = None,
) -> list[Question]:
    """Build up to ``count`` questions: LLM-authored first (if enabled), then
    deterministic to fill any shortfall. Returns fewer than ``count`` only when
    the triple set is too small. Every question is fully validated."""
    rng = rng or random.Random()
    if not _candidate_triples(triples):
        return []

    questions: list[Question] = []
    seen: set[str] = set()

    if use_llm:
        for q in generate_llm_questions(triples, count):
            key = q["stem"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            questions.append(q)
            if len(questions) >= count:
                break

    if len(questions) < count:
        for q in build_deterministic_questions(triples, count * 2, rng):
            key = q["stem"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            questions.append(q)
            if len(questions) >= count:
                break

    questions = questions[:count]
    for i, q in enumerate(questions):
        q["id"] = f"q{i + 1}"
    return questions


def public_question(q: Question) -> dict[str, Any]:
    """Client-facing view of a question — answers/explanation/triple withheld."""
    return {"id": q["id"], "stem": q["stem"], "choices": q["choices"]}
````

## File: assets/deploy/services/learn/app/rate_limit.py
````python
"""Simple per-IP sliding-window rate limit for chat."""

from __future__ import annotations

import time
from threading import Lock

_lock = Lock()
_hits: dict[str, list[float]] = {}


def check_rate_limit(client_ip: str, max_per_minute: int = 30) -> bool:
    """Return True if allowed, False if rate limited."""
    now = time.monotonic()
    cutoff = now - 60.0
    with _lock:
        # Sweep fully-expired IPs so the table doesn't grow without bound for
        # clients that hit once and never return (cheap: low cardinality here).
        for ip in [ip for ip, ts in _hits.items() if not ts or ts[-1] < cutoff]:
            del _hits[ip]

        arr = _hits.setdefault(client_ip, [])
        while arr and arr[0] < cutoff:
            arr.pop(0)
        if len(arr) >= max_per_minute:
            return False
        arr.append(now)
    return True
````

## File: assets/deploy/services/learn/app/reader.py
````python
"""Pluggable PDF -> Markdown converters behind a small ``Converter`` interface.

Docling is the higher-fidelity default (hierarchical headings, better tables/math);
``pymupdf4llm`` remains the always-available fallback. Selection is via the
``LEARN_CONVERTER`` env var ("docling" | "pymupdf"); if the chosen engine fails to
import or convert, we fall back to pymupdf so ingestion never hard-breaks.

Page provenance: alongside the full-document markdown we collect (a) per-heading page
numbers from Docling's structured document (``iterate_items`` → ``prov[0].page_no``) and
(b) per-page markdown via ``pymupdf4llm(page_chunks=True)``. ``arango_content`` joins
these into page-primary blocks tagged with their section coordinates. We deliberately do
NOT re-serialize Docling per item (that would risk the decoded ``$$`` formula markdown);
the per-page text for the "source page" view comes from pymupdf, which is fast and always
available, while the high-fidelity reader/section markdown stays Docling's.
"""

from __future__ import annotations

import io
import os
import re
import threading
from dataclasses import dataclass, field
from typing import Protocol

import fitz  # PyMuPDF
import pymupdf4llm

from app.math_markdown import replacement_char_ratio

# A single converter instance is reused across requests so Docling's heavy formula/layout
# models load ONCE, not per conversion (which was slow + churned GPU memory → "fetch
# failed" / restart crashes). The lock guards the first (model-loading) build.
_CONVERTER_CACHE: dict[str, "Converter"] = {}
_CONVERTER_LOCK = threading.Lock()

_ATX_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_HEADING_LABELS = {"section_header", "title"}


@dataclass
class HeadingPage:
    """A heading and the 1-based PDF page it starts on (reading order)."""

    text: str
    page_no: int


@dataclass
class PageText:
    """Per-page markdown for the page-primary store."""

    page_no: int  # 1-based
    markdown: str


@dataclass
class ConvertedDoc:
    """Full-document markdown plus page-provenance side channels."""

    markdown: str
    engine: str
    heading_pages: list[HeadingPage] = field(default_factory=list)
    pages: list[PageText] = field(default_factory=list)
    outline: list[dict] = field(default_factory=list)  # embedded PDF bookmarks (the real TOC)


class PdfConvertError(Exception):
    """User-facing conversion failure."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class Converter(Protocol):
    name: str

    def to_markdown(self, data: bytes, filename: str) -> str: ...


class PyMuPDFConverter:
    """Fast, dependency-light extraction via pymupdf4llm (the original engine)."""

    name = "pymupdf4llm"

    def to_markdown(self, data: bytes, filename: str) -> str:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            kwargs: dict = {"detect_bg_color": True, "force_text": True}
            primary = pymupdf4llm.to_markdown(doc, **kwargs) or ""
            if replacement_char_ratio(primary) > 0.002:
                try:
                    alt = pymupdf4llm.to_markdown(doc, use_glyphs=True, **kwargs) or ""
                    if replacement_char_ratio(alt) < replacement_char_ratio(primary):
                        return alt
                except TypeError:
                    pass
            return primary
        finally:
            doc.close()


class DoclingConverter:
    """Higher-fidelity conversion via Docling (lazy-imported so it's optional).

    Docling's neural models (layout + TableFormer) run on the GB10 GPU via the
    cu130 torch wheel when the container has device access; otherwise it degrades
    to CPU. OCR stays off — v1 targets digital/text PDFs, and skipping it keeps the
    GPU models the bottleneck instead of slow per-page OCR.
    """

    name = "docling"

    def __init__(self) -> None:
        self._converter = None
        # Captured from the most recent ``to_markdown`` call so ``convert_document``
        # can read per-heading page numbers without re-running Docling.
        self.last_heading_pages: list[HeadingPage] = []

    def _get_converter(self):
        if self._converter is not None:
            return self._converter
        with _CONVERTER_LOCK:
            if self._converter is not None:  # another thread built it while we waited
                return self._converter
            import torch
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import (
                AcceleratorDevice,
                AcceleratorOptions,
                PdfPipelineOptions,
            )
            from docling.document_converter import DocumentConverter, PdfFormatOption

            device = AcceleratorDevice.CUDA if torch.cuda.is_available() else AcceleratorDevice.AUTO
            pipeline_options = PdfPipelineOptions()
            pipeline_options.accelerator_options = AcceleratorOptions(device=device)
            pipeline_options.do_ocr = False
            # Decode formula regions into LaTeX (rendered as $$...$$) instead of
            # emitting Docling's "<!-- formula-not-decoded -->" placeholder, which
            # the reader shows as a blank gap. Runs the CodeFormula model on the GPU.
            # If the source is a scanned/image PDF and formulas still don't decode,
            # the next lever is enabling do_ocr above (slower).
            pipeline_options.do_formula_enrichment = True

            self._converter = DocumentConverter(
                format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
            )
        return self._converter

    def to_markdown(self, data: bytes, filename: str) -> str:
        from docling.datamodel.base_models import DocumentStream

        source = DocumentStream(name=filename or "document.pdf", stream=io.BytesIO(data))
        result = self._get_converter().convert(source)
        document = result.document
        self.last_heading_pages = _docling_heading_pages(document)
        return document.export_to_markdown() or ""


def _docling_heading_pages(document) -> list[HeadingPage]:
    """Per-heading (text, 1-based page) in reading order from a DoclingDocument.

    Reads ``label``/``text``/``prov[0].page_no`` off section-header and title items.
    Best-effort: returns ``[]`` on any structural surprise so ingestion never breaks.
    """
    out: list[HeadingPage] = []
    try:
        for item, _level in document.iterate_items():
            label = str(getattr(item, "label", "")).lower()
            text = getattr(item, "text", None)
            prov = getattr(item, "prov", None)
            if label in _HEADING_LABELS and text and prov:
                out.append(HeadingPage(text=str(text), page_no=int(prov[0].page_no)))
    except Exception:
        return []
    return out


def _heading_pages_from_pages(pages: list[PageText]) -> list[HeadingPage]:
    """Derive heading pages from per-page markdown (used when Docling isn't the engine)."""
    out: list[HeadingPage] = []
    for page in pages:
        for line in page.markdown.split("\n"):
            m = _ATX_RE.match(line)
            if m:
                out.append(HeadingPage(text=m.group(2).strip(), page_no=page.page_no))
    return out


def extract_pages(data: bytes) -> list[PageText]:
    """Per-page markdown via ``pymupdf4llm(page_chunks=True)`` (1-based ``metadata.page``)."""
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        chunks = (
            pymupdf4llm.to_markdown(
                doc, page_chunks=True, detect_bg_color=True, force_text=True
            )
            or []
        )
    except Exception:
        chunks = []
    finally:
        doc.close()

    out: list[PageText] = []
    for ch in chunks:
        if not isinstance(ch, dict):
            continue
        page_no = (ch.get("metadata") or {}).get("page")
        if page_no is None:
            continue
        out.append(PageText(page_no=int(page_no), markdown=(ch.get("text") or "").strip()))
    return out


def extract_pdf_outline(data: bytes) -> list[dict]:
    """The PDF's embedded outline / bookmarks — the author's real Table of Contents — via
    PyMuPDF. Returns ``[{level, title, page}]`` (1-based page, level>=1) in reading order, or
    ``[]`` when the PDF has no bookmarks (scanned/stripped PDFs fall back to TOC-page parsing)."""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            toc = doc.get_toc(simple=True) or []
        finally:
            doc.close()
    except Exception:
        return []
    out: list[dict] = []
    for row in toc:
        try:
            level, title, page = int(row[0]), str(row[1]).strip(), int(row[2])
        except Exception:
            continue
        if title and page > 0:
            out.append({"level": max(1, level), "title": title, "page": page})
    return out


def _make_converter(name: str) -> Converter:
    if name == "pymupdf":
        return PyMuPDFConverter()
    return DoclingConverter()


def select_converter() -> Converter:
    name = (os.environ.get("LEARN_CONVERTER") or "docling").strip().lower()
    key = "pymupdf" if name == "pymupdf" else "docling"
    conv = _CONVERTER_CACHE.get(key)
    if conv is None:
        conv = _make_converter(name)
        _CONVERTER_CACHE[key] = conv
    return conv


def convert_to_markdown(data: bytes, filename: str) -> tuple[str, str]:
    """Run the configured converter, falling back to pymupdf4llm on any failure.

    Returns ``(markdown, engine_name)``. Page provenance is collected separately by
    ``convert_document`` (which wraps this).
    """
    primary = select_converter()
    try:
        md = primary.to_markdown(data, filename)
        if md and md.strip():
            return md, primary.name
        if primary.name != "pymupdf4llm":
            raise PdfConvertError("Converter produced no text", 500)
        return md, primary.name
    except PdfConvertError:
        raise
    except Exception as exc:  # noqa: BLE001 - any converter failure should degrade gracefully
        if primary.name == PyMuPDFConverter.name:
            raise PdfConvertError(f"PDF conversion failed: {exc}", 500) from exc
        fallback = PyMuPDFConverter()
        try:
            return fallback.to_markdown(data, filename), fallback.name
        except Exception as fexc:  # noqa: BLE001
            raise PdfConvertError(f"PDF conversion failed: {fexc}", 500) from fexc


def convert_document(data: bytes, filename: str) -> ConvertedDoc:
    """Full-document markdown + page provenance (heading pages + per-page markdown).

    Mirrors ``convert_to_markdown``'s engine selection + pymupdf fallback, but also
    captures Docling's per-heading page numbers and always extracts per-page markdown
    (cheap pymupdf pass) for the page-primary store.
    """
    primary = select_converter()
    heading_pages: list[HeadingPage] = []
    try:
        md = primary.to_markdown(data, filename)
        engine = primary.name
        heading_pages = list(getattr(primary, "last_heading_pages", []) or [])
        if not (md and md.strip()) and primary.name != PyMuPDFConverter.name:
            raise PdfConvertError("Converter produced no text", 500)
    except PdfConvertError:
        raise
    except Exception as exc:  # noqa: BLE001
        if primary.name == PyMuPDFConverter.name:
            raise PdfConvertError(f"PDF conversion failed: {exc}", 500) from exc
        fallback = PyMuPDFConverter()
        try:
            md = fallback.to_markdown(data, filename)
            engine = fallback.name
            heading_pages = []
        except Exception as fexc:  # noqa: BLE001
            raise PdfConvertError(f"PDF conversion failed: {fexc}", 500) from fexc

    pages = extract_pages(data)
    if not heading_pages:
        # Docling not used (or gave nothing) — derive heading pages from per-page markdown.
        heading_pages = _heading_pages_from_pages(pages)
    outline = extract_pdf_outline(data)
    return ConvertedDoc(
        markdown=md, engine=engine, heading_pages=heading_pages, pages=pages, outline=outline
    )


def converter_health() -> dict[str, str]:
    selected = (os.environ.get("LEARN_CONVERTER") or "docling").strip().lower()
    docling_available = "no"
    try:
        import docling  # noqa: F401

        docling_available = "yes"
    except Exception:  # noqa: BLE001
        docling_available = "no"

    device = "cpu"
    try:
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        device = "unknown"

    return {
        "status": "ok",
        "selected": selected,
        "doclingAvailable": docling_available,
        "fallback": PyMuPDFConverter.name,
        "device": device,
    }
````

## File: assets/deploy/services/learn/app/seedling_client.py
````python
"""Emit seedlings from the Learn hub into the host Obsidian vault.

The Learn service runs in Docker and can't see the host filesystem, so it goes
through the vaultwriter HTTP seam (~/Desktop/code/vaultwriter/server.py) which owns
the vault and the one canonical write contract. This is the wiring point for
synergy #1 (distilled Learn content -> review seedlings): a caller hands a
distilled insight here and it lands in _Review/Seedlings/ for the owner.

Configured by VAULTWRITER_URL (e.g. http://host.docker.internal:8799 or the
host's tailnet name). If unset or unreachable this no-ops cleanly and returns
None, so the study pipeline never breaks on a missing/idle vault seam.
"""
import logging
import os

import httpx

log = logging.getLogger("learn.seedling")

VAULTWRITER_URL = os.environ.get("VAULTWRITER_URL", "").rstrip("/")


def configured() -> bool:
    return bool(VAULTWRITER_URL)


async def emit_seedling(opener, expansion="", source="", links=None,
                        origin="learn-hub", timeout=10.0):
    """POST one seedling to the vault seam. Returns the written path or None."""
    if not VAULTWRITER_URL:
        return None
    opener = (opener or "").strip()
    if not opener:
        return None
    payload = {
        "opener": opener,
        "expansion": expansion or "",
        "source": source or "",
        "links": list(links or []),
        "origin": origin,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{VAULTWRITER_URL}/seedling", json=payload)
            resp.raise_for_status()
            return resp.json().get("path")
    except Exception as exc:  # network / 4xx / 5xx — never break the caller
        log.warning("seedling emit failed (%s): %s", VAULTWRITER_URL, exc)
        return None
````

## File: assets/deploy/services/learn/app/study_routes.py
````python
"""API routes: deck, quiz, Socratic chat."""

from __future__ import annotations

import time
import uuid
from threading import Lock
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.arango_tree import connect_arango, fetch_section_mentions_by_section
from app.arango_learn import (
    fetch_exam_triples_or_error,
    fetch_triples_or_error,
    format_triples_block,
    triple_id,
    triple_line,
)
from app.llm import ollama_chat_completion
from app.mastery import EVENTS_COLLECTION, record_quiz_event
from app.quiz_gen import build_exam, public_question
from app.rate_limit import check_rate_limit

router = APIRouter()

_quiz_lock = Lock()
_quiz_sessions: dict[str, dict[str, Any]] = {}
SESSION_TTL_SECONDS = 3600


def _sweep_sessions(sessions: dict[str, dict[str, Any]], now: float) -> None:
    """Drop sessions older than the TTL. Caller must hold the lock."""
    expired = [
        sid
        for sid, s in sessions.items()
        if now - float(s.get("created") or 0) > SESSION_TTL_SECONDS
    ]
    for sid in expired:
        del sessions[sid]

SOCRATIC_SYSTEM = """You are a Socratic tutor helping the learner think through material represented only by the following knowledge-graph triples (subject | predicate | object).

Rules:
- Use ONLY information supported by these triples. If the answer is not implied, say you cannot tell from the graph and ask what assumption they are making.
- Prefer short, probing questions over long explanations.
- Triples may be incomplete or wrong (automatic extraction); treat them as tentative.
- Do not invent citations or sources outside this list.
"""


class ExamStartBody(BaseModel):
    scope: str | None = None
    doc: str | None = None
    count: int = Field(default=8, ge=1, le=30)
    include_structural: bool = False
    use_llm: bool = Field(default=True, validation_alias=AliasChoices("useLlm", "use_llm"))

    model_config = ConfigDict(populate_by_name=True)


class ExamGradeBody(BaseModel):
    exam_id: str = Field(validation_alias=AliasChoices("examId", "exam_id"))
    answers: list[int]

    model_config = ConfigDict(populate_by_name=True)


class QuizSessionBody(BaseModel):
    scope: str | None = None
    doc: str | None = None
    include_structural: bool = False
    use_llm: bool = Field(default=False, validation_alias=AliasChoices("useLlm", "use_llm"))

    model_config = ConfigDict(populate_by_name=True)


class QuizAnswerBody(BaseModel):
    session_id: str = Field(validation_alias=AliasChoices("sessionId", "session_id"))
    choice_index: int = Field(validation_alias=AliasChoices("choiceIndex", "choice_index"))

    model_config = ConfigDict(populate_by_name=True)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    messages: list[ChatMessage]
    scope: str | None = None
    doc: str | None = None
    include_structural: bool = False


@router.get("/api/deck")
def api_deck(
    scope: str | None = Query(None),
    count: int = Query(20, ge=1, le=100),
    include_structural: bool = Query(False),
    doc: str | None = Query(None),
) -> dict[str, Any]:
    triples, err = fetch_triples_or_error(
        scope, limit=max(count * 3, 60), include_structural=include_structural, doc=doc
    )
    if err:
        return {"error": err, "cards": [], "tripleCount": 0}
    cards: list[dict[str, Any]] = []
    for t in triples[:count]:
        cards.append(
            {
                "id": triple_id(t),
                "front": f"Subject: {t['subject']}\n\nWhat predicate relates this to «{t['object']}»?",
                "back": f"Predicate: {t['predicate']}\n\nFull triple:\n{triple_line(t)}",
                "triple": t,
            }
        )
    return {"cards": cards, "tripleCount": len(triples), "scope": scope}


@router.get("/api/section-stats")
def api_section_stats(
    scope: str = Query(..., min_length=1),
    include_structural: bool = Query(False),
    doc: str | None = Query(None),
) -> dict[str, Any]:
    triples, err = fetch_triples_or_error(
        scope, limit=400, include_structural=include_structural, doc=doc
    )
    if err:
        return {"error": err, "scope": scope, "tripleCount": 0, "entityCount": 0}
    entities: set[str] = set()
    for t in triples:
        entities.add(t["subject"])
        entities.add(t["object"])
    mention_count = 0
    try:
        db = connect_arango()
        mentions = fetch_section_mentions_by_section(db, doc)
        mention_count = len(mentions.get(scope.strip(), []))
    except Exception:
        mention_count = 0
    return {
        "scope": scope,
        "tripleCount": len(triples),
        "entityCount": len(entities),
        "mentionCount": mention_count,
    }


@router.get("/api/mistakes")
def api_mistakes(
    doc: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Most recent incorrectly answered quiz questions, newest first."""
    try:
        db = connect_arango()
        if not db.has_collection(EVENTS_COLLECTION):
            return {"mistakes": []}
        aql = """
        FOR e IN study_events
          FILTER e.correct == false
          FILTER @doc == null OR e.doc == @doc OR e.doc == null
          SORT e.ts DESC
          LIMIT @limit
          RETURN { sectionKey: e.section_key, ts: e.ts, stem: e.stem, expected: e.expected }
        """
        rows = list(db.aql.execute(aql, bind_vars={"doc": doc, "limit": limit}))
        return {"mistakes": rows}
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {"mistakes": [], "error": str(exc)}


@router.post("/api/quiz/exam")
def api_quiz_exam(body: ExamStartBody) -> dict[str, Any]:
    triples, err = fetch_exam_triples_or_error(
        body.scope, limit=400, include_structural=body.include_structural, doc=body.doc
    )
    if err:
        raise HTTPException(status_code=503, detail=err)

    questions = build_exam(triples, count=body.count, use_llm=body.use_llm)
    if not questions:
        raise HTTPException(
            status_code=400,
            detail="Not enough content in this section to build an exam. "
            "Try another section, raise the question count, or enable structural triples.",
        )

    exam_id = str(uuid.uuid4())
    now = time.time()
    with _quiz_lock:
        _sweep_sessions(_quiz_sessions, now)
        _quiz_sessions[exam_id] = {"questions": questions, "created": now}

    return {
        "examId": exam_id,
        "scope": body.scope,
        "count": len(questions),
        "questions": [public_question(q) for q in questions],
    }


@router.post("/api/quiz/grade")
def api_quiz_grade(body: ExamGradeBody) -> dict[str, Any]:
    with _quiz_lock:
        exam = _quiz_sessions.pop(body.exam_id, None)
    if not exam:
        raise HTTPException(status_code=404, detail="Unknown or expired exam")

    questions: list[dict[str, Any]] = exam["questions"]
    review: list[dict[str, Any]] = []
    score = 0
    for i, q in enumerate(questions):
        given = body.answers[i] if i < len(body.answers) else -1
        ok = given == q["answer_index"]
        if ok:
            score += 1
        your_answer = q["choices"][given] if 0 <= given < len(q["choices"]) else None
        review.append(
            {
                "id": q["id"],
                "stem": q["stem"],
                "correct": ok,
                "yourAnswer": your_answer,
                "expected": q["expected"],
                "explanation": q["explanation"],
                "triple": q["triple"],
            }
        )

    total = len(questions)
    percentage = round(100 * score / total) if total else 0
    return {"score": score, "total": total, "percentage": percentage, "review": review}


@router.post("/api/quiz/session")
def api_quiz_session(body: QuizSessionBody) -> dict[str, Any]:
    """One-question quiz: build a single MCQ and stash it for grading.

    Deterministic by default so every question maps to a stored triple — that
    triple is the unit recorded for mastery coverage on answer.
    """
    triples, err = fetch_exam_triples_or_error(
        body.scope, limit=400, include_structural=body.include_structural, doc=body.doc
    )
    if err:
        raise HTTPException(status_code=503, detail=err)

    questions = build_exam(triples, count=1, use_llm=body.use_llm)
    if not questions:
        raise HTTPException(
            status_code=400,
            detail="Not enough content in this section to build a question. "
            "Try another section or enable structural triples.",
        )

    question = questions[0]
    session_id = str(uuid.uuid4())
    now = time.time()
    with _quiz_lock:
        _sweep_sessions(_quiz_sessions, now)
        _quiz_sessions[session_id] = {
            "question": question,
            "scope": body.scope,
            "doc": body.doc,
            "created": now,
        }

    triple = question.get("triple") or {}
    return {
        "sessionId": session_id,
        "question": question["stem"],
        "choices": question["choices"],
        "subject": triple.get("subject", ""),
        "predicate": triple.get("predicate", ""),
    }


@router.post("/api/quiz/answer")
def api_quiz_answer(body: QuizAnswerBody) -> dict[str, Any]:
    with _quiz_lock:
        session = _quiz_sessions.pop(body.session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Unknown or expired quiz session")

    question = session["question"]
    scope = session.get("scope")
    correct = body.choice_index == question["answer_index"]
    triple = question.get("triple")
    record_quiz_event(
        scope,
        triple_id(triple) if triple else None,
        correct,
        doc=session.get("doc"),
        stem=question.get("stem"),
        expected=question.get("expected"),
    )

    return {
        "correct": correct,
        "expected": question["expected"],
        "explanation": question["explanation"],
        "triple": triple,
    }


@router.post("/api/chat")
def api_chat(request: Request, body: ChatBody) -> dict[str, Any]:
    client = request.client.host if request.client else "unknown"
    if not check_rate_limit(client):
        raise HTTPException(status_code=429, detail="Too many requests; try again in a minute.")

    if not body.messages:
        raise HTTPException(status_code=400, detail="messages is required")
    last_user = None
    for m in reversed(body.messages):
        if m.role == "user":
            last_user = m.content
            break
    if not last_user:
        raise HTTPException(status_code=400, detail="At least one user message is required")

    triples, err = fetch_triples_or_error(
        body.scope, limit=120, include_structural=body.include_structural, doc=body.doc
    )
    if err:
        raise HTTPException(status_code=503, detail=err)
    block = format_triples_block(triples, max_lines=120)
    system = SOCRATIC_SYSTEM + "\n\nTriples:\n" + block

    ollama_messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for m in body.messages:
        if m.role in ("user", "assistant") and m.content.strip():
            ollama_messages.append({"role": m.role, "content": m.content.strip()})

    reply, oerr = ollama_chat_completion(ollama_messages)
    if oerr or reply is None:
        raise HTTPException(status_code=503, detail=oerr or "Empty reply")

    return {
        "reply": reply,
        "contextTripleCount": len(triples),
        "scope": body.scope,
    }
````
