"""Spaced-repetition review queue + grading (keyless/deterministic — no LLM).

The review schedule lives in a mutable ``concept_reviews`` collection (one row per
concept, _key = concept _key); every grade also appends to the append-only
``study_events`` floor so mastery + the heatmap keep working from one log.

The same collection also schedules SKELETON items (``itemType: "skeleton"``, _key
prefixed ``skel-``): structure-recall cards seeded by the chapter walk's self-grades,
so "rebuild this branch from memory" resurfaces on the same SM-2 clock as concepts.
The branch's children (headings + essences) are snapshotted on the row at grade time —
a book's structure is static, and the snapshot lets the review reveal re-show the truth
without resolving the TOC tree. Figure-recall items (``fig-…``) work the same way:
front = the image, reveal = the caption. Chapter-resurface items (``chap-…``) are seeded
by READING (ensure_chapter_item, an implicit first-exposure Good) so everything studied —
not just quizzed concepts — fades and comes back through the same queue.

Functions here return plain payload dicts (plus an HTTP status for grading);
the route layer only parses input and wraps JSON.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from typing import Any, Callable

from psycopg.types.json import Json

from app.content import scope_section_keys
from app.platform import db
from app.study import srs
from app.study.mastery import record_quiz_event

# Read a review row into an srs state dict (epoch floats; camelCase keys srs/schedule expect).
_REVIEW_STATE_SELECT = (
    'SELECT extract(epoch from due)::float8 AS due, interval, ease, reps, lapses, state, '
    'stability, difficulty, step, '
    'last_grade AS "lastGrade", extract(epoch from last_review)::float8 AS "lastReview", '
    'extract(epoch from first_review)::float8 AS "firstReview" FROM concept_reviews'
)


def _upsert_review(conn, key, doc_id, section_key, st, is_new=False, extra=None):
    """Upsert one SM-2 review row (state dict ``st`` from srs). Preserves the original
    first_review; ``extra`` carries skeleton/figure metadata (itemType/chapterScope/caption/…)."""
    extra = extra or {}
    p = {
        "key": key, "doc_id": doc_id, "section_key": section_key,
        "due": st["due"], "ease": st.get("ease"), "interval": st.get("interval"),
        "reps": st.get("reps"), "lapses": st.get("lapses"), "state": st.get("state"),
        "stab": st.get("stability"), "diff": st.get("difficulty"), "step": st.get("step"),
        "lg": st.get("lastGrade"), "lr": st.get("lastReview"),
        "fr": st.get("lastReview") if is_new else None,
        "it": extra.get("itemType"), "cs": extra.get("chapterScope"),
        "cap": extra.get("caption"), "pg": extra.get("page"), "ord": extra.get("order"),
        "hd": extra.get("heading"),
        "ch": Json(extra["children"]) if extra.get("children") is not None else None,
        "fo": extra.get("figureOrder"),
    }
    conn.execute(
        'INSERT INTO concept_reviews (key, doc_id, section_key, due, ease, interval, reps, lapses, '
        'state, stability, difficulty, step, '
        'last_grade, last_review, first_review, item_type, chapter_scope, caption, page, "order", '
        "heading, children, figure_order) "
        "VALUES (%(key)s,%(doc_id)s,%(section_key)s, to_timestamp(%(due)s), %(ease)s,%(interval)s,"
        "%(reps)s,%(lapses)s,%(state)s,%(stab)s,%(diff)s,%(step)s,%(lg)s, to_timestamp(%(lr)s), "
        # to_timestamp(NULL) is NULL; the explicit cast lets server-side binding type a None param.
        "to_timestamp(%(fr)s::float8), %(it)s,%(cs)s,%(cap)s,%(pg)s,%(ord)s,"
        "%(hd)s,%(ch)s,%(fo)s) "
        "ON CONFLICT (key) DO UPDATE SET doc_id=EXCLUDED.doc_id, "
        # section_key COALESCE'd (like the other identity cols below) so a key-only re-grade
        # that carries no snapshot can't null out a figure/typed row's section.
        "section_key=COALESCE(EXCLUDED.section_key, concept_reviews.section_key), "
        "due=EXCLUDED.due, ease=EXCLUDED.ease, interval=EXCLUDED.interval, reps=EXCLUDED.reps, "
        "lapses=EXCLUDED.lapses, state=EXCLUDED.state, last_grade=EXCLUDED.last_grade, "
        "stability=EXCLUDED.stability, difficulty=EXCLUDED.difficulty, step=EXCLUDED.step, "
        "last_review=EXCLUDED.last_review, "
        "first_review=COALESCE(concept_reviews.first_review, EXCLUDED.first_review), "
        "item_type=COALESCE(concept_reviews.item_type, EXCLUDED.item_type), "
        "chapter_scope=COALESCE(EXCLUDED.chapter_scope, concept_reviews.chapter_scope), "
        "caption=COALESCE(EXCLUDED.caption, concept_reviews.caption), "
        "page=COALESCE(EXCLUDED.page, concept_reviews.page), "
        '"order"=COALESCE(EXCLUDED."order", concept_reviews."order"), '
        "heading=COALESCE(EXCLUDED.heading, concept_reviews.heading), "
        "children=COALESCE(EXCLUDED.children, concept_reviews.children), "
        "figure_order=COALESCE(EXCLUDED.figure_order, concept_reviews.figure_order)",
        p,
    )

# --------------------------------------------------------------------------- #
# Typed review items — skeleton (structure recall), figure, chapter (resurface).
# Everything that isn't a plain concept card flows through ONE table-driven path: a
# _TypedItem spec per kind captures how it keys, seeds, grades, cards, and what study
# event it logs. Adding a kind = one _TYPED entry, not new grade/card/key functions.
# --------------------------------------------------------------------------- #

SKELETON_KEY_PREFIX = "skel-"
FIGURE_KEY_PREFIX = "fig-"
CHAPTER_KEY_PREFIX = "chap-"


def _typed_key(prefix: str, *parts: object) -> str:
    """Deterministic, collision-proof review-row key: PREFIX + sha256(parts joined by '|').
    The prefix both namespaces the key away from concept keys and routes the grade."""
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:16]
    return prefix + digest


def skeleton_review_key(doc_id: str, section_key: str) -> str:
    """Structure-recall row key (front = 'rebuild this branch from memory')."""
    return _typed_key(SKELETON_KEY_PREFIX, doc_id, section_key)


def figure_review_key(doc_id: str, order: int) -> str:
    """Figure-recall row key (a figure is identified by its reading-order ``order``)."""
    return _typed_key(FIGURE_KEY_PREFIX, doc_id, "fig", order)


def chapter_review_key(doc_id: str, scope: str) -> str:
    """Chapter-resurface row key (reading a chapter seeds it into the decay cycle)."""
    return _typed_key(CHAPTER_KEY_PREFIX, doc_id, "chap", scope)


def clean_skeleton_children(children: object) -> list[dict[str, str]]:
    """Sanitize a walk-supplied children snapshot to [{heading, essence}] rows."""
    out: list[dict[str, str]] = []
    if not isinstance(children, list):
        return out
    for c in children:
        if not isinstance(c, dict):
            continue
        heading = str(c.get("heading") or "").strip()
        if heading:
            out.append({"heading": heading, "essence": str(c.get("essence") or "").strip()})
    return out


# -- per-kind hooks: resolve a grade to (key, seed-identity), build the upsert extra + event -- #

def _resolve_skeleton(body: dict, key: str) -> tuple[str, dict]:
    doc = str(body.get("doc") or "").strip()
    section = str(body.get("sectionKey") or "").strip()
    if doc and section:  # first grade carries the snapshot → seed
        return skeleton_review_key(doc, section), {"docId": doc, "sectionKey": section}
    if key.startswith(SKELETON_KEY_PREFIX):  # queue re-grade → identity from the row
        return key, {}
    raise ValueError("doc and sectionKey are required for a skeleton grade")


def _resolve_figure(body: dict, key: str) -> tuple[str, dict]:
    doc = str(body.get("doc") or "").strip()
    order = body.get("figureOrder")
    if doc and order is not None:
        section = str(body.get("sectionKey") or "").strip() or None
        return figure_review_key(doc, int(order)), {"docId": doc, "figureOrder": int(order), "sectionKey": section}
    if key.startswith(FIGURE_KEY_PREFIX):
        return key, {}
    raise ValueError("doc and figureOrder are required for a figure grade")


def _resolve_chapter(body: dict, key: str) -> tuple[str, dict]:
    return key, {}  # only ever re-graded from the queue; identity comes from the row


def _extra_skeleton(body: dict, info: dict) -> dict:
    return {
        "heading": str(body.get("heading") or "").strip() or None,
        "chapterScope": str(body.get("chapterScope") or "").strip() or None,
        "children": clean_skeleton_children(body.get("children")) or None,
    }


def _extra_figure(body: dict, info: dict) -> dict:
    return {
        "figureOrder": info.get("figureOrder"),
        "caption": str(body.get("caption") or "").strip() or None,
        "chapterScope": str(body.get("chapterScope") or "").strip() or None,
        "page": body.get("page"),
    }


def _extra_chapter(body: dict, info: dict) -> dict:
    return {}


def _event_skeleton(info: dict, extra: dict) -> dict:
    kids = extra.get("children") or []
    return {"stem": extra.get("heading") or info.get("sectionKey"),
            "expected": "; ".join(c["heading"] for c in kids) or None}


def _event_figure(info: dict, extra: dict) -> dict:
    page = extra.get("page")
    return {"stem": f"Figure p.{page}" if page else "Figure", "expected": extra.get("caption")}


def _event_chapter(info: dict, extra: dict) -> dict:
    return {"stem": info.get("heading") or info.get("sectionKey"), "expected": None}


def _name_structure(row: dict) -> str:
    return row.get("heading") or row.get("sectionKey")


def _name_figure(row: dict) -> str:
    page = row.get("page")
    return f"Figure · p.{page}" if page else "Figure"


@dataclass(frozen=True)
class _TypedItem:
    """The whole per-kind contract in one place — see the module comment above."""
    item_type: str                                     # concept_reviews.item_type + card itemType
    prefix: str                                        # review-row key prefix (routes grading)
    body_flag: str | None                              # body key that also routes a grade here
    event_kind: str                                    # study_events.kind logged on a grade
    card_kind: str                                     # queue-card "kind"
    lookup_cols: str                                   # extra SELECT cols to recover identity
    resolve: Callable[[dict, str], tuple[str, dict]]   # (body, key) -> (row key, seed identity)
    extra: Callable[[dict, dict], dict]                # (body, identity) -> upsert extra
    event: Callable[[dict, dict], dict]                # (identity, extra) -> {stem, expected}
    card_name: Callable[[dict], str]
    card_signal: Callable[[dict], str]
    card_extra: Callable[[dict], dict]                 # card fields beyond the common envelope


_TYPED: dict[str, _TypedItem] = {
    "skeleton": _TypedItem(
        item_type="skeleton", prefix=SKELETON_KEY_PREFIX, body_flag="skeleton",
        event_kind="recall", card_kind="skeleton",
        lookup_cols=', doc_id AS "docId", section_key AS "sectionKey"',
        resolve=_resolve_skeleton, extra=_extra_skeleton, event=_event_skeleton,
        card_name=_name_structure, card_signal=lambda r: "",
        card_extra=lambda r: {"children": r.get("children") or []},
    ),
    "figure": _TypedItem(
        item_type="figure", prefix=FIGURE_KEY_PREFIX, body_flag="figure",
        event_kind="recall", card_kind="figure",
        lookup_cols=', doc_id AS "docId", section_key AS "sectionKey", figure_order AS "figureOrder"',
        resolve=_resolve_figure, extra=_extra_figure, event=_event_figure,
        card_name=_name_figure, card_signal=lambda r: r.get("caption") or "",
        card_extra=lambda r: {"figureOrder": r.get("figureOrder")},
    ),
    "chapter": _TypedItem(
        item_type="chapter", prefix=CHAPTER_KEY_PREFIX, body_flag=None,
        event_kind="resurface", card_kind="chapter",
        lookup_cols=', doc_id AS "docId", section_key AS "sectionKey", heading',
        resolve=_resolve_chapter, extra=_extra_chapter, event=_event_chapter,
        card_name=_name_structure, card_signal=lambda r: "",
        card_extra=lambda r: {"children": r.get("children") or []},
    ),
}


def _typed_card(spec: _TypedItem, row: dict[str, Any]) -> dict[str, Any]:
    """Shape a due typed review row as a queue card (same envelope as concept cards; the panel
    keys and grades by ``conceptKey`` = the review-row key)."""
    return {
        "itemType": spec.item_type,
        "conceptKey": row.get("key"),
        "name": spec.card_name(row),
        "kind": spec.card_kind,
        "signal": spec.card_signal(row),
        "sectionKey": row.get("sectionKey"),
        "docId": row.get("docId"),
        "state": row.get("state", "review"),
        "due": row.get("due"),
        **spec.card_extra(row),
    }


def skeleton_card(row: dict[str, Any]) -> dict[str, Any]:
    """A due structure-recall card (front = 'rebuild this branch', reveal = its children)."""
    return _typed_card(_TYPED["skeleton"], row)


def chapter_card(row: dict[str, Any]) -> dict[str, Any]:
    """A due chapter-resurface card (front = 'what did this chapter cover?', reveal = structure)."""
    return _typed_card(_TYPED["chapter"], row)


def _grade_typed_item(spec: _TypedItem, body: dict, concept_key: str, grade: int,
                      now: float) -> tuple[dict[str, Any], int]:
    """Seed or advance one typed item's FSRS state, then log its study event. A first grade may
    carry a snapshot (skeleton: doc+sectionKey; figure: doc+figureOrder) that seeds the row;
    queue re-grades address the existing row by its prefixed key. Chapters only ever re-grade."""
    try:
        key, ident = spec.resolve(body, concept_key)
    except ValueError as exc:
        return {"error": str(exc)}, 400
    try:
        with db() as conn:
            existing = conn.execute(
                _REVIEW_STATE_SELECT.replace(
                    " FROM concept_reviews", f"{spec.lookup_cols} FROM concept_reviews"
                ) + " WHERE key = %(k)s",
                {"k": key},
            ).fetchone()
        if not existing and not ident:  # a key-only re-grade of a row that isn't there
            return {"error": f"unknown {spec.item_type} item"}, 404
        info = {**(existing or {}), **ident}  # a body snapshot (ident) overrides the stored row
        doc_id = info.get("docId")
        section_key = info.get("sectionKey")
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        extra = {"itemType": spec.item_type, **spec.extra(body, info)}
        with db() as conn:
            _upsert_review(conn, key, doc_id, section_key, next_state, is_new=not existing, extra=extra)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    # Append to the mastery floor (best-effort; never breaks the grade flow).
    ev = spec.event(info, extra)
    record_quiz_event(section_key, correct=(grade >= 3), doc=doc_id,
                      stem=ev["stem"], expected=ev.get("expected"), kind=spec.event_kind)
    return {
        "conceptKey": key,
        "due": next_state["due"],
        "intervalDays": next_state["interval"],
        "state": next_state["state"],
    }, 200


def _chapter_snapshot(doc_id: str, scope: str) -> tuple[str | None, list[dict[str, str]]]:
    """(heading, reveal children) for a chapter resurface row: the chapter walk's skeleton
    if one exists, else the chapter's top concepts as heading/essence pairs."""
    heading: str | None = None
    children: list[dict[str, str]] = []
    with db() as conn:
        row = conn.execute(
            "SELECT heading FROM section_content WHERE doc_id = %(d)s AND section_key = %(s)s LIMIT 1",
            {"d": doc_id, "s": scope},
        ).fetchone()
        if row and row.get("heading"):
            heading = str(row["heading"]).strip() or None
        skel = conn.execute(
            "SELECT sections FROM chapter_skeletons WHERE doc_id = %(d)s AND scope = %(s)s LIMIT 1",
            {"d": doc_id, "s": scope},
        ).fetchone()
    if skel and skel.get("sections"):
        children = clean_skeleton_children(skel["sections"])
        if not heading and children:
            heading = children[0]["heading"]
    if not children:
        span = scope_section_keys(doc_id, scope)
        if span:
            with db() as conn:
                concepts = conn.execute(
                    'SELECT name, signal, section_key AS "sectionKey" FROM concepts '
                    'WHERE doc_id = %(d)s ORDER BY "order"',
                    {"d": doc_id},
                ).fetchall()
            children = [
                {"heading": c["name"], "essence": (c.get("signal") or "")[:120]}
                for c in concepts
                if c.get("sectionKey") in span
            ][:8]
    return heading, children


