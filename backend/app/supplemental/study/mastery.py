"""Persisted study events + view-time memory-state computation.

The three-question tracking model gives every number one job:
  - "what should I do?"  → forecast (due now + horizon), computed here
  - "what's the state of my memory?" → per-section COVERAGE + RETENTION, computed here
  - "what have I done?"  → activity heatmap + cadence (here) and sessions (sessions.py)

Coverage = distinct reviewed concepts / total concepts in the section.
Retention = mean FSRS retrievability over the section's reviewed concepts — the SAME
memory model that schedules the review queue (srs.retrievability), so "fading" here
and "due" there can never disagree. States: new (nothing reviewed) · solid (≥ 0.9)
· shaky (0.7–0.9) · fading (< 0.7).

Only raw events + FSRS rows persist; everything is recomputed on read because
retention is time-dependent. Internal sections roll up as concept-count-weighted
averages over their descendant leaf sections.
"""

from __future__ import annotations

import time
from typing import Any

from app.process.content import concept_filter, get_toc_tree, version_sections_by_source
from app.supplemental.study.review_scope import review_scope
from app.gateways import db
from app.supplemental.study import srs

# Retention state thresholds (fractions of modelled recall probability). 0.9 is FSRS's
# scheduling target — an item at its due date sits exactly on the solid/shaky line.
RETENTION_SOLID = 0.9
RETENTION_SHAKY = 0.7

STATE_NEW = "new"
STATE_SOLID = "solid"
STATE_SHAKY = "shaky"
STATE_FADING = "fading"


def retention_state(retention: float | None) -> str:
    """Bucket a retention fraction into the presentation state."""
    if retention is None:
        return STATE_NEW
    if retention >= RETENTION_SOLID:
        return STATE_SOLID
    if retention >= RETENTION_SHAKY:
        return STATE_SHAKY
    return STATE_FADING


# --------------------------------------------------------------------------- #
# The floor: append-only study events
# --------------------------------------------------------------------------- #

def record_grade_event(
    section_key: str | None,
    correct: bool,
    doc: str | None = None,
    concept_key: str | None = None,
    kind: str = "review",
) -> None:
    """Append one graded study event (a review grade — the loop's only graded activities are
    concept and skeleton recall). No-op without a section to attribute. Never raises: event
    recording must not break study flow. ``kind`` tags the activity (review | skeleton |
    resurface)."""
    if not section_key or not section_key.strip():
        return
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO study_events (section_key, concept_key, correct, ts, doc, kind) "
                "VALUES (%(sk)s,%(ck)s,%(correct)s, now(), %(doc)s,%(kind)s)",
                {"sk": section_key.strip(), "ck": concept_key or "",
                 "correct": bool(correct), "doc": doc or None, "kind": kind},
            )
    except Exception:
        pass


# Engagement kinds that are graded (feed accuracy/mastery) vs passive (read/listen — activity only).

def record_engagement(
    kind: str, section_key: str | None, doc: str | None = None, concept_key: str | None = None
) -> None:
    """Append a NON-graded engagement event (read, listen, orient …) so the dashboard
    reflects all study activity, not just graded reviews. ``correct`` is null (not an
    accuracy signal)."""
    if not section_key or not section_key.strip():
        return
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO study_events (section_key, concept_key, correct, ts, doc, kind) "
                "VALUES (%(sk)s,%(ck)s, NULL, now(), %(doc)s,%(kind)s)",
                {"sk": section_key.strip(), "ck": concept_key or "", "doc": doc or None, "kind": kind},
            )
    except Exception:
        pass


def _fetch_events(doc: str | None = None, graded_only: bool = False) -> list[dict[str, Any]]:
    # Untagged (legacy) events count in every doc scope. ``graded_only`` excludes passive
    # engagement (read/listen, correct == null) so they never dilute accuracy stats.
    # ts is returned as epoch seconds (callers use time.gmtime / arithmetic on it).
    with db() as conn:
        return conn.execute(
            "SELECT section_key, concept_key, correct, "
            "extract(epoch from ts)::float8 AS ts, doc, kind FROM study_events "
            "WHERE (%(doc)s::text IS NULL OR doc = %(doc)s OR doc IS NULL) "
            "AND (%(gradedOnly)s = false OR correct IS NOT NULL)",
            {"doc": doc, "gradedOnly": graded_only},
        ).fetchall()


