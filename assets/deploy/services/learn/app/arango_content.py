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

import os
import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

from arango.database import StandardDatabase

from app.arango_tree import connect_arango

DOCUMENTS = "documents"
SECTION_CONTENT = "section_content"
PAGE_CONTENT = "page_content"
ELEMENTS = "elements"

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
    if not db.has_collection(ELEMENTS):
        col = db.create_collection(ELEMENTS)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["docId", "type"])
        col.add_persistent_index(fields=["docId", "sectionKey"])
        col.add_persistent_index(fields=["docId", "page"])


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


def assign_blocks_to_outline(
    outline: list[dict], blocks: list[tuple[int, str]]
) -> dict[int, str]:
    """Map each content block (``(order, heading)``, document order) to a canonical outline
    section. Order-aware title match: a block whose heading matches the next outline entry's
    title advances the pointer and becomes the "current" section; a finer sub-heading with no
    outline entry of its own (e.g. "Transformer architecture") folds into the current section
    ("Model Architecture"), so its concepts attach to a real TOC node — without stealing that
    section's title the way a coarse page-match did."""
    entries = [(e["sectionKey"], _heading_text_norm(e.get("title", ""))) for e in outline]
    out: dict[int, str] = {}
    ptr = 0
    current: str | None = None
    for order, heading in sorted(blocks, key=lambda b: b[0]):
        h = _heading_text_norm(heading)
        j = ptr
        while j < len(entries) and j - ptr <= 30:
            if entries[j][1] and entries[j][1] == h:
                ptr = j + 1
                current = entries[j][0]
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


# --------------------------------------------------------------------------- #
# Typed elements (the retrieval layer): figures / tables / equations / code
# --------------------------------------------------------------------------- #

_IMAGE_PLACEHOLDER = re.compile(r"<!--\s*image\s*-->")


def _figure_url(doc_id: str, order: int) -> str:
    """Browser-facing URL for a figure (served by the learn `/api/figure` route via the Next
    `/api/learn/*` proxy). Keyed by (doc, element order) so the reader and an agent agree."""
    return f"/api/learn/figure?doc={doc_id}&n={order}"


def _figure_md_link(doc_id: str, order: int, caption: str | None, ref: str | None) -> str | None:
    if not ref:
        return None
    alt = (caption or "Figure").strip().replace("[", " ").replace("]", " ") or "Figure"
    return f"![{alt}]({_figure_url(doc_id, order)})"


def _save_element_figures(doc_id: str, elements: list[dict]) -> list[str | None]:
    """Assign each element its reading `order`, write figure PNGs to ``/shared/figures/<docId>/``,
    set ``imageRef`` on figures, and return the per-figure markdown links in reading order (used
    to swap the ``<!-- image -->`` placeholders). Best-effort: a bad write leaves ``imageRef`` None.
    """
    shared = os.environ.get("SHARED_DIR", "/shared")
    fig_dir = Path(shared) / "figures" / doc_id
    shutil.rmtree(fig_dir, ignore_errors=True)  # drop stale figures on re-ingest
    links: list[str | None] = []
    for order, e in enumerate(elements):
        e["order"] = order
        if e.get("type") != "figure":
            continue
        ref = None
        png = e.get("imagePng")
        if png:
            try:
                fig_dir.mkdir(parents=True, exist_ok=True)
                (fig_dir / f"e{order}.png").write_bytes(png)
                ref = f"figures/{doc_id}/e{order}.png"
            except OSError:
                ref = None
        e["imageRef"] = ref
        links.append(_figure_md_link(doc_id, order, e.get("caption"), ref))
    return links


def _swap_image_placeholders(markdown: str, figure_links: list[str | None]) -> str:
    """Replace each ``<!-- image -->`` (Docling emits one per figure, in reading order) with the
    matching figure's markdown link, so the reader shows real images. Unmatched/None → left as-is."""
    it = iter(figure_links)
    def repl(_m: re.Match) -> str:
        link = next(it, None)
        return link if link else _m.group(0)
    return _IMAGE_PLACEHOLDER.sub(repl, markdown)


