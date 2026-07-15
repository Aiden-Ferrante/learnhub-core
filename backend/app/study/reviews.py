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
front = the image, reveal = the caption.

Functions here return plain payload dicts (plus an HTTP status for grading);
the route layer only parses input and wraps JSON.
"""

from __future__ import annotations

import hashlib
import os
import time
from typing import Any

from app.content.scope import _scope_section_keys
from app.platform.arango import connect_arango
from app.study import srs
from app.study.mastery import record_quiz_event

REVIEWS = "concept_reviews"
CONCEPTS = "concepts"

# Course/library-wide review sessions introduce at most this many never-reviewed concepts per
# day (Anki-style intake discipline) so a big backlog can't flood a session. Chapter-scoped
# review is exempt — studying a chapter is a deliberate "learn these now" action.
NEW_PER_DAY = int(os.getenv("LEARN_NEW_PER_DAY", "10"))

SKELETON_KEY_PREFIX = "skel-"
FIGURE_KEY_PREFIX = "fig-"


def ensure_reviews(db) -> None:
    if not db.has_collection(REVIEWS):
        col = db.create_collection(REVIEWS)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["due"])


def day_start(now: float) -> float:
    """Epoch of local midnight for ``now`` — the boundary for the daily new-card allowance."""
    lt = time.localtime(now)
    return now - (lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec)


def new_allowance(cap: int, introduced_today: int) -> int:
    return max(0, int(cap) - max(0, int(introduced_today)))


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
        "conceptKey": row.get("_key"),
        "name": row.get("heading") or row.get("sectionKey"),
        "kind": "skeleton",
        "signal": "",
        "children": row.get("children") or [],
        "sectionKey": row.get("sectionKey"),
        "docId": row.get("docId"),
        "state": row.get("state", "review"),
        "due": row.get("due"),
    }


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
        "conceptKey": row.get("_key"),
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


def build_review_queue(
    doc: str | None,
    scope: str | None,
    limit: int = 40,
    new_limit: int | None = None,
    day_start_ts: float | None = None,
) -> dict[str, Any]:
    """Concepts to review now: due cards (earliest first) then new (unseen) cards. ``scope`` =
    a sectionKey limits to that section; omit for the whole-course queue.

    Without a scope, new-card intake is capped per local day (``new_limit``, default
    LEARN_NEW_PER_DAY): the queue serves due cards plus at most (cap − introduced-today) new
    ones. ``day_start_ts`` lets the client pass its own midnight so the day boundary follows
    the learner's timezone, not the server's."""
    now = time.time()
    try:
        db = connect_arango()
        if not db.has_collection(CONCEPTS):
            return {"cards": [], "counts": {"due": 0, "new": 0, "later": 0}}
        ensure_reviews(db)
        # A chapter scope spans ALL its sub-sections (same reading-order span the reader and
        # quiz use) — exact-key matching misses everything under a chapter node.
        span = _scope_section_keys(doc, scope) if scope else None
        concepts = list(
            db.aql.execute(
                "FOR c IN concepts "
                "FILTER (@doc == null OR c.docId == @doc) "
                "SORT c.order "
                "RETURN {key: c._key, name: c.name, kind: c.kind, signal: c.signal, "
                "source: c.source, sectionKey: c.sectionKey, docId: c.docId, "
                "pageStart: c.pageStart, pageEnd: c.pageEnd}",
                bind_vars={"doc": doc},
            )
        )
        if span is not None:
            concepts = [c for c in concepts if c.get("sectionKey") in span]
        reviews: dict[str, dict[str, Any]] = {}
        for r in db.aql.execute(
            "FOR r IN concept_reviews FILTER (@doc == null OR r.docId == @doc) "
            "AND r.itemType NOT IN ['skeleton', 'figure'] "
            "RETURN {key: r._key, due: r.due, state: r.state}",
            bind_vars={"doc": doc},
        ):
            reviews[r["key"]] = r
        # Skeleton (structure-recall) and figure-recall cards: they enter the system through
        # deliberate study (the walk / a chapter review), then surface on their SM-2 due date.
        typed_rows = list(
            db.aql.execute(
                "FOR r IN concept_reviews FILTER r.itemType IN ['skeleton', 'figure'] "
                "AND (@doc == null OR r.docId == @doc) RETURN r",
                bind_vars={"doc": doc},
            )
        )
        if scope is not None:
            typed_rows = [
                r
                for r in typed_rows
                if r.get("chapterScope") == scope or (span and r.get("sectionKey") in span)
            ]
        skeleton_rows = [r for r in typed_rows if r.get("itemType") == "skeleton"]
        figure_rows = [r for r in typed_rows if r.get("itemType") == "figure"]
        # Chapter-scoped sessions also OFFER the chapter's unseeded captioned figures as new
        # cards ("what does this figure show?") — first grade seeds their schedule.
        new_figures: list[dict[str, Any]] = []
        if scope is not None and doc and span and db.has_collection("elements"):
            seeded = {r["_key"] for r in figure_rows}
            for f in db.aql.execute(
                "FOR e IN elements FILTER e.docId == @d AND e.type == 'figure' "
                "AND e.caption != null AND e.caption != '' "
                "SORT e.order RETURN {order: e.order, page: e.page, caption: e.caption, "
                "sectionKey: e.sectionKey}",
                bind_vars={"d": doc},
            ):
                if f.get("sectionKey") not in span:
                    continue
                if figure_review_key(doc, int(f.get("order") or 0)) in seeded:
                    continue
                new_figures.append(new_figure_card(doc, f))
        # Daily new-card allowance (unscoped sessions only): how many concepts already got
        # their first grade since the learner's midnight?
        introduced_today = 0
        if scope is None:
            since = day_start_ts if day_start_ts is not None else day_start(now)
            introduced_today = next(
                db.aql.execute(
                    "RETURN COUNT(FOR r IN concept_reviews "
                    "FILTER (@doc == null OR r.docId == @doc) AND r.itemType != 'skeleton' "
                    "AND r.firstReview != null AND r.firstReview >= @since RETURN 1)",
                    bind_vars={"doc": doc, "since": since},
                )
            )
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
    due.sort(key=lambda x: x.get("due") or 0)
    if scope is None:
        allowance = new_allowance(new_limit if new_limit is not None else NEW_PER_DAY, introduced_today)
        served_new = new[:allowance]
    else:
        # Deliberate chapter study: all its new concepts, then its unseeded figures.
        allowance = len(new)
        served_new = new + new_figures
    queue = (due + served_new)[:limit]
    return {
        "cards": queue,
        "counts": {
            "due": len(due),
            "new": len(new) + len(new_figures),
            "later": later,
            "newAllowance": allowance if scope is None else len(served_new),
        },
    }


def grade_review(body: dict, concept_key: str, grade: int, now: float) -> tuple[dict[str, Any], int]:
    """Grade one recall (1=Again, 2=Hard, 3=Good, 4=Easy): advance the SR state (upsert
    concept_reviews) and append a study event so mastery moves. Returns (payload, status)."""
    if body.get("skeleton") or concept_key.startswith(SKELETON_KEY_PREFIX):
        return _grade_skeleton_item(body, concept_key, grade, now)
    if body.get("figure") or concept_key.startswith(FIGURE_KEY_PREFIX):
        return _grade_figure_item(body, concept_key, grade, now)
    if not concept_key:
        return {"error": "conceptKey and grade (1-4) are required"}, 400
    try:
        db = connect_arango()
        ensure_reviews(db)
        concept = db.collection(CONCEPTS).get(concept_key) if db.has_collection(CONCEPTS) else None
        if not concept:
            return {"error": "unknown concept"}, 404
        doc_id = concept.get("docId")
        section_key = concept.get("sectionKey")

        reviews = db.collection(REVIEWS)
        existing = reviews.get(concept_key)
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        row = {
            **next_state,
            "_key": concept_key,
            "docId": doc_id,
            "sectionKey": section_key,
        }
        if not existing:
            row["firstReview"] = now  # feeds the daily new-card allowance
        reviews.insert(row, overwrite=True)  # idempotent upsert (1 row per concept)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    # Append to the mastery floor (best-effort; never breaks the grade flow).
    record_quiz_event(
        section_key,
        None,
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
        db = connect_arango()
        ensure_reviews(db)
        reviews = db.collection(REVIEWS)
        if doc_id and section_key:
            key = skeleton_review_key(doc_id, section_key)
            existing = reviews.get(key)
        elif concept_key.startswith(SKELETON_KEY_PREFIX):
            key = concept_key
            existing = reviews.get(key)
            if not existing:
                return {"error": "unknown skeleton item"}, 404
            doc_id = existing.get("docId")
            section_key = existing.get("sectionKey")
        else:
            return {"error": "doc and sectionKey are required for a skeleton grade"}, 400
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        row = {
            **next_state,
            "_key": key,
            "itemType": "skeleton",
            "docId": doc_id,
            "sectionKey": section_key,
        }
        if not existing:
            row["firstReview"] = now
        heading = str(body.get("heading") or "").strip()
        if heading:
            row["heading"] = heading
        chapter_scope = str(body.get("chapterScope") or "").strip()
        if chapter_scope:
            row["chapterScope"] = chapter_scope
        children = clean_skeleton_children(body.get("children"))
        if children:
            row["children"] = children
        reviews.insert(row, overwrite=True)  # idempotent upsert (1 row per skeleton item)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    # Append to the mastery floor (best-effort; never breaks the grade flow).
    record_quiz_event(
        section_key,
        None,
        correct=(grade >= 3),
        doc=doc_id,
        stem=row.get("heading") or section_key,
        expected="; ".join(c["heading"] for c in (row.get("children") or [])) or None,
        kind="recall",
    )
    return {
        "conceptKey": key,
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
        db = connect_arango()
        ensure_reviews(db)
        reviews = db.collection(REVIEWS)
        if doc_id and order is not None:
            key = figure_review_key(doc_id, int(order))
            existing = reviews.get(key)
        elif concept_key.startswith(FIGURE_KEY_PREFIX):
            key = concept_key
            existing = reviews.get(key)
            if not existing:
                return {"error": "unknown figure item"}, 404
            doc_id = existing.get("docId")
            order = existing.get("figureOrder")
        else:
            return {"error": "doc and figureOrder are required for a figure grade"}, 400
        state = existing if existing else srs.new_state(now)
        next_state = srs.schedule(state, grade, now)
        row = {
            **next_state,
            "_key": key,
            "itemType": "figure",
            "docId": doc_id,
            "figureOrder": int(order) if order is not None else None,
        }
        if not existing:
            row["firstReview"] = now
        for field in ("caption", "sectionKey", "chapterScope"):
            val = str(body.get(field) or "").strip()
            if val:
                row[field] = val
        if body.get("page") is not None:
            row["page"] = body.get("page")
        reviews.insert(row, overwrite=True)  # idempotent upsert (1 row per figure)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}, 500

    record_quiz_event(
        row.get("sectionKey"),
        None,
        correct=(grade >= 3),
        doc=doc_id,
        stem=f"Figure p.{row.get('page')}" if row.get("page") else "Figure",
        expected=row.get("caption"),
        kind="recall",
    )
    return {
        "conceptKey": key,
        "due": next_state["due"],
        "intervalDays": next_state["interval"],
        "state": next_state["state"],
    }, 200