def compute_activity(doc: str | None = None, now: float | None = None) -> dict[str, Any]:
    """Daily study volume (UTC) for a heatmap: the event floor PLUS the user's manual
    time blocks (one count on the block's start day) — plus CADENCE: how many of the
    last 7 days had ANY study activity (derived, never stored).

    2026-07-26 (v0.12.1, user decision): manual blocks count here and the cadence
    window counts any-activity days, not just graded ones — the card is labeled
    "activity" accordingly. Events already included passive read/listen kinds.

    Returns a sparse list of {date: 'YYYY-MM-DD', count} (days with no events
    are omitted; the frontend lays out the full calendar grid).
    """
    from app.supplemental.study.manual import fetch_manual_rows

    now = time.time() if now is None else now
    try:
        events = _fetch_events(doc)  # ALL engagement (read/listen too), not just graded
        # A year-plus of manual blocks — the heatmap grid shows ~53 weeks.
        manual = fetch_manual_rows(doc, since=now - 400 * 86400.0)
    except Exception as exc:  # noqa: BLE001 — surface as a soft error, never 500
        return {"days": [], "total": 0, "max": 0, "error": str(exc), "byKind": {}}

    counts: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    active_days: set[str] = set()
    week_floor = now - 7 * 86400.0
    for e in events:
        ts = e.get("ts")
        if not ts:
            continue
        day = time.strftime("%Y-%m-%d", time.gmtime(ts))
        counts[day] = counts.get(day, 0) + 1
        k = e.get("kind") or ("review" if e.get("correct") is not None else "other")
        by_kind[k] = by_kind.get(k, 0) + 1
        if ts >= week_floor:
            active_days.add(day)
    for m in manual:
        day = time.strftime("%Y-%m-%d", time.gmtime(float(m["start"])))
        counts[day] = counts.get(day, 0) + 1
        by_kind["manual"] = by_kind.get("manual", 0) + 1
        if float(m["start"]) >= week_floor:
            active_days.add(day)

    return {
        "days": [{"date": d, "count": c} for d, c in sorted(counts.items())],
        "total": sum(counts.values()),
        "max": max(counts.values()) if counts else 0,
        "byKind": by_kind,
        "cadence": {"activeDays": len(active_days), "windowDays": 7},
    }


def compute_forecast(doc: str | None = None, days: int = 7) -> dict[str, Any]:
    """Forgetting forecast from the spaced-review schedule: how many items are due now and
    how many fall due over the next ``days`` — so the dashboard can say 'N fade by Friday'."""
    try:
        pred, binds = review_scope(doc)
        with db() as conn:
            rows = conn.execute(
                "SELECT extract(epoch from due)::float8 AS due FROM concept_reviews "
                f"WHERE {pred}",
                binds,
            ).fetchall()
    except Exception as exc:  # noqa: BLE001
        return {"dueNow": 0, "horizon": [], "tracked": 0, "error": str(exc)}

    now = time.time()
    day = 86400.0
    due_now = 0
    buckets: dict[str, int] = {}
    for r in rows:
        due = r.get("due")
        if due is None:
            continue
        if due <= now:
            due_now += 1
        elif due <= now + days * day:
            d = time.strftime("%Y-%m-%d", time.gmtime(due))
            buckets[d] = buckets.get(d, 0) + 1
    horizon = [{"date": d, "count": c} for d, c in sorted(buckets.items())]
    return {
        "dueNow": due_now,
        "horizon": horizon,
        "soon": sum(c for _, c in buckets.items()),
        "tracked": len(rows),
    }


# --------------------------------------------------------------------------- #
# Memory state: coverage + retention (pure aggregation over FSRS rows)
# --------------------------------------------------------------------------- #

