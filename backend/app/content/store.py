"""Content store — persist a converted document and serve its sections/pages.

The write side (``persist_document``) composes the pure content pieces (the
sections/pages/outline/elements modules); the read side answers the reader's
queries: a section's markdown span, a single page, the stored outline.

Page provenance: pages are a first-class unit. From the converter we also receive
per-heading page numbers (``heading_pages``) and per-page markdown (``pages``); we join
them into a page-primary ``page_content`` collection where each page carries its section
coordinate trail (``sectionPath``), and we cross-link each ``section_content`` block with
its ``[pageStart, pageEnd]``. All page fields are nullable — documents converted before
this change (no heading/page side channels) keep working with page data absent.
"""

from __future__ import annotations

from psycopg.types.json import Json

from app.content.documents import fetch_latest_document
from app.content.elements import (
    ELEMENTS,
    _element_rows,
    _figures_by_section,
    _save_element_figures,
    _swap_image_placeholders,
    figure_markdown,
)
from app.content.outline import (
    assign_blocks_to_outline,
    build_outline_from_bookmarks,
    normalize_outline,
)
from app.content.pages import build_page_blocks, section_page_ranges
from app.content.scope import _blocks_in_scope, _scope_keys_from_outline, _section_level_fn
from app.content.sections import split_markdown_sections
from app.platform.db import db

DOCUMENTS = "documents"
SECTION_CONTENT = "section_content"
PAGE_CONTENT = "page_content"


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
    source_hash: str | None = None,
) -> str:
    """Store full markdown + section blocks + page-primary blocks.

    Raises on failure — a document that didn't persist must fail the convert job loudly
    (the ledger records the error) rather than report "done" with nothing in the database.

    ``heading_pages`` = ordered ``(heading_text, 1-based page)`` and ``pages`` =
    ``(1-based page, markdown)`` come from ``reader.convert_document``; when absent the
    document is stored without page provenance (backward compatible).
    """
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
    bmap = (
        assign_blocks_to_outline(
            canonical, [(b.order, b.heading, b.page_start) for b in blocks]
        )
        if canonical
        else {}
    )
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

    element_rows = _element_rows(doc_id, elements, blocks)
    with db() as conn, conn.transaction():
        conn.execute(
            """
            INSERT INTO documents (key, title, source_filename, markdown, page_count, char_count,
                section_count, page_block_count, element_count, has_page_provenance, outline,
                source_hash, created_at)
            VALUES (%(key)s,%(title)s,%(sf)s,%(md)s,%(pc)s,%(cc)s,%(sec)s,%(pbc)s,%(ec)s,%(hpp)s,
                %(outline)s,%(sh)s, now())
            ON CONFLICT (key) DO UPDATE SET
                title=EXCLUDED.title, source_filename=EXCLUDED.source_filename, markdown=EXCLUDED.markdown,
                page_count=EXCLUDED.page_count, char_count=EXCLUDED.char_count, section_count=EXCLUDED.section_count,
                page_block_count=EXCLUDED.page_block_count, element_count=EXCLUDED.element_count,
                has_page_provenance=EXCLUDED.has_page_provenance, outline=EXCLUDED.outline,
                source_hash=EXCLUDED.source_hash, created_at=EXCLUDED.created_at
            """,
            {"key": doc_id, "title": title, "sf": source_filename, "md": markdown, "pc": page_count,
             "cc": len(markdown), "sec": len(blocks), "pbc": len(page_blocks), "ec": len(elements),
             "hpp": has_page_provenance, "outline": Json(outline_entries), "sh": source_hash},
        )

        conn.execute("DELETE FROM section_content WHERE doc_id = %(d)s", {"d": doc_id})
        if blocks:
            conn.cursor().executemany(
                'INSERT INTO section_content (key, doc_id, section_key, heading, level, number_key, '
                '"order", markdown, page_start, page_end) VALUES (%(key)s,%(doc_id)s,%(section_key)s,'
                '%(heading)s,%(level)s,%(number_key)s,%(order)s,%(markdown)s,%(page_start)s,%(page_end)s)',
                [{"key": f"{doc_id}__{b.order}", "doc_id": doc_id, "section_key": b.section_key,
                  "heading": b.heading, "level": b.level, "number_key": b.number_key, "order": b.order,
                  "markdown": b.markdown, "page_start": b.page_start, "page_end": b.page_end} for b in blocks],
            )

        conn.execute("DELETE FROM page_content WHERE doc_id = %(d)s", {"d": doc_id})
        if page_blocks:
            conn.cursor().executemany(
                "INSERT INTO page_content (key, doc_id, page_no, markdown, char_count, section_path, "
                "section_keys, headings) VALUES (%(key)s,%(doc_id)s,%(page_no)s,%(markdown)s,"
                "%(char_count)s,%(section_path)s,%(section_keys)s,%(headings)s)",
                [{"key": f"{doc_id}__p{pb.page_no}", "doc_id": doc_id, "page_no": pb.page_no,
                  "markdown": pb.markdown, "char_count": len(pb.markdown),
                  "section_path": Json(pb.section_path), "section_keys": Json(pb.section_keys),
                  "headings": Json(pb.headings)} for pb in page_blocks],
            )

        conn.execute("DELETE FROM elements WHERE doc_id = %(d)s", {"d": doc_id})
        if element_rows:
            conn.cursor().executemany(
                'INSERT INTO elements (key, doc_id, "order", type, page, bbox, bbox_origin, section_key, '
                'caption, image_ref, latex, table_markdown, table_data, code, language, embedding) '
                "VALUES (%(key)s,%(doc_id)s,%(order)s,%(type)s,%(page)s,%(bbox)s,%(bbox_origin)s,"
                "%(section_key)s,%(caption)s,%(image_ref)s,%(latex)s,%(table_markdown)s,%(table_data)s,"
                "%(code)s,%(language)s,%(embedding)s)",
                [{"key": e["_key"], "doc_id": doc_id, "order": e.get("order"), "type": e.get("type"),
                  "page": e.get("page"),
                  "bbox": Json(e["bbox"]) if e.get("bbox") is not None else None,
                  "bbox_origin": e.get("bboxOrigin"), "section_key": e.get("sectionKey"),
                  "caption": e.get("caption"), "image_ref": e.get("imageRef"), "latex": e.get("latex"),
                  "table_markdown": e.get("tableMarkdown"),
                  "table_data": Json(e["tableData"]) if e.get("tableData") is not None else None,
                  "code": e.get("code"), "language": e.get("language"), "embedding": None} for e in element_rows],
            )
    return doc_id


