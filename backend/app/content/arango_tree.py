"""Fetch TOC hierarchy (has_subsection) from ArangoDB and build a nested tree."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from typing import Any

from arango.database import StandardDatabase
from arango.exceptions import ArangoError

from app.platform.arango import _get_db

# The structural-edge predicates in the relationships collection.
HIERARCHY_PREDICATE = "has_subsection"
MENTIONS_PREDICATE = "section_mentions"


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

    # PDF bookmark titles win over extracted headings: the text layer drops ligature
    # glyphs ("Complexity dened") and carries "Chapter N" prefixes, while the bookmark
    # outline stores the clean human title per canonical sectionKey.
    for entry in fetch_outline_titles(db, doc_id).items():
        out[entry[0]] = entry[1]
    return out


def fetch_outline_titles(db: StandardDatabase, doc_id: str) -> dict[str, str]:
    """sectionKey -> clean bookmark title from ``documents.outline`` (empty when absent)."""
    if not db.has_collection("documents"):
        return {}
    rows = list(
        db.aql.execute(
            "FOR d IN documents FILTER d._key == @doc RETURN d.outline",
            bind_vars={"doc": doc_id},
        )
    )
    outline = rows[0] if rows and isinstance(rows[0], list) else []
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


def _count_nodes(nodes: list[TreeNode]) -> int:
    return sum(1 + _count_nodes(n.children) for n in nodes)


def _concept_counts_by_section(db: StandardDatabase, doc_id: str) -> dict[str, int]:
    """Number of extracted concepts per sectionKey for a document."""
    try:
        if not db.has_collection("concepts"):
            return {}
        rows = db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d COLLECT sk = c.sectionKey "
            "WITH COUNT INTO n RETURN {sk: sk, n: n}",
            bind_vars={"d": doc_id},
        )
        return {r["sk"]: r["n"] for r in rows if r.get("sk")}
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


def _concepts_by_section(db: StandardDatabase, doc_id: str) -> dict[str, list[dict[str, Any]]]:
    """sectionKey -> [{key, name, kind}] in extraction order — the syllabus's concept leaves."""
    try:
        if not db.has_collection("concepts"):
            return {}
        rows = db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d SORT c.sectionKey, c.order "
            "RETURN {sk: c.sectionKey, key: c._key, name: c.name, kind: c.kind}",
            bind_vars={"d": doc_id},
        )
        out: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            sk = r.get("sk")
            if sk and r.get("name"):
                out.setdefault(sk, []).append(
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


# Top-level front/back matter to drop so the syllabus reads like the printed Table of Contents
# (these are in the PDF bookmarks but not study content). Matched case-insensitively, exact or
# by prefix, against a node's title.
_FRONT_BACK_EXACT = {
    "cover", "copyright", "title page", "half title", "dedication", "colophon",
    "table of contents", "brief table of contents", "contents", "index",
    "about the author", "about the authors", "acknowledgments", "acknowledgements",
    "notation", "list of figures", "list of tables", "revision history",
    "preface", "foreword", "epilogue", "contributors", "other books you may enjoy",
    "bibliography", "glossary", "references",
}
_FRONT_BACK_PREFIX = ("praise for", "revision history for", "about the author")


def _is_front_back_matter(node: TreeNode) -> bool:
    t = re.sub(r"\s+", " ", (node.title or node.label or "")).strip().lower()
    return t in _FRONT_BACK_EXACT or any(t.startswith(p) for p in _FRONT_BACK_PREFIX)


def _drop_front_back_matter(nodes: list[TreeNode]) -> list[TreeNode]:
    """Show the FULL book TOC (all chapters/sections, extracted or not) but prune obvious
    top-level front/back matter — so the course outline matches the textbook's printed contents."""
    return [n for n in nodes if not _is_front_back_matter(n)]


def _drop_orphan_parts(nodes: list[TreeNode]) -> list[TreeNode]:
    """Drop childless top-level "Part" containers that some PDFs (e.g. the CV book) bookmark at
    the SAME depth as the chapters they should hold — leaving the flat, globally-numbered chapter
    list instead of Part/chapter siblings with colliding numbers. A childless top-level node that
    is immediately followed by a child-bearing (chaptered) node is such an orphan Part. Strict
    no-op for well-nested books (Parts there have children) and for chapterless books."""
    return [
        n
        for i, n in enumerate(nodes)
        if n.children or not (i + 1 < len(nodes) and nodes[i + 1].children)
    ]


def build_tree_from_outline(outline: list[dict[str, Any]]) -> list[TreeNode]:
    """Build the syllabus forest from a document's stored TOC outline — the SAME skeleton the
    Process-tab TOC preview shows. Each entry is ``{numberKey, title, sectionKey, listDepth}``;
    ``listDepth`` (0-based) gives the nesting. This is the primary syllabus source because the
    outline exists for every converted PDF, including slug-keyed books with no numbered
    hierarchy, where the has_subsection KG tree is empty."""
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


def get_toc_tree(doc: str | None = None) -> tuple[list[dict[str, Any]], int, str | None, int]:
    """
    Returns (forest_as_dicts, section_count, error_message, mention_edge_count).
    The syllabus skeleton is the document's stored TOC outline (the TOC-preview structure),
    which is present for every converted PDF — including slug-keyed books with no numbered
    hierarchy. Falls back to the has_subsection KG tree only when no outline is stored.
    When ``doc`` is given it selects that document (by id); unmatched ids fall back to latest.
    """
    try:
        db = _get_db()
        from app.content.documents import fetch_latest_document

        doc_obj = fetch_latest_document(doc).get("document")
        if doc_obj is None:
            doc_obj = fetch_latest_document().get("document")  # id mismatch -> latest
        outline = (doc_obj or {}).get("outline") or []
        # Scope EVERY helper to the resolved document. Section keys (toc:1, toc:summary, …) are
        # unique within a book but COLLIDE across books, so an unscoped query bleeds another
        # book's titles/mentions/counts onto this one (e.g. AI-Eng showing DDIA's chapters).
        doc_key = (doc_obj or {}).get("id")
        mentions_by_section = fetch_section_mentions_by_section(db, doc_key)
        titles_by_key = fetch_section_titles(db, doc_key)
    except ArangoError as e:
        return [], 0, str(e), 0
    except OSError as e:
        return [], 0, str(e), 0
    except Exception as e:
        return [], 0, str(e), 0

    mention_edge_count = sum(len(v) for v in mentions_by_section.values())
    if outline:
        forest_nodes = build_tree_from_outline(outline)
    else:
        edges = fetch_has_subsection_edges(db, doc_key)
        forest_nodes = build_nested_tree(edges)
    apply_section_titles(forest_nodes, titles_by_key)

    # Tie concepts to the tree, then filter the syllabus to only sections that have concepts
    # (keeping their ancestors). If the doc has NO concepts yet (e.g. just converted, not
    # processed), keep the full TOC skeleton so the structure is still visible.
    counts = _concept_counts_by_section(db, doc_key) if doc_key else {}
    if counts:
        _annotate_concept_counts(forest_nodes, counts)
        _attach_concepts(forest_nodes, _concepts_by_section(db, doc_key))
    # The course outline IS the textbook's TOC: show the whole book (chapters & sections, whether
    # or not concepts are extracted yet), pruning only top-level front/back matter, and dropping
    # mis-bookmarked orphan "Part" containers so chapters read as a clean numbered list.
    forest_nodes = _drop_orphan_parts(_drop_front_back_matter(forest_nodes))

    section_count = _count_nodes(forest_nodes)
    enrich_tree_with_section_mentions(forest_nodes, mentions_by_section)
    return [n.as_dict() for n in forest_nodes], section_count, None, mention_edge_count