def ensure_chapter_item(doc_id: str, scope: str, now: float | None = None) -> bool:
    """Enter a chapter into the decay cycle on first read: seed a resurface review row with
    an implicit first-exposure Good (due in a few days). Idempotent — later reads never touch
    the row (re-reading is not recall; only grading moves the schedule). Returns True when a
    row was created. Best-effort: never raises into the engagement path."""
    if not doc_id or not scope:
        return False
    now = now or time.time()
    try:
        key = chapter_review_key(doc_id, scope)
        with db() as conn:
            if conn.execute("SELECT 1 FROM concept_reviews WHERE key = %(k)s", {"k": key}).fetchone():
                return False
        heading, children = _chapter_snapshot(doc_id, scope)
        state = srs.schedule(srs.new_state(now), 3, now)  # reading = first successful exposure
        with db() as conn:
            _upsert_review(conn, key, doc_id, scope, state, is_new=True,
                           extra={"itemType": "chapter", "heading": heading,
                                  "chapterScope": scope, "children": children or None})
        return True
    except Exception:  # noqa: BLE001 — seeding must never break the read path
        return False


def figure_card(row: dict[str, Any]) -> dict[str, Any]:
    """A due figure-recall card (front = the image via figureOrder, reveal = the caption)."""
    return _typed_card(_TYPED["figure"], row)


