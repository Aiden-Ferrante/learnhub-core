"""Read layer over the ``concepts`` collection — section and document views.

Write-side (extraction) lives in ``concepts_extract``; every surface that only needs
to READ stored concept-lessons (routes, study, deep chapter, augment) imports from
here, keeping readers decoupled from the extraction pipeline.
"""

from __future__ import annotations

from app.content.documents import resolve_doc_id
from app.platform.db import db



def concept_count(doc_id: str, section_keys: list[str]) -> int:
    if not section_keys:
        return 0
    with db() as conn:
        return conn.execute(
            "SELECT count(*) AS n FROM concepts WHERE doc_id = %(d)s AND section_key = ANY(%(ks)s::text[])",
            {"d": doc_id, "ks": section_keys},
        ).fetchone()["n"]


def _concept_reading_ranks(doc_id: str, rows: list[dict]) -> dict[str, int]:
    """Global reading rank per concept: section reading order, then within-section order.
    A strict unique rank gives every concept a stable global reading order."""
    sec_order: dict[str, int] = {}
    with db() as conn:
        srows = conn.execute(
            'SELECT section_key AS k, "order" AS o FROM section_content WHERE doc_id = %(d)s',
            {"d": doc_id},
        ).fetchall()
    for r in srows:
        k, o = r.get("k"), r.get("o") or 0
        if k is not None and (k not in sec_order or o < sec_order[k]):
            sec_order[k] = o
    ordered = sorted(
        rows,
        key=lambda r: (sec_order.get(r["sk"], 1_000_000), r.get("ord") or 0, r["key"]),
    )
    return {r["key"]: i for i, r in enumerate(ordered)}



def fetch_section_concepts(section_key: str, doc_id: str | None = None) -> dict:
    """Stored concept-lessons for a section (the course view + verification).

    A chapter scope spans ALL its descendant sub-sections (mirrors the reading view via
    the shared level-aware span), not just concepts attached to the exact heading block —
    so a chapter shows every concept it teaches, ordered in reading order. Falls back to
    the exact section key when there's no ``section_content`` to span over.
    """
    try:
        doc_id = resolve_doc_id(doc_id)
        if not doc_id:
            return {"sectionKey": section_key, "concepts": []}

        # Expand the scope to every section key within it (chapter -> all sub-sections) and
        # record each section's reading-order rank + heading so concepts come back in
        # document order and the UI can group them under sub-section headers.
        scope_keys = [section_key]
        section_rank: dict[str, int] = {section_key: 0}
        section_titles: dict[str, str] = {}
        try:
            with db() as conn:
                blocks = conn.execute(
                    'SELECT section_key AS "sectionKey", "order", heading, level '
                    'FROM section_content WHERE doc_id = %(d)s ORDER BY "order"',
                    {"d": doc_id},
                ).fetchall()
            if blocks:
                from app.content.scope import scope_blocks

                # One shared resolver (outline-first) — this used to skip the outline
                # step and could under-count a mixed-keyspace chapter's concepts.
                matched = scope_blocks(doc_id, section_key, rows=blocks)
                ranked: dict[str, int] = {}
                for b in matched:
                    sk = b.get("sectionKey")
                    if sk and sk not in ranked:
                        ranked[sk] = b.get("order", len(ranked))
                        if b.get("heading"):
                            section_titles[sk] = b["heading"]
                if ranked:
                    scope_keys = list(ranked.keys())
                    section_rank = ranked
        except Exception:
            scope_keys = [section_key]
            section_rank = {section_key: 0}
            section_titles = {}

        with db() as conn:
            rows = conn.execute(
                'SELECT key AS "conceptKey", name, kind, signal, source, '
                'section_key AS "sectionKey", "order", page_start AS "pageStart", page_end AS "pageEnd" '
                "FROM concepts WHERE doc_id = %(d)s AND section_key = ANY(%(ks)s::text[])",
                {"d": doc_id, "ks": scope_keys},
            ).fetchall()
        # Reading order across the span: by section position, then within-section order.
        rows.sort(
            key=lambda c: (
                section_rank.get(c.get("sectionKey"), 1_000_000),
                c.get("order") if c.get("order") is not None else 0,
            )
        )
        # Ordered list of the sub-sections actually carrying concepts, for UI grouping.
        present = {c.get("sectionKey") for c in rows}
        sections = [
            {"sectionKey": sk, "title": section_titles.get(sk, "")}
            for sk in sorted(present, key=lambda k: section_rank.get(k, 1_000_000))
            if sk
        ]
        # Attach each sub-section's one-line essence + relative depth from the cached chapter
        # skeleton, so the guided concept walk can show "where you are" per subsection.
        try:
            from app.extraction.skeleton import _attach_depths, _key as _skel_key

            with db() as conn:
                skel = conn.execute(
                    "SELECT sections FROM chapter_skeletons WHERE key = %(k)s",
                    {"k": _skel_key(doc_id, section_key)},
                ).fetchone()
            if skel and skel.get("sections"):
                skel_secs = _attach_depths(doc_id, skel["sections"])
                by_key = {s.get("sectionKey"): s for s in skel_secs}
                for sec in sections:
                    s = by_key.get(sec["sectionKey"])
                    if s:
                        sec["essence"] = s.get("essence") or ""
                        sec["depth"] = s.get("depth", 0)
        except Exception:  # noqa: BLE001 — essence is supplementary
            pass
        return {
            "sectionKey": section_key,
            "docId": doc_id,
            "concepts": rows,
            "sections": sections,
        }
    except Exception as exc:
        return {"sectionKey": section_key, "concepts": [], "error": str(exc)}


def fetch_document_concepts(doc_id: str | None = None) -> dict:
    """Document-level concept list, in reading order. (The canonical-dedup grouping was
    retired with the resolve pass — every concept is its own entry; ``appearsIn`` keeps the
    one-element provenance shape clients already consume.)"""
    try:
        doc_id = resolve_doc_id(doc_id)
        if not doc_id:
            return {"docId": None, "concepts": []}
        with db() as conn:
            rows = conn.execute(
                'SELECT key, name, kind, signal, source, '
                'section_key AS "sectionKey", page_start AS "pageStart", page_end AS "pageEnd", "order" '
                "FROM concepts WHERE doc_id = %(d)s",
                {"d": doc_id},
            ).fetchall()
        if not rows:
            return {"docId": doc_id, "concepts": []}
        ranks = _concept_reading_ranks(
            doc_id, [{"key": r["key"], "sk": r["sectionKey"], "ord": r["order"]} for r in rows]
        )
        rows.sort(key=lambda r: ranks.get(r["key"], 10**9))
        out = [
            {
                "conceptKey": r["key"],
                "name": r["name"],
                "kind": r["kind"],
                "signal": r["signal"],
                "source": r.get("source"),
                "questions": [],  # extraction-era questions retired; quiz_questions is the live store
                "sectionKey": r["sectionKey"],
                "pageStart": r.get("pageStart"),
                "pageEnd": r.get("pageEnd"),
                "appearsIn": [
                    {"sectionKey": r["sectionKey"], "pageStart": r.get("pageStart"), "pageEnd": r.get("pageEnd")}
                ],
                "aliasCount": 0,
            }
            for r in rows
        ]
        return {"docId": doc_id, "concepts": out}
    except Exception as exc:  # noqa: BLE001
        return {"docId": doc_id, "concepts": [], "error": str(exc)}