def _element_rows(doc_id: str, elements: list[dict], blocks: list[SectionBlock]) -> list[dict]:
    """Build the ``elements`` rows, each tagged with the section that contains its page (the most
    recent heading at/before that page — same rule as the outline page-match)."""
    paged = sorted([b for b in blocks if b.page_start is not None], key=lambda b: b.page_start)

    def section_for_page(page: int | None) -> str | None:
        if page is None:
            return None
        chosen = None
        for b in paged:
            if b.page_start is not None and b.page_start <= page:
                chosen = b
            else:
                break
        return chosen.section_key if chosen else None

    rows: list[dict] = []
    for e in elements:
        order = e.get("order", 0)
        rows.append({
            "_key": f"{doc_id}__e{order}",
            "docId": doc_id,
            "order": order,
            "type": e.get("type"),
            "page": e.get("page"),
            "bbox": e.get("bbox"),
            "bboxOrigin": e.get("bboxOrigin"),
            "sectionKey": section_for_page(e.get("page")),
            "caption": e.get("caption"),
            "imageRef": e.get("imageRef"),
            "latex": e.get("latex"),
            "tableMarkdown": e.get("tableMarkdown"),
            "tableData": e.get("tableData"),
            "code": e.get("code"),
            "language": e.get("language"),
            "embedding": None,  # reserved for Phase-2 semantic search
        })
    return rows


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
    elements: list[dict] | None = None,
) -> str | None:
    """Store full markdown + section blocks + page-primary blocks. Best-effort.

    ``heading_pages`` = ordered ``(heading_text, 1-based page)`` and ``pages`` =
    ``(1-based page, markdown)`` come from ``reader.convert_document``; when absent the
    document is stored without page provenance (backward compatible).
    """
    try:
        db = connect_arango()
        _ensure_collections(db)

        # Typed elements (retrieval layer): save figure images + swap <!-- image --> placeholders
        # BEFORE splitting, so documents.markdown AND every section block inherit the real links.
        # sectionKey is assigned after the page-ranges/keys are final (below).
        elements = elements or []
        figure_links = _save_element_figures(doc_id, elements)
        if figure_links:
            markdown = _swap_image_placeholders(markdown, figure_links)

        blocks = split_markdown_sections(markdown)

        hp = [(t, int(p)) for (t, p) in (heading_pages or [])]
        page_list = [(int(pn), md) for (pn, md) in (pages or [])]

        if hp:
            ranges = section_page_ranges(blocks, hp, page_count)
            for b in blocks:
                b.page_start, b.page_end = ranges.get(b.order, (None, None))

        # Unified keyspace: one canonical TOC (unique nested keys from the bookmarks) shared by
        # the reader and concepts. Re-key each content block onto the canonical section that
        # contains its page, so the syllabus tree, reader, and numbering line up by construction.
        # Falls back to the legacy page-matched outline when there's no page data to align on.
        canonical = build_outline_from_bookmarks(outline)
        bmap = assign_blocks_to_outline(canonical, [(b.order, b.heading) for b in blocks]) if canonical else {}
        if bmap:
            outline_entries = canonical
            for b in blocks:
                ck = bmap.get(b.order)
                if ck:
                    b.section_key = ck
        else:
            outline_entries = normalize_outline(outline, blocks)

        page_blocks = build_page_blocks(page_list, blocks, hp, page_count) if page_list else []
        has_page_provenance = bool(page_blocks) and any(b.page_start is not None for b in blocks)

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
                "elementCount": len(elements),
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

        el = db.collection(ELEMENTS)
        el.delete_match({"docId": doc_id})
        element_rows = _element_rows(doc_id, elements, blocks)
        if element_rows:
            el.import_bulk(element_rows, on_duplicate="replace")
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