def new_figure_card(doc_id: str, fig: dict[str, Any]) -> dict[str, Any]:
    """An unseeded figure as a 'new' card (chapter-scoped sessions only — figures enter the
    review system through deliberate chapter study, the way skeletons enter through the walk)."""
    page = fig.get("page")
    return {
        "itemType": "figure",
        "conceptKey": figure_review_key(doc_id, int(fig.get("order") or 0)),
        "name": f"Figure · p.{page}" if page else "Figure",
        "kind": "figure",
        "signal": fig.get("caption") or "",
        "figureOrder": fig.get("order"),
        "page": page,
        "sectionKey": fig.get("sectionKey"),
        "docId": doc_id,
        "state": "new",
        "due": None,
    }


def _card(c: dict[str, Any], state: str, due: float | None) -> dict[str, Any]:
    return {
        "conceptKey": c["key"],
        "name": c.get("name"),
        "kind": c.get("kind"),
        "signal": c.get("signal"),
        "source": c.get("source"),
        "sectionKey": c.get("sectionKey"),
        "docId": c.get("docId"),
        "pageStart": c.get("pageStart"),
        "pageEnd": c.get("pageEnd"),
        "state": state,
        "due": due,
    }


def build_review_queue(doc: str | None, scope: str, limit: int = 40) -> dict[str, Any]:
    """Concepts to review now for ONE chapter/section scope: due cards (earliest first)
    then the scope's new (unseen) cards and unseeded figures. Studying is deliberately
    chapter-scoped — the course-wide session was retired 2026-07-15."""
    now = time.time()
    try:
        # A chapter scope spans ALL its sub-sections (same reading-order span the reader and
        # quiz use) — exact-key matching misses everything under a chapter node.
        span = scope_section_keys(doc, scope)
        with db() as conn:
            concepts = conn.execute(
                'SELECT key, name, kind, signal, source, section_key AS "sectionKey", '
                'doc_id AS "docId", page_start AS "pageStart", page_end AS "pageEnd" '
                'FROM concepts WHERE (%(doc)s::text IS NULL OR doc_id = %(doc)s) ORDER BY "order"',
                {"doc": doc},
            ).fetchall()
            reviews: dict[str, dict[str, Any]] = {}
            for r in conn.execute(
                "SELECT key, extract(epoch from due)::float8 AS due, state FROM concept_reviews "
                "WHERE (%(doc)s::text IS NULL OR doc_id = %(doc)s) "
                "AND (item_type IS NULL OR item_type NOT IN ('skeleton', 'figure', 'chapter'))",
                {"doc": doc},
            ).fetchall():
                reviews[r["key"]] = r
            # Skeleton (structure-recall), figure-recall, and chapter-resurface cards.
            typed_rows = conn.execute(
                'SELECT key, doc_id AS "docId", extract(epoch from due)::float8 AS due, state, '
                'item_type AS "itemType", chapter_scope AS "chapterScope", section_key AS "sectionKey", '
                'caption, page, "order", heading, children, figure_order AS "figureOrder" '
                "FROM concept_reviews WHERE item_type IN ('skeleton', 'figure', 'chapter') "
                "AND (%(doc)s::text IS NULL OR doc_id = %(doc)s)",
                {"doc": doc},
            ).fetchall()
        if span is not None:
            concepts = [c for c in concepts if c.get("sectionKey") in span]
        typed_rows = [
            r
            for r in typed_rows
            if r.get("chapterScope") == scope or (span and r.get("sectionKey") in span)
        ]
        figure_rows = [r for r in typed_rows if r.get("itemType") == "figure"]
        # Chapter sessions also OFFER the chapter's unseeded captioned figures as new cards.
        new_figures: list[dict[str, Any]] = []
        if doc and span:
            seeded = {r["key"] for r in figure_rows}
            with db() as conn:
                figs = conn.execute(
                    'SELECT "order", page, caption, section_key AS "sectionKey" FROM elements '
                    "WHERE doc_id = %(d)s AND type = 'figure' AND caption IS NOT NULL AND caption <> '' "
                    'ORDER BY "order"',
                    {"d": doc},
                ).fetchall()
            for f in figs:
                if f.get("sectionKey") not in span:
                    continue
                if figure_review_key(doc, int(f.get("order") or 0)) in seeded:
                    continue
                new_figures.append(new_figure_card(doc, f))
    except Exception as exc:  # noqa: BLE001
        return {"cards": [], "counts": {"due": 0, "new": 0, "later": 0}, "error": str(exc)}

    due: list[dict[str, Any]] = []
    new: list[dict[str, Any]] = []
    later = 0
    for c in concepts:
        r = reviews.get(c["key"])
        if r is None:
            new.append(_card(c, "new", None))
        elif float(r.get("due", 0)) <= now:
            due.append(_card(c, r.get("state", "review"), r.get("due")))
        else:
            later += 1
    # Skeleton/figure/chapter rows are seeded (never offered as "new") — due only, one path.
    for r in typed_rows:
        spec = _TYPED.get(r.get("itemType"))
        if spec is None:
            continue
        if float(r.get("due", 0)) <= now:
            due.append(_typed_card(spec, r))
        else:
            later += 1
    due.sort(key=lambda x: x.get("due") or 0)
    # Deliberate chapter study: all its new concepts, then its unseeded figures.
    served_new = new + new_figures
    queue = (due + served_new)[:limit]
    return {
        "cards": queue,
        "counts": {"due": len(due), "new": len(new) + len(new_figures), "later": later},
    }


