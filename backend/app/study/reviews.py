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
from typing import Any

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
        "ON CONFLICT (key) DO UPDATE SET doc_id=EXCLUDED.doc_id, section_key=EXCLUDED.section_key, "
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

# Course/library-wide review sessions introduce at most this many never-reviewed concepts per
# day (Anki-style intake discipline) so a big backlog can't flood a session. Chapter-scoped
# review is exempt — studying a chapter is a deliberate "learn these now" action.

SKELETON_KEY_PREFIX = "skel-"
FIGURE_KEY_PREFIX = "fig-"
CHAPTER_KEY_PREFIX = "chap-"


def skeleton_review_key(doc_id: str, section_key: str) -> str:
    """Deterministic review-row key for a skeleton (structure-recall) item — prefixed so it
    can never collide with a concept _key and is recognizable in the grade route."""
    digest = hashlib.sha256(f"{doc_id}|{section_key}".encode()).hexdigest()[:16]
    return SKELETON_KEY_PREFIX + digest


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


def skeleton_card(row: dict[str, Any]) -> dict[str, Any]:
    """Shape a skeleton review row as a queue card (same envelope as concept cards; the panel
    keys and grades by ``conceptKey``, which for skeleton items is the review-row key)."""
    return {
        "itemType": "skeleton",
        "conceptKey": row.get("key"),
        "name": row.get("heading") or row.get("sectionKey"),
        "kind": "skeleton",
        "signal": "",
        "children": row.get("children") or [],
        "sectionKey": row.get("sectionKey"),
        "docId": row.get("docId"),
        "state": row.get("state", "review"),
        "due": row.get("due"),
    }


def chapter_review_key(doc_id: str, scope: str) -> str:
    """Deterministic review-row key for a chapter resurface item — reading a chapter enters
    it into the decay cycle under this key (idempotent per doc + chapter scope)."""
    digest = hashlib.sha256(f"{doc_id}|chap|{scope}".encode()).hexdigest()[:16]
    return CHAPTER_KEY_PREFIX + digest


def chapter_card(row: dict[str, Any]) -> dict[str, Any]:
    """A due chapter-resurface card: front = 'what did this chapter cover?', reveal = the
    chapter's structure snapshot (skeleton headings + essences, or top concepts)."""
    return {
        "itemType": "chapter",
        "conceptKey": row.get("key"),
        "name": row.get("heading") or row.get("sectionKey"),
        "kind": "chapter",
        "signal": "",
        "children": row.get("children") or [],
        "sectionKey": row.get("sectionKey"),
        "docId": row.get("docId"),
        "state": row.get("state", "review"),
        "due": row.get("due"),
    }


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


def figure_review_key(doc_id: str, order: int) -> str:
    """Deterministic review-row key for a figure-recall item (a figure is identified by its
    reading-order ``order`` within a document — the same n /api/figure serves)."""
    digest = hashlib.sha256(f"{doc_id}|fig|{order}".encode()).hexdigest()[:16]
    return FIGURE_KEY_PREFIX + digest


def figure_card(row: dict[str, Any]) -> dict[str, Any]:
    """A due figure-recall card: front = the image (client renders figureOrder via
    /api/figure), reveal = the caption (carried in ``signal`` like a concept's answer)."""
    page = row.get("page")
    return {
        "itemType": "figure",
        "conceptKey": row.get("key"),
        "name": f"Figure · p.{page}" if page else "Figure",
        "kind": "figure",
        "signal": row.get("caption") or "",
        "figureOrder": row.get("figureOrder"),
        "sectionKey": row.get("sectionKey"),
        "docId": row.get("docId"),
        "state": row.get("state", "review"),
        "due": row.get("due"),
    }


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
        skeleton_rows = [r for r in typed_rows if r.get("itemType") == "skeleton"]
        figure_rows = [r for r in typed_rows if r.get("itemType") == "figure"]
        chapter_rows = [r for r in typed_rows if r.get("itemType") == "chapter"]
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
    for r in skeleton_rows:
        if float(r.get("due", 0)) <= now:
            due.append(skeleton_card(r))
        else:
            later += 1
    for r in figure_rows:
        if float(r.get("due", 0)) <= now:
            due.append(figure_card(r))
        else:
            later += 1
    # Chapter resurface items are seeded (never offered as "new") — due only.
    for r in chapter_rows:
        if float(r.get("due", 0)) <= now:
            due.append(chapter_card(r))
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
    if body.get("skeleton") or concept_key.startswith(SKELETON_KEY_PREFIX):
        return _grade_skeleton_item(body, concept_key, grade, now)
    if body.get("figure") or concept_key.startswith(FIGURE_KEY_PREFIX):
        return _grade_figure_item(body, concept_key, grade, now)
    if concept_key.startswith(CHAPTER_KEY_PREFIX):
        return _grade_chapter_item(concept_key, grade, now)
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


