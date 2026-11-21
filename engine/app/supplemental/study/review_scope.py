"""Which review rows belong to a course version — the retention/coverage split, in SQL.

`concept_reviews` holds two kinds of thing, and they scope differently:

**Concept cards** (``item_type IS NULL``) belong to the **book**. Memory is memory: a
concept you have learned stays learned however you re-cut the outline, so its FSRS row is
shared by every version of that source. Forking it would reset the scheduler on a course
you have already studied and tell you that you had forgotten things you hadn't — the one
outcome the whole three-question model exists to avoid.

**Typed items** (``skeleton``, ``chapter``) belong to the **version**. Structure recall
drills *this* outline — its chapters, in its order — so a distilled cut and its parent are
genuinely different drills and must not share rows.

Every read of `concept_reviews` for a course therefore applies ``review_scope`` instead of
a bare ``doc_id`` match. For a Default version (``key == source_id``) the predicate
collapses to exactly that bare match, which is why nothing about existing courses moves.
"""

from __future__ import annotations

from typing import Any

from app.process.content import source_id_of


def review_scope(doc: str | None, *, alias: str = "") -> tuple[str, dict[str, Any]]:
    """The predicate + binds selecting the review rows a course version reads.

    ``doc=None`` means the whole library (the cross-course study surfaces), which needs no
    filter at all. Always parenthesised, so callers can ``AND`` it onto other conditions
    without worrying about precedence.
    """
    if not doc:
        return "TRUE", {}
    p = f"{alias}." if alias else ""
    src = source_id_of(doc)
    if not src or src == doc:
        # A Default version is its own source — one plain match, byte-identical to the
        # pre-versions query.
        return f"({p}doc_id = %(_rdoc)s)", {"_rdoc": doc}
    return (
        f"(({p}item_type IS NULL AND {p}doc_id = %(_rsrc)s) "
        f"OR ({p}item_type IS NOT NULL AND {p}doc_id = %(_rdoc)s))",
        {"_rsrc": src, "_rdoc": doc},
    )