def grade_review(body: dict, concept_key: str, grade: int, now: float) -> tuple[dict[str, Any], int]:
    """Grade one recall (1=Again, 2=Hard, 3=Good, 4=Easy): advance the SR state (upsert
    concept_reviews) and append a study event so mastery moves. Returns (payload, status)."""
    # Typed items (skeleton/figure/chapter) route by a body flag or the key prefix.
    for spec in _TYPED.values():
        if (spec.body_flag and body.get(spec.body_flag)) or concept_key.startswith(spec.prefix):
            return _grade_typed_item(spec, body, concept_key, grade, now)
    if not concept_key:
        return {"error": "conceptKey and grade (1-4) are required"}, 400
    try:
        with db() as conn:
            concept = conn.execute(
                'SELECT doc_id AS "docId", section_key AS "sectionKey", name, signal '
                "FROM concepts WHERE key = %(k)s",
                {"k": concept_key},
            ).fetchone()
            if not concept:
                return {"error": "unknown concept"}, 404
            doc_id = concept.get("docId")
            section_key = concept.get("sectionKey")
            existing = conn.execute(_REVIEW_STATE_SELECT + " WHERE key = %(k)s", {"k": concept_key}).fetchone()
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        with db() as conn:
            _upsert_review(conn, concept_key, doc_id, section_key, next_state, is_new=not existing)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    # Append to the mastery floor (best-effort; never breaks the grade flow).
    record_quiz_event(
        section_key,
        correct=(grade >= 3),
        doc=doc_id,
        stem=concept.get("name"),
        expected=concept.get("signal"),
        concept_key=concept_key,
    )
    return {
        "conceptKey": concept_key,
        "due": next_state["due"],
        "intervalDays": next_state["interval"],
        "state": next_state["state"],
    }, 200