# Review-row fields srs.retrievability needs, in the state-dict shape srs speaks.
_RETENTION_COLS = (
    'SELECT key, state, stability, difficulty, step, interval, ease, '
    'extract(epoch from due)::float8 AS due, '
    'extract(epoch from last_review)::float8 AS "lastReview" '
    "FROM concept_reviews WHERE "
)


def _retention_query(doc: str | None) -> tuple[str, dict]:
    """The retention read, scoped so a re-cut version inherits the memory it earned."""
    pred, binds = review_scope(doc)
    return _RETENTION_COLS + pred, binds


def _retention_by_key(doc: str | None, now: float) -> dict[str, float]:
    """concept key → modelled recall probability right now (reviewed items only)."""
    try:
        with db() as conn:
            rows = conn.execute(*_retention_query(doc)).fetchall()
    except Exception:
        return {}
    out: dict[str, float] = {}
    for r in rows:
        ret = srs.retrievability(dict(r), now)
        if ret is not None:
            out[r["key"]] = ret
    return out


def _concepts_by_section(doc: str | None) -> dict[str, list[str]]:
    """sectionKey → its concept keys (one query — the coverage denominators)."""
    try:
        with db() as conn:
            # Coverage is per VERSION: the book's concepts for the sections this version
            # draws from, re-keyed onto the version's own outline below.
            pred, binds = concept_filter(doc)
            rows = conn.execute(
                f"SELECT section_key AS sk, key FROM ext_concepts WHERE {pred}", binds
            ).fetchall()
    except Exception:
        return {}
    by_source = version_sections_by_source(doc) if doc else {}
    rows = [
        {"sk": vk, "key": r["key"]}
        for r in rows
        for vk in (by_source.get(r["sk"], [r["sk"]]) if r.get("sk") else [])
    ]
    out: dict[str, list[str]] = {}
    for r in rows:
        if r.get("sk"):
            out.setdefault(r["sk"], []).append(r["key"])
    return out


def summarize_memory(concept_keys: list[str], retention: dict[str, float]) -> dict[str, Any]:
    """Pure: one unit's memory summary from its concept keys + the retention map.

    coverage = reviewed/total; retention = mean over reviewed items (None when nothing
    is reviewed yet); fading = reviewed items below the shaky floor."""
    total = len(concept_keys)
    revd = [retention[k] for k in concept_keys if k in retention]
    reviewed = len(revd)
    mean_ret = (sum(revd) / reviewed) if reviewed else None
    return {
        "total": total,
        "reviewed": reviewed,
        "coverage": (reviewed / total) if total else 0.0,
        "retention": mean_ret,
        "state": retention_state(mean_ret),
        "fading": sum(1 for v in revd if v < RETENTION_SHAKY),
    }


def collect_sections(
    forest: list[dict[str, Any]],
) -> tuple[dict[str, str], dict[str, str | None], dict[str, list[str]]]:
    """Walk the TOC forest → ({key: label}, {key: heading title}, {key: [child keys]}).

    Entity leaves (non-section nodes) are ignored. A section is a *leaf section*
    when its child-section list is empty.
    """
    labels: dict[str, str] = {}
    titles: dict[str, str | None] = {}
    children: dict[str, list[str]] = {}

    def visit(node: dict[str, Any], parent_key: str | None) -> None:
        key = node.get("sectionKey")
        if node.get("isSection") and key:
            labels[key] = node.get("label") or key
            titles[key] = node.get("title")
            children.setdefault(key, [])
            if parent_key:
                children[parent_key].append(key)
            parent_key = key
        for child in node.get("children", []) or []:
            visit(child, parent_key)

    for root in forest:
        visit(root, None)
    return labels, titles, children


def descendant_leaves(
    key: str, children: dict[str, list[str]], _seen: frozenset[str] = frozenset()
) -> list[str]:
    kids = children.get(key) or []
    # Guard against cyclic has_subsection edges: a node reached on its own path is
    # treated as a leaf so the walk terminates instead of recursing forever.
    if not kids or key in _seen:
        return [key]
    next_seen = _seen | {key}
    out: list[str] = []
    for k in kids:
        out.extend(descendant_leaves(k, children, next_seen))
    return out