def fetch_outline(doc_id: str | None = None) -> dict:
    """Just the document's stored outline (embedded PDF bookmarks → TOC entries) — WITHOUT the
    full markdown. Lets the chapter reader list chapters cheaply (it then loads one chapter)."""
    try:
        db = connect_arango()
        if not db.has_collection(DOCUMENTS):
            return {"docId": doc_id, "outline": []}
        if doc_id:
            rows = list(
                db.aql.execute("FOR d IN documents FILTER d._key == @k RETURN d.outline", bind_vars={"k": doc_id})
            )
        else:
            rows = list(db.aql.execute("FOR d IN documents SORT d.createdAt DESC LIMIT 1 RETURN d.outline"))
        return {"docId": doc_id, "outline": (rows[0] if rows and rows[0] else [])}
    except Exception as exc:  # noqa: BLE001
        return {"docId": doc_id, "outline": [], "error": str(exc)}


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
        # Outline-first spanning — the SAME rule extraction uses (_load_section_blocks):
        # a numbered chapter's sub-sections are usually slug-keyed, which the numeric
        # ancestor walk can't see, so chapters whose heading block isn't keyed toc:N
        # would read as EMPTY (DDIA ch.3+, AI-Eng ch.2-9). Reading-order span remains
        # the fallback. Local import avoids an arango_content <-> extract module cycle.
        from app.extract import _blocks_in_scope, _scope_keys_from_outline, _section_level_fn

        okeys = _scope_keys_from_outline(db, doc_id, section_key)
        matched = [r for r in rows if r.get("sectionKey") in okeys] if okeys else []
        if not matched:
            matched = _blocks_in_scope(rows, section_key, _section_level_fn(db, doc_id))
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


_ELEMENT_FIELDS = (
    "order", "type", "page", "bbox", "bboxOrigin", "sectionKey",
    "caption", "imageRef", "latex", "tableMarkdown", "tableData", "code", "language",
)


def fetch_elements(
    doc_id: str | None = None, scope: str | None = None, el_type: str | None = None
) -> dict:
    """The typed retrieval layer: list a document's elements, optionally filtered by ``el_type``
    (figure/table/equation/code) and ``scope`` (a ``toc:`` key — returns that section + descendants).
    Image bytes are never returned — figures carry an ``imageRef`` the ``/api/figure`` route serves."""
    try:
        db = connect_arango()
        if not db.has_collection(ELEMENTS):
            return {"docId": doc_id, "elements": []}
        if doc_id is None:
            latest = fetch_latest_document()
            doc = latest.get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"docId": doc_id, "elements": []}

        aql = "FOR e IN elements FILTER e.docId == @d"
        binds: dict = {"d": doc_id}
        if el_type:
            aql += " AND e.type == @t"
            binds["t"] = el_type
        aql += " SORT e.order RETURN e"
        rows = list(db.aql.execute(aql, bind_vars=binds))

        if scope:
            rows = [r for r in rows if r.get("sectionKey") and is_ancestor_section_key(scope, r["sectionKey"])]

        out = [{k: r.get(k) for k in _ELEMENT_FIELDS} for r in rows]
        return {"docId": doc_id, "scope": scope, "type": el_type, "count": len(out), "elements": out}
    except Exception as exc:
        return {"docId": doc_id, "elements": [], "error": str(exc)}


def figure_path(doc_id: str, order: int) -> Path | None:
    """Absolute path to a figure PNG for the ``/api/figure`` route, or None if it's missing.
    Guards against path traversal (``doc_id`` is a UUID, ``order`` an int)."""
    shared = os.environ.get("SHARED_DIR", "/shared")
    safe_doc = re.sub(r"[^A-Za-z0-9_-]", "", doc_id or "")
    p = Path(shared) / "figures" / safe_doc / f"e{int(order)}.png"
    return p if p.is_file() else None
