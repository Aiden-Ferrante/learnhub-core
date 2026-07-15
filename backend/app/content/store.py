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

import time

from arango.database import StandardDatabase

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
from app.platform.arango import connect_arango

DOCUMENTS = "documents"
SECTION_CONTENT = "section_content"
PAGE_CONTENT = "page_content"


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
                "sourceHash": source_hash,
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
            _figures_by_section(db, doc_id, {r.get("sectionKey") for r in matched if r.get("sectionKey")})
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