def fetch_outline(doc_id: str | None = None) -> dict:
    """Just the document's stored outline (embedded PDF bookmarks → TOC entries) — WITHOUT the
    full markdown. Lets the chapter reader list chapters cheaply (it then loads one chapter)."""
    try:
        with db() as conn:
            if doc_id:
                row = conn.execute(
                    "SELECT outline FROM documents WHERE key = %(k)s", {"k": doc_id}
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT outline FROM documents ORDER BY created_at DESC NULLS LAST LIMIT 1"
                ).fetchone()
        return {"docId": doc_id, "outline": (row["outline"] if row and row["outline"] else [])}
    except Exception as exc:  # noqa: BLE001
        return {"docId": doc_id, "outline": [], "error": str(exc)}


def fetch_section_content(section_key: str, doc_id: str | None = None, include_figures: bool = False) -> dict:
    """Markdown for a section, including its descendant sub-sections, ordered.

    Mirrors ``isAncestorSectionKey`` so requesting ``toc:1`` returns 1 plus 1.x. The
    response resolves the section's page coordinates (``pageStart``/``pageEnd``) as the
    min/max across the matched blocks — the "section 3 → pages X–Y" drill-down answer.

    ``include_figures`` weaves each section's captioned figures (image + caption) into the
    assembled markdown at the end of that section's block — the PDF's own visuals back in
    the reading flow.
    """
    try:
        if doc_id is None:
            latest = fetch_latest_document()
            doc = latest.get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"sectionKey": section_key, "blocks": [], "markdown": ""}

        with db() as conn:
            rows = conn.execute(
                'SELECT key AS "_key", section_key AS "sectionKey", heading, level, "order", '
                'markdown, page_start AS "pageStart", page_end AS "pageEnd" '
                'FROM section_content WHERE doc_id = %(docId)s ORDER BY "order"',
                {"docId": doc_id},
            ).fetchall()
        # Outline-first spanning — the SAME rule extraction uses (_load_section_blocks):
        # a numbered chapter's sub-sections are usually slug-keyed, which the numeric
        # ancestor walk can't see, so chapters whose heading block isn't keyed toc:N
        # would read as EMPTY (DDIA ch.3+, AI-Eng ch.2-9). Reading-order span remains
        # the fallback. Local import avoids an arango_content <-> extract module cycle.
        okeys = _scope_keys_from_outline(doc_id, section_key)
        matched = [r for r in rows if r.get("sectionKey") in okeys] if okeys else []
        if not matched:
            matched = _blocks_in_scope(rows, section_key, _section_level_fn(doc_id))
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
        figures_by_sk: dict[str, list[dict]] = (
            _figures_by_section(doc_id, {r.get("sectionKey") for r in matched if r.get("sectionKey")})
            if include_figures
            else {}
        )
        parts: list[str] = []
        for r in matched:
            part = r.get("markdown", "")
            if not part:
                continue
            # pop() so a repeated sectionKey can't duplicate its figures
            figs = figures_by_sk.pop(r.get("sectionKey"), [])
            if figs:
                part += "\n\n" + "\n\n".join(figure_markdown(doc_id, f) for f in figs)
            parts.append(part)
        markdown = "\n\n".join(parts)
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
        if doc_id is None:
            latest = fetch_latest_document()
            doc = latest.get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"page": None}
        with db() as conn:
            p = conn.execute(
                'SELECT page_no AS "pageNo", markdown, section_path AS "sectionPath", '
                'section_keys AS "sectionKeys", headings FROM page_content '
                "WHERE doc_id = %(d)s AND page_no = %(n)s LIMIT 1",
                {"d": doc_id, "n": int(page_no)},
            ).fetchone()
        if not p:
            return {"page": None}
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
