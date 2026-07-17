"""Content store — persist a converted document and serve its sections.

The write side (``persist_document``) composes the pure content pieces (the
sections/outline/elements modules) into the three raw_ tables: raw_structure (the TOC
as a tree), raw_content (the markdown blocks), raw_elements (figures/tables). The
document's identity row (raw_documents) is a stub created at upload; persist flips it to
``ready`` and fills the counts. The read side answers a section's markdown span and the
reassembled outline.

Pages are metadata: each structure node and content block carries its ``[pageStart,
pageEnd]`` span (all nullable when the converter gave no page side-channel). There is no
page_content table — the raw PDF is served from disk for a page-level view.
"""

from __future__ import annotations

from psycopg.types.json import Json

from app.process.content.documents import fetch_latest_document, fetch_structure_entries, structure_id
from app.process.content.elements import (
    ELEMENTS,
    _element_rows,
    _figures_by_section,
    _save_element_figures,
    _swap_image_placeholders,
    figure_markdown,
)
from app.process.content.outline import (
    assign_blocks_to_outline,
    build_outline_from_bookmarks,
    normalize_outline,
)
from app.process.content.pages import section_page_ranges
from app.process.content.scope import scope_blocks
from app.process.content.sections import split_markdown_sections
from app.gateways import db

DOCUMENTS = "raw_documents"


