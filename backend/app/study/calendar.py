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

from app.platform import db

_TYPES = ("concept", "skeleton", "figure", "chapter")


def _bucket() -> dict[str, Any]:
    return {"total": 0, "courses": {}}


def _add(bucket: dict[str, Any], doc: str, title: str, item_type: str) -> None:
    bucket["total"] += 1
    course = bucket["courses"].setdefault(doc, {"doc": doc, "title": title, "count": 0, "byType": {}})
    course["count"] += 1
    course["byType"][item_type] = course["byType"].get(item_type, 0) + 1


def _courses_list(bucket: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(bucket["courses"].values(), key=lambda c: -c["count"])


def build_review_calendar(days: int = 60) -> dict[str, Any]:
    """Per-day due load across ALL courses for the next ``days`` days, plus the overdue
    ("due now") pile. Days with nothing due are omitted — the frontend lays out the grid."""
    now = time.time()
    horizon = now + max(1, days) * 86400.0
    try:
        with db() as conn:
            titles = {
                r["k"]: r["t"]
                for r in conn.execute("SELECT key AS k, title AS t FROM documents").fetchall()
            }
            rows = conn.execute(
                'SELECT doc_id AS "docId", item_type AS "itemType", '
                "extract(epoch from due)::float8 AS due FROM concept_reviews "
                "WHERE due IS NOT NULL AND due <= to_timestamp(%(hz)s)",
                {"hz": horizon},
            ).fetchall()
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {"dueNow": {"total": 0, "courses": []}, "days": [], "horizonDays": days, "error": str(exc)}

    due_now = _bucket()
    by_day: dict[str, dict[str, Any]] = {}
    tracked = 0
    for r in rows:
        doc = r.get("docId")
        if doc not in titles:  # reviews orphaned by deleted courses
            continue
        tracked += 1
        item_type = r.get("itemType") if r.get("itemType") in _TYPES else "concept"
        if r["due"] <= now:
            _add(due_now, doc, titles[doc], item_type)
        else:
            day = time.strftime("%Y-%m-%d", time.gmtime(r["due"]))
            _add(by_day.setdefault(day, _bucket()), doc, titles[doc], item_type)

    return {
        "dueNow": {"total": due_now["total"], "courses": _courses_list(due_now)},
        "days": [
            {"date": d, "total": b["total"], "courses": _courses_list(b)}
            for d, b in sorted(by_day.items())
        ],
        "horizonDays": days,
        "tracked": tracked,
    }
