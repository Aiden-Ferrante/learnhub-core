"""A version's material — the one join that turns a course version into its blocks.

A version does not own text. The book's markdown lives ONCE in ``raw_content``, keyed
by the source, and a course version is a *selection* of those blocks placed into its own
outline — recorded in ``version_blocks`` (version_id, content_key, structure_id, order).
Two versions of a book share every block they both keep; distilling is dropping rows from
this mapping, not copying markdown.

So every read of a version's content goes through ``fetch_blocks``. A bare
``FROM raw_content WHERE doc_id = …`` is a read of the whole BOOK and will silently
ignore a custom version's cut — that query shape is the bug this module exists to prevent.

Two section keys come back, and the difference matters:

``sectionKey``        where the block sits in THIS version's outline (its placement),
                      falling back to the block's own key when it sits under no node.
``sourceSectionKey``  where it came from in the book. Concepts are extracted against the
                      book's own sections, so this is what concept inheritance resolves
                      against — a custom chapter inherits the concepts of whatever source
                      sections its blocks were drawn from.

For a Default version the two are equal by construction (the identity seed), which is why
the whole existing reading experience is byte-identical across this change.
"""

from __future__ import annotations

from typing import Any

from app.gateways import db
from app.process.content.documents import source_id_of

# The FROM/WHERE every version-scoped block read shares. Bind `d` = the version id.
_FROM = (
    "FROM version_blocks vb "
    "JOIN raw_content c ON c.key = vb.content_key "
    "LEFT JOIN raw_structure vs ON vs.id = vb.structure_id "
    "WHERE vb.version_id = %(d)s"
)

# Placement first, the block's own key as the fallback for unplaced/finer-grained blocks.
_SECTION_KEY = 'COALESCE(vs.section_key, c.section_key)'

_LEAN = (
    f'{_SECTION_KEY} AS "sectionKey", c.section_key AS "sourceSectionKey", '
    'vb."order" AS "order", c.heading, c.level, '
    'c.page_start AS "pageStart", c.page_end AS "pageEnd"'
)
_FULL = f'c.key AS "_key", {_LEAN}, c.markdown, c.char_count AS "charCount"'


def block_columns(*, markdown: bool = False) -> str:
    """The SELECT list for a version-block read. ``markdown=True`` pulls the text too —
    leave it off for structural passes (scope spans, chapter units) over a whole book."""
    return _FULL if markdown else _LEAN


def blocks_sql(*, markdown: bool = False, where: str = "", order: str = 'vb."order"') -> str:
    """The full statement, for the few callers that need an extra predicate or ordering.
    ``where`` is ANDed onto the version filter (write it as ``"AND c.page_start >= %(s)s"``)."""
    return f"SELECT {block_columns(markdown=markdown)} {_FROM} {where} ORDER BY {order}"


def section_key_expr() -> str:
    """The placement-aware section-key expression, for callers writing their own SELECT."""
    return _SECTION_KEY


def fetch_blocks(
    doc_id: str,
    *,
    markdown: bool = False,
    where: str = "",
    params: dict[str, Any] | None = None,
    order: str = 'vb."order"',
) -> list[dict[str, Any]]:
    """This version's blocks in its own reading order. Empty for an unknown version."""
    with db() as conn:
        return conn.execute(
            blocks_sql(markdown=markdown, where=where, order=order),
            {"d": doc_id, **(params or {})},
        ).fetchall()


# ---------------------------------------------------------------------------- #
# Version ⇄ book section mapping.
#
# Rows the BOOK owns — concepts above all — are keyed by the book's own section keys,
# while every caller works in the version's keys. These two translate between them, and
# they are the whole of concept inheritance: a version sees the concepts of whatever
# source sections its material was drawn from, so a re-cut course inherits an extraction
# it never paid for. For a Default version both are the identity map.
# ---------------------------------------------------------------------------- #


def has_block_mapping(doc_id: str) -> bool:
    """Whether this version has any material mapping at all. A doc with none is not an
    empty course — it is one we know nothing about (a stub mid-convert, a synthetic
    fixture, anything predating the mapping), and callers must not read that silence as
    "covers nothing" and hide its concepts."""
    with db() as conn:
        row = conn.execute(
            "SELECT 1 FROM version_blocks WHERE version_id = %(d)s LIMIT 1", {"d": doc_id}
        ).fetchone()
    return row is not None


def concept_filter(
    doc_id: str | None, section_keys: list[str] | None = None, *, alias: str = ""
) -> tuple[str, dict[str, Any]]:
    """The SQL predicate + binds selecting the concepts THIS version inherits, and the one
    place that decision is made.

    Concepts belong to the book and are keyed by its sections; a version sees the ones its
    material was drawn from. ``section_keys`` narrows to part of the version (its own
    keys, translated here). ``doc_id=None`` means the whole library — used by the
    cross-course study surfaces.

    Falls back to the unfiltered book when the version has no mapping, per
    ``has_block_mapping``: filtering on absent information would silently empty a course.
    """
    p = f"{alias}." if alias else ""
    if not doc_id:
        return "TRUE", {}
    src = source_id_of(doc_id)
    if not has_block_mapping(doc_id):
        if section_keys is None:
            return f"{p}doc_id = %(_src)s", {"_src": src}
        return (
            f"{p}doc_id = %(_src)s AND {p}section_key = ANY(%(_cov)s::text[])",
            {"_src": src, "_cov": list(section_keys)},
        )
    cov = source_sections(doc_id, section_keys)
    return (
        f"{p}doc_id = %(_src)s AND {p}section_key = ANY(%(_cov)s::text[])",
        {"_src": src, "_cov": cov},
    )


def source_sections(doc_id: str, section_keys: list[str] | None = None) -> list[str]:
    """The BOOK sections this version's material covers — optionally only the part placed
    under ``section_keys`` (which are THIS version's keys). Prefer ``concept_filter``,
    which handles the unmapped-version case this returns a bare empty list for."""
    where = ""
    params: dict[str, Any] = {"d": doc_id}
    if section_keys is not None:
        where = f"AND {_SECTION_KEY} = ANY(%(ks)s::text[])"
        params["ks"] = list(section_keys)
    with db() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT c.section_key AS sk {_FROM} {where}", params
        ).fetchall()
    return [r["sk"] for r in rows if r.get("sk")]


def version_sections_by_source(doc_id: str) -> dict[str, list[str]]:
    """The reverse map: book section → the version sections holding material from it.
    Used to re-key book-owned aggregates (concept counts, coverage) onto the version's
    own outline, which is the tree every surface renders."""
    with db() as conn:
        rows = conn.execute(
            f'SELECT DISTINCT c.section_key AS src, {_SECTION_KEY} AS ver {_FROM}',
            {"d": doc_id},
        ).fetchall()
    out: dict[str, list[str]] = {}
    for r in rows:
        src, ver = r.get("src"), r.get("ver")
        if src and ver:
            out.setdefault(src, []).append(ver)
    return out