def _structure_rows(doc_id: str, outline_entries: list[dict], page_count: int) -> list[dict]:
    """Turn the flat outline entries (each ``{sectionKey, numberKey, title, listDepth, page}``)
    into raw_structure rows: a self-referencing tree (parent_id from the depth stack), a
    per-node page span (start = the entry's page, end = just before the next same-or-shallower
    entry), and kind (depth 0 = chapter, else section)."""
    rows: list[dict] = []
    stack: list[tuple[int, str]] = []  # (depth, id)
    for i, e in enumerate(outline_entries):
        sk = e.get("sectionKey")
        if not sk:
            continue
        depth = int(e.get("listDepth") or 0)
        node_id = structure_id(doc_id, sk)
        while stack and stack[-1][0] >= depth:
            stack.pop()
        parent_id = stack[-1][1] if stack else None
        stack.append((depth, node_id))
        page = e.get("page")
        page_end = None
        if page:
            nxt = next(
                (n.get("page") for n in outline_entries[i + 1 :]
                 if int(n.get("listDepth") or 0) <= depth and n.get("page")),
                None,
            )
            page_end = (int(nxt) - 1) if nxt else (page_count or None)
        rows.append({
            "id": node_id, "doc_id": doc_id, "parent_id": parent_id, "section_key": sk,
            "kind": "chapter" if depth == 0 else "section",
            "number_label": e.get("numberKey"), "title": e.get("title"),
            "depth": depth, "order": i, "page_start": page, "page_end": page_end,
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
    source_hash: str | None = None,
) -> str:
    """Persist a converted document into raw_structure + raw_content + raw_elements, and flip
    its raw_documents stub to ``ready`` with final counts.

    Raises on failure — a document that didn't persist must fail the convert job loudly
    (the ledger records the error) rather than report "done" with nothing in the database.

    ``heading_pages`` = ordered ``(heading_text, 1-based page)`` and ``pages`` =
    ``(1-based page, markdown)`` come from ``reader.convert_document``; when absent the
    document is stored without page provenance (backward compatible).
    """
    # Typed elements (retrieval layer): save figure images + swap <!-- image --> placeholders
    # BEFORE splitting, so every content block inherits the real links.
    elements = elements or []
    figure_links = _save_element_figures(doc_id, elements)
    if figure_links:
        markdown = _swap_image_placeholders(markdown, figure_links)

    blocks = split_markdown_sections(markdown)

    hp = [(t, int(p)) for (t, p) in (heading_pages or [])]

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

    has_page_provenance = any(b.page_start is not None for b in blocks)
    struct_rows = _structure_rows(doc_id, outline_entries, page_count)
    struct_keys = {r["section_key"] for r in struct_rows}

    def sid(sk: str | None) -> str | None:
        # structure_id only when the key is a real node — the FK is nullable for the
        # finer-grained content/element blocks that fall under no bookmarked section.
        return structure_id(doc_id, sk) if sk in struct_keys else None

    element_rows = _element_rows(doc_id, elements, blocks)
    with db() as conn, conn.transaction():
        # Flip the upload stub to ready with the final counts (INSERT covers a re-convert or
        # any path that skipped prepare_upload). Never touches app/UI-owned columns.
        conn.execute(
            """
            INSERT INTO raw_documents (key, title, source_filename, page_count, char_count,
                section_count, element_count, has_page_provenance, source_hash, status, last_updated)
            VALUES (%(key)s,%(title)s,%(sf)s,%(pc)s,%(cc)s,%(sec)s,%(ec)s,%(hpp)s,%(sh)s,'ready', now())
            ON CONFLICT (key) DO UPDATE SET
                title=EXCLUDED.title, source_filename=EXCLUDED.source_filename,
                page_count=EXCLUDED.page_count, char_count=EXCLUDED.char_count,
                section_count=EXCLUDED.section_count, element_count=EXCLUDED.element_count,
                has_page_provenance=EXCLUDED.has_page_provenance, source_hash=EXCLUDED.source_hash,
                status='ready', last_updated=now()
            """,
            {"key": doc_id, "title": title, "sf": source_filename, "pc": page_count,
             "cc": len(markdown), "sec": len(blocks), "ec": len(elements),
             "hpp": has_page_provenance, "sh": source_hash},
        )

        # Structure first — content/element FKs point at it. Delete children before the tree
        # (raw_content/raw_elements would cascade anyway, but be explicit for a re-convert).
        conn.execute("DELETE FROM raw_content WHERE doc_id = %(d)s", {"d": doc_id})
        conn.execute("DELETE FROM raw_elements WHERE doc_id = %(d)s", {"d": doc_id})
        conn.execute("DELETE FROM raw_structure WHERE doc_id = %(d)s", {"d": doc_id})
        if struct_rows:
            conn.cursor().executemany(
                'INSERT INTO raw_structure (id, doc_id, parent_id, section_key, kind, number_label, '
                'title, depth, "order", page_start, page_end) VALUES (%(id)s,%(doc_id)s,%(parent_id)s,'
                '%(section_key)s,%(kind)s,%(number_label)s,%(title)s,%(depth)s,%(order)s,%(page_start)s,%(page_end)s)',
                struct_rows,
            )

        if blocks:
            conn.cursor().executemany(
                'INSERT INTO raw_content (key, doc_id, structure_id, section_key, heading, level, '
                'number_key, "order", markdown, char_count, page_start, page_end) '
                'VALUES (%(key)s,%(doc_id)s,%(structure_id)s,%(section_key)s,%(heading)s,%(level)s,'
                '%(number_key)s,%(order)s,%(markdown)s,%(char_count)s,%(page_start)s,%(page_end)s)',
                [{"key": f"{doc_id}__{b.order}", "doc_id": doc_id, "structure_id": sid(b.section_key),
                  "section_key": b.section_key, "heading": b.heading, "level": b.level,
                  "number_key": b.number_key, "order": b.order, "markdown": b.markdown,
                  "char_count": len(b.markdown or ""), "page_start": b.page_start,
                  "page_end": b.page_end} for b in blocks],
            )

        if element_rows:
            conn.cursor().executemany(
                'INSERT INTO raw_elements (key, doc_id, structure_id, "order", type, page, bbox, '
                'bbox_origin, section_key, caption, image_ref, latex, table_markdown, table_data, code, language) '
                "VALUES (%(key)s,%(doc_id)s,%(structure_id)s,%(order)s,%(type)s,%(page)s,%(bbox)s,%(bbox_origin)s,"
                "%(section_key)s,%(caption)s,%(image_ref)s,%(latex)s,%(table_markdown)s,%(table_data)s,"
                "%(code)s,%(language)s)",
                [{"key": e["_key"], "doc_id": doc_id, "structure_id": sid(e.get("sectionKey")),
                  "order": e.get("order"), "type": e.get("type"), "page": e.get("page"),
                  "bbox": Json(e["bbox"]) if e.get("bbox") is not None else None,
                  "bbox_origin": e.get("bboxOrigin"), "section_key": e.get("sectionKey"),
                  "caption": e.get("caption"), "image_ref": e.get("imageRef"), "latex": e.get("latex"),
                  "table_markdown": e.get("tableMarkdown"),
                  "table_data": Json(e["tableData"]) if e.get("tableData") is not None else None,
                  "code": e.get("code"), "language": e.get("language")} for e in element_rows],
            )
    return doc_id


def fetch_outline(doc_id: str | None = None) -> dict:
    """The document's TOC entries (reassembled from raw_structure) — WITHOUT any markdown.
    Lets the chapter reader list chapters cheaply (it then loads one chapter)."""
    try:
        from app.process.content.documents import resolve_doc_id
        resolved = resolve_doc_id(doc_id)
        return {"docId": doc_id, "outline": fetch_structure_entries(resolved)}
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
                'FROM raw_content WHERE doc_id = %(docId)s ORDER BY "order"',
                {"docId": doc_id},
            ).fetchall()
        # Outline-first spanning with reading-order fallback — the one shared rule.
        matched = scope_blocks(doc_id, section_key, rows=rows)
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
