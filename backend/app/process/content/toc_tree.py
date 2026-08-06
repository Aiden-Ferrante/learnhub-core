"""The syllabus tree: a document's stored TOC outline built into a nested forest,
annotated with human titles and per-section concepts."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.process.content.documents import resolve_doc_id
from app.gateways import db
from app.process.content.blocks import concept_filter, fetch_blocks, version_sections_by_source


@dataclass
class TreeNode:
    """JSON-serializable tree node."""

    id: str
    label: str
    title: str | None = None
    children: list[TreeNode] = field(default_factory=list)
    concept_count: int = 0  # rollup: concepts in this section + all descendants
    # This section's OWN concepts (not rolled up): [{key, name, kind}] in extraction order,
    # so the syllabus can show them as clickable leaves under their section.
    concepts: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        is_section = (self.id or "").startswith("toc:")
        return {
            "id": self.id,
            "label": self.label,
            "title": self.title if is_section else None,
            "sectionKey": self.id if is_section else None,
            "isSection": is_section,
            "conceptCount": self.concept_count if is_section else 0,
            "concepts": self.concepts if is_section else [],
            "children": [c.as_dict() for c in self.children],
        }


TOC_NUMERIC = re.compile(r"^toc:(\d+(?:\.\d+)*)$")


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


def fetch_section_titles(doc_id: str | None = None) -> dict[str, str]:
    """sectionKey -> human heading, scoped to one document's section_content.

    Scoping to a single document stops titles from bleeding across books that share
    ``toc:N.N`` keys (the previous all-docs query picked an arbitrary book's heading).
    ``doc_id`` is a section_content docId; when omitted the most recently ingested
    document is used. Numbered nodes get their own heading; chapter nodes (``toc:N``),
    which the markdown keys by slug, are backfilled via ``_chapter_titles``.
    """
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {}

    rows = fetch_blocks(doc_id, where="AND c.heading IS NOT NULL AND c.heading <> ''")
    blocks = [
        {
            "key": row.get("sectionKey"),
            "heading": (row.get("heading") or "").strip(),
            "order": row.get("order") or 0,
        }
        for row in rows
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

    # PDF bookmark titles win over extracted headings: the text layer drops ligature
    # glyphs ("Complexity dened") and carries "Chapter N" prefixes, while the bookmark
    # outline stores the clean human title per canonical sectionKey.
    for entry in fetch_outline_titles(doc_id).items():
        out[entry[0]] = entry[1]
    return out


def fetch_outline_titles(doc_id: str) -> dict[str, str]:
    """sectionKey -> clean bookmark title from the structure tree (empty when absent)."""
    from app.process.content.documents import fetch_structure_entries

    outline = fetch_structure_entries(doc_id)
    out: dict[str, str] = {}
    for e in outline:
        key = (e.get("sectionKey") or "").strip()
        title = (e.get("title") or "").strip()
        if key and title:
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


def _count_nodes(nodes: list[TreeNode]) -> int:
    return sum(1 + _count_nodes(n.children) for n in nodes)


def _concept_counts_by_section(doc_id: str) -> dict[str, int]:
    """Concepts per section of THIS version's tree. Concepts belong to the book, so the
    counts are fetched by book section and re-keyed onto whichever of the version's
    sections drew material from them."""
    try:
        by_source = version_sections_by_source(doc_id)
        pred, binds = concept_filter(doc_id)
        with db() as conn:
            rows = conn.execute(
                "SELECT section_key AS sk, count(*) AS n FROM ext_concepts "
                f"WHERE {pred} GROUP BY section_key",
                binds,
            ).fetchall()
        out: dict[str, int] = {}
        for r in rows:
            if not r.get("sk"):
                continue
            for vk in by_source.get(r["sk"], [r["sk"]]):
                out[vk] = out.get(vk, 0) + r["n"]
        return out
    except Exception:
        return {}


def _annotate_concept_counts(nodes: list[TreeNode], counts: dict[str, int]) -> int:
    """Set each node's ``concept_count`` to its rollup (own + descendants). Returns subtree total."""
    total = 0
    for n in nodes:
        sub = _annotate_concept_counts(n.children, counts)
        n.concept_count = counts.get(n.id, 0) + sub
        total += n.concept_count
    return total


def _concepts_by_section(doc_id: str) -> dict[str, list[dict[str, Any]]]:
    """sectionKey -> [{key, name, kind}] in extraction order — the syllabus's concept leaves."""
    try:
        with db() as conn:
            pred, binds = concept_filter(doc_id)
            rows = conn.execute(
                "SELECT section_key AS sk, key, name, kind FROM ext_concepts "
                f'WHERE {pred} ORDER BY section_key, "order"',
                binds,
            ).fetchall()
        by_source = version_sections_by_source(doc_id)
        out: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            sk = r.get("sk")
            if sk and r.get("name"):
                for vk in by_source.get(sk, [sk]):
                    out.setdefault(vk, []).append(
                        {"key": r.get("key"), "name": r["name"], "kind": r.get("kind")}
                    )
        return out
    except Exception:
        return {}


def _attach_concepts(nodes: list[TreeNode], by_section: dict[str, list[dict[str, Any]]]) -> None:
    """Attach each section's OWN concepts (pre-order, in place)."""
    for n in nodes:
        n.concepts = by_section.get(n.id, [])
        _attach_concepts(n.children, by_section)


def _filter_to_concept_sections(nodes: list[TreeNode]) -> list[TreeNode]:
    """Keep only sections whose subtree contains concepts (rollup > 0); prune the rest. Ancestors
    of a concept-bearing section are kept so the chapter structure stays intact."""
    kept: list[TreeNode] = []
    for n in nodes:
        if n.concept_count > 0:
            n.children = _filter_to_concept_sections(n.children)
            kept.append(n)
    return kept


def _drop_hidden_entries(outline: list[dict]) -> list[dict]:
    """Filter out entries the convert-time curate stage hid (front/back matter, orphan
    Parts) — the ONLY syllabus filtering; the heuristics themselves live in
    toc_controller.curate_outline, run once at persist, and are logged on the convert
    job's ledger row. Entries without the flag (legacy rows) pass through."""
    return [e for e in outline if not e.get("hiddenReason")]


def build_tree_from_outline(outline: list[dict[str, Any]]) -> list[TreeNode]:
    """Build the syllabus forest from a document's stored TOC outline — the SAME skeleton the
    Process-tab TOC preview shows. Each entry is ``{numberKey, title, sectionKey, listDepth}``;
    ``listDepth`` (0-based) gives the nesting. The outline exists for every converted PDF,
    including slug-keyed books with no numbered hierarchy."""
    roots: list[TreeNode] = []
    stack: list[tuple[int, TreeNode]] = []
    seen: set[str] = set()
    for e in outline or []:
        sk = e.get("sectionKey")
        if not sk or not str(sk).startswith("toc:") or sk in seen:
            continue
        seen.add(sk)
        depth = max(0, int(e.get("listDepth", 0) or 0))
        title = (e.get("title") or "").strip()
        number = (e.get("numberKey") or "").strip()
        node = TreeNode(id=sk, label=number or title or sk, title=title or None)
        while stack and stack[-1][0] >= depth:
            stack.pop()
        (stack[-1][1].children if stack else roots).append(node)
        stack.append((depth, node))
    return roots


def get_toc_tree(doc: str | None = None) -> tuple[list[dict[str, Any]], int, str | None]:
    """
    Returns (forest_as_dicts, section_count, error_message).
    The syllabus skeleton is the document's stored TOC outline (the TOC-preview structure),
    which is present for every converted PDF — including slug-keyed books with no numbered
    hierarchy. When ``doc`` is given it selects that document (by id); unmatched ids fall
    back to latest.
    """
    try:
        from app.process.content.documents import fetch_latest_document

        doc_obj = fetch_latest_document(doc).get("document")
        if doc_obj is None:
            doc_obj = fetch_latest_document().get("document")  # id mismatch -> latest
        outline = (doc_obj or {}).get("outline") or []
        # Scope EVERY helper to the resolved document. Section keys (toc:1, toc:summary, …) are
        # unique within a book but COLLIDE across books, so an unscoped query bleeds another
        # book's titles/counts onto this one (e.g. AI-Eng showing DDIA's chapters).
        doc_key = (doc_obj or {}).get("id")
        titles_by_key = fetch_section_titles(doc_key)
    except Exception as e:  # noqa: BLE001 — tree is best-effort; surface the error to the API
        return [], 0, str(e)

    forest_nodes = build_tree_from_outline(_drop_hidden_entries(outline))
    apply_section_titles(forest_nodes, titles_by_key)

    # Tie concepts to the tree. If the doc has NO concepts yet (e.g. just converted, not
    # processed), keep the full TOC skeleton so the structure is still visible.
    counts = _concept_counts_by_section(doc_key) if doc_key else {}
    if counts:
        _annotate_concept_counts(forest_nodes, counts)
        _attach_concepts(forest_nodes, _concepts_by_section(doc_key))
    # The course outline IS the textbook's TOC: the whole book minus what the convert-time
    # curate stage hid (front/back matter, orphan Parts) — filtered above by stored flag,
    # never re-decided here.
    section_count = _count_nodes(forest_nodes)
    return [n.as_dict() for n in forest_nodes], section_count, None