def compute_mastery(now: float | None = None, doc: str | None = None) -> dict[str, Any]:
    """Per-section memory state: {coverage, retention, state, total, reviewed, fading}
    for every TOC section, with internal sections summarizing their descendant leaves'
    concepts. ``overall`` is the whole course's summary. Needs only ext_concepts +
    concept_reviews — the event floor doesn't participate (retention already encodes
    time and outcomes through FSRS)."""
    now = time.time() if now is None else now

    forest, _sections, err = get_toc_tree(doc)
    if err:
        return {"bySection": {}, "overall": summarize_memory([], {}), "error": err}

    labels, titles, children = collect_sections(forest)
    section_concepts = _concepts_by_section(doc)
    retention = _retention_by_key(doc, now)

    by_section: dict[str, dict[str, Any]] = {}
    for k in labels:
        leaves = descendant_leaves(k, children)
        keys: list[str] = []
        for lk in leaves:
            keys.extend(section_concepts.get(lk, []))
        by_section[k] = summarize_memory(keys, retention)

    all_keys = [key for keys in section_concepts.values() for key in keys]
    overall = summarize_memory(all_keys, retention)

    # The map's attention hook: studied sections with the weakest retention first.
    studied = [
        {"sectionKey": k, "label": labels[k], "title": titles.get(k), **by_section[k]}
        for k in labels
        if not children.get(k) and by_section[k]["reviewed"] > 0
    ]
    studied.sort(key=lambda s: (s["retention"] if s["retention"] is not None else 1.0, s["sectionKey"]))

    return {
        "bySection": by_section,
        "overall": overall,
        "fading": [s for s in studied if s["state"] == STATE_FADING][:5],
        "thresholds": {"solid": RETENTION_SOLID, "shaky": RETENTION_SHAKY},
    }


def compute_concept_mastery(now: float | None = None, doc: str | None = None) -> dict[str, Any]:
    """Per-concept memory state + schedule, joined with the event floor's per-concept
    detail (attempts / correct / lastSeen — history, not part of the state math)."""
    now = time.time() if now is None else now
    try:
        with db() as conn:
            _pred, _binds = concept_filter(doc)
            concepts = conn.execute(
                'SELECT key, name, section_key AS "sectionKey" FROM ext_concepts '
                f"WHERE {_pred}",
                _binds,
            ).fetchall()
            reviews: dict[str, dict[str, Any]] = {}
            for r in conn.execute(*_retention_query(doc)).fetchall():
                reviews[r["key"]] = dict(r)
        events = _fetch_events(doc, graded_only=True)
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {"byConcept": {}, "counts": {}, "error": str(exc)}

    events_by_concept: dict[str, list[dict[str, Any]]] = {}
    for e in events:
        ck = (e.get("concept_key") or "").strip()
        if ck:
            events_by_concept.setdefault(ck, []).append(e)

    by_concept: dict[str, dict[str, Any]] = {}
    counts = {STATE_NEW: 0, STATE_SOLID: 0, STATE_SHAKY: 0, STATE_FADING: 0, "total": 0}
    for c in concepts:
        ck = c["key"]
        rv = reviews.get(ck)
        ret = srs.retrievability(rv, now) if rv else None
        state = retention_state(ret)
        evs = events_by_concept.get(ck, [])
        attempts = len(evs)
        correct = sum(1 for e in evs if e.get("correct"))
        by_concept[ck] = {
            "name": c["name"],
            "sectionKey": c["sectionKey"],
            "retention": ret,
            "state": state,
            "due": (rv or {}).get("due"),
            "scheduleState": (rv or {}).get("state", "new"),
            "attempts": attempts,
            "accuracy": (correct / attempts) if attempts else None,
            "lastSeen": max((e["ts"] for e in evs), default=None),
        }
        counts[state] += 1
        counts["total"] += 1

    reviewed_ret = [v["retention"] for v in by_concept.values() if v["retention"] is not None]
    overall = (sum(reviewed_ret) / len(reviewed_ret)) if reviewed_ret else None

    return {
        "byConcept": by_concept,
        "overall": overall,
        "counts": counts,
        "thresholds": {"solid": RETENTION_SOLID, "shaky": RETENTION_SHAKY},
    }
