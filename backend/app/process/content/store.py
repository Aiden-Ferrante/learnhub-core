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

import logging

from psycopg.types.json import Json

from app.process.content.blocks import fetch_blocks
from app.process.content.documents import fetch_latest_document, fetch_structure_entries, structure_id
from app.process.content.elements import (
    ELEMENTS,
    _element_rows,
    _figures_by_section,
    _save_element_figures,
    _swap_image_placeholders,
    figure_markdown,
)
from app.process.content.pages import section_page_ranges
from app.process.content.toc_controller import resolve_toc
from app.process.content.scope import scope_blocks
from app.process.content.sections import split_markdown_sections
from app.gateways import db

DOCUMENTS = "raw_documents"


def _structure_rows(
    doc_id: str, outline_entries: list[dict], page_count: int,
    hidden: dict[str, str] | None = None,
) -> list[dict]:
    """Turn the flat outline entries (each ``{sectionKey, numberKey, title, listDepth, page}``)
    into raw_structure rows: a self-referencing tree (parent_id from the depth stack), a
    per-node page span (start = the entry's page, end = just before the next same-or-shallower
    entry), and kind (depth 0 = chapter, else section).

    ⚠ Duplicate sectionKeys are dropped here rather than allowed to reach the INSERT. ``id``
    is the primary key, so a repeat aborts the statement and takes the ENTIRE conversion with
    it — the book lands with 0 blocks and an opaque `duplicate key value violates unique
    constraint "raw_structure_pkey"`, which is where Bishop's PRML sat for two weeks. The
    outline builders uniquify keys and are the real fix; this is the backstop, because losing
    one syllabus node is a bad outcome and losing a 758-page book is a much worse one."""
    rows: list[dict] = []
    stack: list[tuple[int, str]] = []  # (depth, id)
    seen: set[str] = set()
    for i, e in enumerate(outline_entries):
        sk = e.get("sectionKey")
        if not sk:
            continue
        depth = int(e.get("listDepth") or 0)
        node_id = structure_id(doc_id, sk)
        if node_id in seen:
            logging.getLogger(__name__).warning(
                "structure: dropping duplicate sectionKey %r (entry %d, title %r) — an "
                "outline builder emitted a non-unique key", sk, i, e.get("title"),
            )
            continue
        seen.add(node_id)
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
            "hidden_reason": (hidden or {}).get(sk),
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
    pdf_bytes: bytes | None = None,
) -> dict:
    """Persist a converted document into raw_structure + raw_content + raw_elements, and flip
    its raw_documents stub to ``ready`` with final counts. Returns
    ``{docId, tocRoute, tocDecisions}`` so the convert job can put the TOC controller's
    verdict on its ledger row.

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

    # Unified keyspace: one canonical TOC (unique nested keys) shared by the reader and
    # concepts. The TOC controller picks the route (bookmarks / pagematched / derived-* /
    # none) and logs why — its decisions land on the convert job's ledger row. The
    # extras feed the derive strategies (font pass needs the PDF bytes; contents-page
    # parsing needs the per-page text).
    toc = resolve_toc(
        outline, blocks, page_count,
        heading_pages=hp,
        pages=[(int(pn), md) for (pn, md) in (pages or [])],
        pdf_bytes=pdf_bytes,
    )
    outline_entries = toc.outline_entries
    # block_map is an OVERLAY: only re-key blocks the reconcile matched; the rest keep
    # their splitter-assigned keys.
    for b in blocks:
        ck = toc.block_map.get(b.order)
        if ck:
            b.section_key = ck

    has_page_provenance = any(b.page_start is not None for b in blocks)
    struct_rows = _structure_rows(doc_id, outline_entries, page_count, hidden=toc.hidden)
    struct_keys = {r["section_key"] for r in struct_rows}

    def sid(sk: str | None) -> str | None:
        # structure_id only when the key is a real node — the FK is nullable for the
        # finer-grained content/element blocks that fall under no bookmarked section.
        return structure_id(doc_id, sk) if sk in struct_keys else None

    element_rows = _element_rows(doc_id, elements, blocks)
    with db() as conn, conn.transaction():
        # The file-level facts belong to the book. Conversion only ever runs on a freshly
        # uploaded source, so doc_id is the source key here (create_stub minted both).
        conn.execute(
            """
            INSERT INTO sources (key, title, source_filename, page_count, element_count,
                has_page_provenance, source_hash, created_at)
            VALUES (%(key)s,%(title)s,%(sf)s,%(pc)s,%(ec)s,%(hpp)s,%(sh)s, now())
            ON CONFLICT (key) DO UPDATE SET
                title=EXCLUDED.title, source_filename=EXCLUDED.source_filename,
                page_count=EXCLUDED.page_count, element_count=EXCLUDED.element_count,
                has_page_provenance=EXCLUDED.has_page_provenance,
                source_hash=EXCLUDED.source_hash
            """,
            {"key": doc_id, "title": title, "sf": source_filename, "pc": page_count,
             "ec": len(elements), "hpp": has_page_provenance, "sh": source_hash},
        )
        # Flip the upload stub to ready with the final counts (INSERT covers a re-convert or
        # any path that skipped prepare_upload). Never touches app/UI-owned columns, and on
        # conflict never touches the version's own identity (source_id/name/origin/is_main).
        conn.execute(
            """
            INSERT INTO raw_documents (key, source_id, char_count, section_count, toc_route,
                status, last_updated)
            VALUES (%(key)s,%(key)s,%(cc)s,%(sec)s,%(tr)s,'ready', now())
            ON CONFLICT (key) DO UPDATE SET
                char_count=EXCLUDED.char_count, section_count=EXCLUDED.section_count,
                toc_route=EXCLUDED.toc_route, status='ready', last_updated=now()
            """,
            {"key": doc_id, "cc": len(markdown), "sec": len(blocks), "tr": toc.route},
        )

        # Structure first — content/element FKs point at it. Delete children before the tree
        # (raw_content/raw_elements would cascade anyway, but be explicit for a re-convert).
        # Re-convert replaces the BOOK's text; version_blocks rows cascade off it, so
        # every version's mapping is rebuilt from the new blocks (a custom cut does not
        # survive a re-convert — the blocks it pointed at no longer exist).
        conn.execute("DELETE FROM raw_content WHERE doc_id = %(d)s", {"d": doc_id})
        conn.execute("DELETE FROM raw_elements WHERE doc_id = %(d)s", {"d": doc_id})
        conn.execute("DELETE FROM raw_structure WHERE doc_id = %(d)s", {"d": doc_id})
        # Concepts anchored to a node went with the tree above (`ext_concepts.structure_id`
        # cascades). The ones anchored to NOTHING did not, and the schema allows that
        # deliberately — a concept can be finer-grained than the TOC. After a re-convert
        # their `section_key` names a section that may no longer exist, so they would sit in
        # the table unreachable by every scope query while still counting toward coverage
        # denominators (finding B4).
        conn.execute(
            "DELETE FROM ext_concepts WHERE doc_id = %(d)s AND structure_id IS NULL",
            {"d": doc_id},
        )
        if struct_rows:
            conn.cursor().executemany(
                'INSERT INTO raw_structure (id, doc_id, parent_id, section_key, kind, number_label, '
                'title, depth, "order", page_start, page_end, hidden_reason) VALUES (%(id)s,%(doc_id)s,%(parent_id)s,'
                '%(section_key)s,%(kind)s,%(number_label)s,%(title)s,%(depth)s,%(order)s,%(page_start)s,%(page_end)s,%(hidden_reason)s)',
                struct_rows,
            )

        if blocks:
            # The text belongs to the book — no placement column here.
            conn.cursor().executemany(
                'INSERT INTO raw_content (key, doc_id, section_key, heading, level, '
                'number_key, "order", markdown, char_count, page_start, page_end) '
                'VALUES (%(key)s,%(doc_id)s,%(section_key)s,%(heading)s,%(level)s,'
                '%(number_key)s,%(order)s,%(markdown)s,%(char_count)s,%(page_start)s,%(page_end)s)',
                [{"key": f"{doc_id}__{b.order}", "doc_id": doc_id,
                  "section_key": b.section_key, "heading": b.heading, "level": b.level,
                  "number_key": b.number_key, "order": b.order, "markdown": b.markdown,
                  "char_count": len(b.markdown or ""), "page_start": b.page_start,
                  "page_end": b.page_end} for b in blocks],
            )
            # …and the Default version keeps all of it, in the book's own order and
            # sections. This identity mapping is what makes the default reading
            # experience the general version_blocks mechanism applied to the trivial case.
            conn.cursor().executemany(
                'INSERT INTO version_blocks (version_id, content_key, structure_id, "order") '
                "VALUES (%(v)s,%(c)s,%(s)s,%(o)s) "
                'ON CONFLICT (version_id, content_key) DO UPDATE SET '
                'structure_id = EXCLUDED.structure_id, "order" = EXCLUDED."order"',
                [{"v": doc_id, "c": f"{doc_id}__{b.order}", "s": sid(b.section_key),
                  "o": b.order} for b in blocks],
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
    return {"docId": doc_id, "tocRoute": toc.route, "tocDecisions": toc.decisions}


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

        rows = fetch_blocks(doc_id, markdown=True)
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