def _grade_skeleton_item(body: dict, concept_key: str, grade: int, now: float) -> tuple[dict[str, Any], int]:
    """Advance (or seed) the SM-2 state of one skeleton item and log a ``recall`` study event.

    The chapter walk creates the row (doc + sectionKey + structure snapshot); queue re-grades
    address the existing row by its ``skel-…`` key, so no snapshot is needed then.
    """
    doc_id = str(body.get("doc") or "").strip()
    section_key = str(body.get("sectionKey") or "").strip()
    try:
        with db() as conn:
            if doc_id and section_key:
                key = skeleton_review_key(doc_id, section_key)
                existing = conn.execute(_REVIEW_STATE_SELECT + " WHERE key = %(k)s", {"k": key}).fetchone()
            elif concept_key.startswith(SKELETON_KEY_PREFIX):
                key = concept_key
                existing = conn.execute(
                    _REVIEW_STATE_SELECT.replace(
                        " FROM concept_reviews",
                        ', doc_id AS "docId", section_key AS "sectionKey" FROM concept_reviews',
                    ) + " WHERE key = %(k)s",
                    {"k": key},
                ).fetchone()
                if not existing:
                    return {"error": "unknown skeleton item"}, 404
                doc_id = existing.get("docId")
                section_key = existing.get("sectionKey")
            else:
                return {"error": "doc and sectionKey are required for a skeleton grade"}, 400
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        heading = str(body.get("heading") or "").strip() or None
        chapter_scope = str(body.get("chapterScope") or "").strip() or None
        children = clean_skeleton_children(body.get("children")) or None
        with db() as conn:
            _upsert_review(conn, key, doc_id, section_key, next_state, is_new=not existing,
                           extra={"itemType": "skeleton", "heading": heading,
                                  "chapterScope": chapter_scope, "children": children})
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    # Append to the mastery floor (best-effort; never breaks the grade flow).
    record_quiz_event(
        section_key,
        correct=(grade >= 3),
        doc=doc_id,
        stem=heading or section_key,
        expected="; ".join(c["heading"] for c in (children or [])) or None,
        kind="recall",
    )
    return {
        "conceptKey": key,
        "due": next_state["due"],
        "intervalDays": next_state["interval"],
        "state": next_state["state"],
    }, 200


def _grade_chapter_item(concept_key: str, grade: int, now: float) -> tuple[dict[str, Any], int]:
    """Advance one chapter-resurface item and log a ``resurface`` study event. Rows are only
    ever created by ``ensure_chapter_item`` (reading), so grades always address an existing
    ``chap-…`` key from the queue."""
    try:
        with db() as conn:
            existing = conn.execute(
                _REVIEW_STATE_SELECT.replace(
                    " FROM concept_reviews",
                    ', doc_id AS "docId", section_key AS "sectionKey", heading FROM concept_reviews',
                ) + " WHERE key = %(k)s",
                {"k": concept_key},
            ).fetchone()
        if not existing:
            return {"error": "unknown chapter item"}, 404
        doc_id = existing.get("docId")
        section_key = existing.get("sectionKey")
        next_state = srs.schedule(existing, grade, now)
        with db() as conn:
            _upsert_review(conn, concept_key, doc_id, section_key, next_state, is_new=False,
                           extra={"itemType": "chapter"})
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    record_quiz_event(
        section_key,
        correct=(grade >= 3),
        doc=doc_id,
        stem=existing.get("heading") or section_key,
        kind="resurface",
    )
    return {
        "conceptKey": concept_key,
        "due": next_state["due"],
        "intervalDays": next_state["interval"],
        "state": next_state["state"],
    }, 200


def _grade_figure_item(body: dict, concept_key: str, grade: int, now: float) -> tuple[dict[str, Any], int]:
    """Advance (or seed) the SM-2 state of one figure-recall item and log a ``recall`` event.

    First grades come from a chapter-scoped session and carry the snapshot (doc + figureOrder
    + caption/page/sectionKey); queue re-grades address the existing row by its ``fig-…`` key.
    """
    doc_id = str(body.get("doc") or "").strip()
    order = body.get("figureOrder")
    try:
        with db() as conn:
            if doc_id and order is not None:
                key = figure_review_key(doc_id, int(order))
                existing = conn.execute(_REVIEW_STATE_SELECT + " WHERE key = %(k)s", {"k": key}).fetchone()
            elif concept_key.startswith(FIGURE_KEY_PREFIX):
                key = concept_key
                existing = conn.execute(
                    _REVIEW_STATE_SELECT.replace(
                        " FROM concept_reviews",
                        ', doc_id AS "docId", figure_order AS "figureOrder" FROM concept_reviews',
                    ) + " WHERE key = %(k)s",
                    {"k": key},
                ).fetchone()
                if not existing:
                    return {"error": "unknown figure item"}, 404
                doc_id = existing.get("docId")
                order = existing.get("figureOrder")
            else:
                return {"error": "doc and figureOrder are required for a figure grade"}, 400
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        extra: dict[str, Any] = {"itemType": "figure", "figureOrder": int(order) if order is not None else None}
        section_key = str(body.get("sectionKey") or "").strip() or None
        for field in ("caption", "chapterScope"):
            val = str(body.get(field) or "").strip()
            if val:
                extra[field] = val
        if body.get("page") is not None:
            extra["page"] = body.get("page")
        with db() as conn:
            _upsert_review(conn, key, doc_id, section_key, next_state, is_new=not existing, extra=extra)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    record_quiz_event(
        section_key,
        correct=(grade >= 3),
        doc=doc_id,
        stem=f"Figure p.{extra.get('page')}" if extra.get("page") else "Figure",
        expected=extra.get("caption"),
        kind="recall",
    )
    return {
        "conceptKey": key,
        "due": next_state["due"],
        "intervalDays": next_state["interval"],
        "state": next_state["state"],
    }, 200
