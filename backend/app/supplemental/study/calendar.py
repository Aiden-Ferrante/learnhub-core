"""Cross-course review calendar — when everything comes due.

One whole-library read model over ``concept_reviews``: every scheduled item (concepts,
skeletons, figures, chapter resurfaces) bucketed into "due now" plus per-day counts over a
horizon, broken down per course and per item type. This is the aggregator behind the /study
calendar; /api/study-debt stays the compact rollup for external surfaces (nav badge, vault
briefing).
"""

from __future__ import annotations

import time
from typing import Any

from app.gateways import db

_TYPES = ("concept", "skeleton", "figure", "chapter", "practice")

# Per-bucket cap on the ITEM list (counts stay exact). A day with more than this many
# reviews sends the first slice plus ``itemsTruncated`` so the UI can say "+N more"
# instead of silently implying the list is everything.
_ITEM_CAP = 50


def _bucket() -> dict[str, Any]:
    return {"total": 0, "courses": {}, "items": []}


def _add(
    bucket: dict[str, Any],
    doc: str,
    title: str,
    item_type: str,
    item: dict[str, Any] | None = None,
) -> None:
    bucket["total"] += 1
    course = bucket["courses"].setdefault(doc, {"doc": doc, "title": title, "count": 0, "byType": {}})
    course["count"] += 1
    course["byType"][item_type] = course["byType"].get(item_type, 0) + 1
    if item is not None and len(bucket["items"]) < _ITEM_CAP:
        bucket["items"].append(item)


def _courses_list(bucket: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(bucket["courses"].values(), key=lambda c: -c["count"])


def _item_name(row: dict[str, Any]) -> str:
    """What to CALL this review item in a list: its own heading (skeleton/chapter), the
    concept's name, or — for legacy rows carrying neither — the section it belongs to."""
    for candidate in (row.get("heading"), row.get("conceptName"), row.get("sectionKey")):
        text = (candidate or "").strip()
        if text:
            return text
    return "Review item"


def _shape_items(bucket: dict[str, Any]) -> dict[str, Any]:
    """Bucket → wire shape: courses sorted, items capped-with-a-flag, totals exact."""
    return {
        "total": bucket["total"],
        "courses": _courses_list(bucket),
        "items": bucket["items"],
        "itemsTruncated": max(0, bucket["total"] - len(bucket["items"])),
    }


def build_review_calendar(days: int = 60) -> dict[str, Any]:
    """Per-day due load across ALL courses for the next ``days`` days, plus the overdue
    ("due now") pile. Days with nothing due are omitted — the frontend lays out the grid."""
    now = time.time()
    horizon = now + max(1, days) * 86400.0
    try:
        with db() as conn:
            titles = {
                r["k"]: r["t"]
                for r in conn.execute("SELECT d.key AS k, s.title AS t FROM raw_documents d "
                                      "JOIN sources s ON s.key = d.source_id").fetchall()
            }
            # LEFT JOIN so concept rows can be NAMED in the agenda; skeleton/chapter rows
            # carry their own heading and simply miss the join.
            rows = conn.execute(
                'SELECT r.doc_id AS "docId", r.item_type AS "itemType", r.key AS key, '
                'r.heading AS heading, r.section_key AS "sectionKey", '
                'c.name AS "conceptName", '
                "extract(epoch from r.due)::float8 AS due FROM concept_reviews r "
                "LEFT JOIN ext_concepts c ON c.key = r.key "
                "WHERE r.due IS NOT NULL AND r.due <= to_timestamp(%(hz)s) "
                "ORDER BY r.due",
                {"hz": horizon},
            ).fetchall()
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {
            "dueNow": {"total": 0, "courses": [], "items": [], "itemsTruncated": 0},
            "days": [],
            "horizonDays": days,
            "error": str(exc),
        }

    due_now = _bucket()
    by_day: dict[str, dict[str, Any]] = {}
    tracked = 0
    for r in rows:
        doc = r.get("docId")
        if doc not in titles:  # reviews orphaned by deleted courses
            continue
        tracked += 1
        item_type = r.get("itemType") if r.get("itemType") in _TYPES else "concept"
        item = {
            "key": r.get("key"),
            "doc": doc,
            "title": titles[doc],
            "name": _item_name(r),
            "type": item_type,
            "scope": r.get("sectionKey"),
            "due": r["due"],
        }
        if r["due"] <= now:
            _add(due_now, doc, titles[doc], item_type, item)
        else:
            day = time.strftime("%Y-%m-%d", time.gmtime(r["due"]))
            _add(by_day.setdefault(day, _bucket()), doc, titles[doc], item_type, item)

    return {
        "dueNow": _shape_items(due_now),
        "days": [{"date": d, **_shape_items(b)} for d, b in sorted(by_day.items())],
        "horizonDays": days,
        "tracked": tracked,
    }


def build_study_debt(days: int = 7) -> dict[str, Any]:
    """The compact cross-course rollup for external surfaces (nav badge, morning vault
    briefing): what's due NOW and what fades within ``days``, per course and in total.
    A leaner sibling of build_review_calendar — counts only, no per-day grid."""
    now = int(time.time())
    horizon = now + max(1, days) * 86400
    try:
        with db() as conn:
            titles = {
                r["k"]: r["t"]
                for r in conn.execute("SELECT d.key AS k, s.title AS t FROM raw_documents d "
                                      "JOIN sources s ON s.key = d.source_id").fetchall()
            }
            rows = conn.execute(
                "SELECT doc_id AS d, "
                "SUM(CASE WHEN due <= to_timestamp(%(now)s) THEN 1 ELSE 0 END) AS due, "
                "SUM(CASE WHEN due > to_timestamp(%(now)s) AND due <= to_timestamp(%(hz)s) "
                "THEN 1 ELSE 0 END) AS soon, "
                "COUNT(*) AS tracked "
                "FROM concept_reviews WHERE due IS NOT NULL GROUP BY doc_id",
                {"now": now, "hz": horizon},
            ).fetchall()
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {"dueNow": 0, "fadingSoon": 0, "tracked": 0, "days": days, "courses": [], "error": str(exc)}

    courses = [
        {
            "doc": r["d"],
            "title": titles.get(r["d"]) or r["d"],
            "dueNow": int(r["due"] or 0),
            "fadingSoon": int(r["soon"] or 0),
            "tracked": int(r["tracked"] or 0),
        }
        for r in rows
        if r.get("d") in titles  # skip reviews orphaned by deleted courses
    ]
    courses.sort(key=lambda c: (-c["dueNow"], -c["fadingSoon"]))
    return {
        "dueNow": sum(c["dueNow"] for c in courses),
        "fadingSoon": sum(c["fadingSoon"] for c in courses),
        "tracked": sum(c["tracked"] for c in courses),
        "days": days,
        "courses": courses,
    }
