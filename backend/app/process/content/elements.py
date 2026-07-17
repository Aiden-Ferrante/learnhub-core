"""Typed elements (the retrieval layer): figures / tables / equations / code.

Write side: save figure images to the shared volume and weave real links into the
markdown before splitting. Read side: per-section figure lookup, element listing,
and figure file resolution for the reader.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

from app.process.content.documents import fetch_latest_document
from app.process.content.scope import is_ancestor_section_key
from app.process.content.sections import SectionBlock
from app.gateways import db

ELEMENTS = "elements"

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
        })
    return rows


def figure_markdown(doc_id: str, fig: dict) -> str:
    """One figure as markdown: the image (served through the frontend's binary proxy at
    /api/learn/figure) followed by its caption as an italic line. Alt text keeps the caption
    but swaps brackets so it can never break the image syntax."""
    cap = (fig.get("caption") or "").strip()
    alt = cap.replace("[", "(").replace("]", ")") or f"Figure (page {fig.get('page')})"
    lines = [f"![{alt}](/api/learn/figure?doc={doc_id}&n={fig.get('order')})"]
    if cap:
        lines.append(f"*{cap}*")
    return "\n".join(lines)


def _figures_by_section(doc_id: str, section_keys: set[str]) -> dict[str, list[dict]]:
    """CAPTIONED figures per section, in reading order. Uncaptioned pictures (covers, logos,
    decorations) are deliberately left out — precision over recall in the reading flow."""
    out: dict[str, list[dict]] = {}
    if not section_keys:
        return out
    with db() as conn:
        rows = conn.execute(
            'SELECT section_key AS "sectionKey", "order", page, caption FROM elements '
            "WHERE doc_id = %(d)s AND type = 'figure' AND section_key = ANY(%(ks)s) "
            "AND caption IS NOT NULL AND caption <> '' ORDER BY \"order\"",
            {"d": doc_id, "ks": list(section_keys)},
        ).fetchall()
    for r in rows:
        out.setdefault(r["sectionKey"], []).append(r)
    return out


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
        if doc_id is None:
            latest = fetch_latest_document()
            doc = latest.get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"docId": doc_id, "elements": []}

        sql = (
            'SELECT "order", type, page, bbox, bbox_origin AS "bboxOrigin", '
            'section_key AS "sectionKey", caption, image_ref AS "imageRef", latex, '
            'table_markdown AS "tableMarkdown", table_data AS "tableData", code, language '
            "FROM elements WHERE doc_id = %(d)s"
        )
        binds: dict = {"d": doc_id}
        if el_type:
            sql += " AND type = %(t)s"
            binds["t"] = el_type
        sql += ' ORDER BY "order"'
        with db() as conn:
            rows = conn.execute(sql, binds).fetchall()

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
