"""Persisted study events + view-time mastery computation.

Mastery per section = coverage x accuracy x decay:
  - coverage: distinct quizzed content-triples / total content triples in the section
  - accuracy: Beta-Binomial posterior mean of quiz correctness (quizzes only)
  - decay:    exp(-dt / tau), dt = days since last quiz, tau = MASTERY_TAU_DAYS

Only raw events persist; mastery is recomputed on read because decay is
time-dependent. Internal sections roll up as a triple-count-weighted average
over their descendant leaf sections.
"""

from __future__ import annotations

import math
import os
import time
from typing import Any

from arango.database import StandardDatabase

from app.arango_learn import content_triples_for_section, triple_id
from app.arango_tree import connect_arango, get_toc_tree

EVENTS_COLLECTION = "study_events"


def _alpha() -> float:
    return float(os.environ.get("MASTERY_ALPHA", "1"))


def _beta() -> float:
    return float(os.environ.get("MASTERY_BETA", "1"))


def _tau_days() -> float:
    return float(os.environ.get("MASTERY_TAU_DAYS", "14"))


def _retention_k() -> float:
    """Decay constant so retrievability hits the retention target at the due date:
    exp(-interval / tau) = R  ⇒  tau = interval / ln(1/R), i.e. tau = k · interval."""
    r = float(os.environ.get("MASTERY_RETENTION", "0.9"))
    r = min(0.99, max(0.5, r))
    return 1.0 / math.log(1.0 / r)


def _stability_tau(interval_days: float | None, default_tau: float) -> float:
    """Per-unit decay time-constant from its SM-2 interval (retrievability ← stability):
    a fragile concept (short interval) fades fast, a well-spaced one slowly. Falls back to
    the global ``default_tau`` for units never put through spaced review (interval ≤ 0)."""
    if interval_days and interval_days > 0:
        return max(1.0, _retention_k() * float(interval_days))
    return default_tau


# --------------------------------------------------------------------------- #
# The floor: append-only study events
# --------------------------------------------------------------------------- #

def _ensure_collection(db: StandardDatabase):
    if not db.has_collection(EVENTS_COLLECTION):
        db.create_collection(EVENTS_COLLECTION)
    return db.collection(EVENTS_COLLECTION)


def record_quiz_event(
    section_key: str | None,
    tid: str | None,
    correct: bool,
    doc: str | None = None,
    stem: str | None = None,
    expected: str | None = None,
    concept_key: str | None = None,
    kind: str = "quiz",
    confidence: str | None = None,
) -> None:
    """Append one graded study event (quiz answer, MCQ, or recall grade). No-op for whole-graph
    quizzes (no section to attribute). Never raises: event recording must not break study flow.
    ``concept_key`` is set for concept-based study; legacy triple events leave it null.
    ``kind`` tags the engagement type (quiz | review | exam | recall …); ``confidence`` is the
    learner's pre-reveal self-rating (guess | shaky | confident) for calibration."""
    if not section_key or not section_key.strip():
        return
    try:
        db = connect_arango()
        coll = _ensure_collection(db)
        coll.insert(
            {
                "section_key": section_key.strip(),
                "triple_id": tid or "",
                "concept_key": concept_key or "",
                "correct": bool(correct),
                "ts": time.time(),
                "doc": doc or None,
                "stem": stem or None,
                "expected": expected or None,
                "kind": kind,
                "confidence": confidence or None,
            }
        )
    except Exception:
        pass


def compute_calibration(doc: str | None = None) -> dict[str, Any]:
    """Calibration: for each pre-reveal confidence level, what fraction were actually correct?
    Well-calibrated = 'confident' high, 'guess' low. Surfaces overconfidence (the illusion of
    competence)."""
    try:
        db = connect_arango()
        if not db.has_collection(EVENTS_COLLECTION):
            return {"buckets": [], "total": 0}
        rows = list(
            db.aql.execute(
                "FOR e IN study_events FILTER (@d == null OR e.doc == @d OR e.doc == null) "
                "AND e.confidence != null AND e.correct != null "
                "RETURN { confidence: e.confidence, correct: e.correct }",
                bind_vars={"d": doc},
            )
        )
    except Exception as exc:  # noqa: BLE001
        return {"buckets": [], "total": 0, "error": str(exc)}

    order = ["guess", "shaky", "confident"]
    agg: dict[str, list[int]] = {c: [0, 0] for c in order}
    for r in rows:
        c = r.get("confidence")
        if c in agg:
            agg[c][0] += 1
            if r.get("correct"):
                agg[c][1] += 1
    buckets = [
        {"confidence": c, "count": n, "correct": ok, "accuracy": round(100 * ok / n) if n else 0}
        for c in order
        for (n, ok) in [agg[c]]
        if n > 0
    ]
    return {"buckets": buckets, "total": len(rows)}


# Engagement kinds that are graded (feed accuracy/mastery) vs passive (read/listen — activity only).
GRADED_KINDS = frozenset({"quiz", "review", "exam", "recall"})


def record_engagement(
    kind: str, section_key: str | None, doc: str | None = None, concept_key: str | None = None
) -> None:
    """Append a NON-graded engagement event (read, listen, orient, brain-dump …) so the dashboard
    reflects all study activity, not just quizzes. ``correct`` is null (not an accuracy signal)."""
    if not section_key or not section_key.strip():
        return
    try:
        db = connect_arango()
        coll = _ensure_collection(db)
        coll.insert(
            {
                "section_key": section_key.strip(),
                "concept_key": concept_key or "",
                "correct": None,
                "ts": time.time(),
                "doc": doc or None,
                "kind": kind,
            }
        )
    except Exception:
        pass


def _fetch_events(
    db: StandardDatabase, doc: str | None = None, graded_only: bool = False
) -> list[dict[str, Any]]:
    if not db.has_collection(EVENTS_COLLECTION):
        return []
    # Untagged (legacy) events count in every doc scope. ``graded_only`` excludes passive
    # engagement (read/listen, correct == null) so they never dilute mastery accuracy.
    aql = """
    FOR e IN study_events
      FILTER @doc == null OR e.doc == @doc OR e.doc == null
      FILTER @gradedOnly == false OR e.correct != null
      RETURN {
        section_key: e.section_key,
        triple_id: e.triple_id,
        concept_key: e.concept_key,
        correct: e.correct,
        ts: e.ts,
        doc: e.doc,
        stem: e.stem,
        expected: e.expected,
        kind: e.kind
      }
    """
    return list(db.aql.execute(aql, bind_vars={"doc": doc, "gradedOnly": graded_only}))


def compute_activity(doc: str | None = None) -> dict[str, Any]:
    """Daily study volume (UTC) from the event floor, for a heatmap.

    Returns a sparse list of {date: 'YYYY-MM-DD', count} (days with no quizzes
    are omitted; the frontend lays out the full calendar grid).
    """
    try:
        db = connect_arango()
        events = _fetch_events(db, doc)  # ALL engagement (read/listen too), not just graded
    except Exception as exc:  # noqa: BLE001 — surface as a soft error, never 500
        return {"days": [], "total": 0, "max": 0, "error": str(exc), "byKind": {}}

    counts: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    for e in events:
        ts = e.get("ts")
        if not ts:
            continue
        day = time.strftime("%Y-%m-%d", time.gmtime(ts))
        counts[day] = counts.get(day, 0) + 1
        k = e.get("kind") or ("quiz" if e.get("correct") is not None else "other")
        by_kind[k] = by_kind.get(k, 0) + 1

    return {
        "days": [{"date": d, "count": c} for d, c in sorted(counts.items())],
        "total": sum(counts.values()),
        "max": max(counts.values()) if counts else 0,
        "byKind": by_kind,
    }


def compute_forecast(doc: str | None = None, days: int = 7) -> dict[str, Any]:
    """Forgetting forecast from the spaced-review schedule: how many concepts are due now and
    how many fall due over the next ``days`` — so the dashboard can say 'N fade by Friday'."""
    try:
        db = connect_arango()
        if not db.has_collection("concept_reviews"):
            return {"dueNow": 0, "horizon": [], "tracked": 0}
        rows = list(
            db.aql.execute(
                "FOR r IN concept_reviews FILTER @doc == null OR r.docId == @doc "
                "RETURN { due: r.due }",
                bind_vars={"doc": doc},
            )
        )
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
# Pure math (no DB) — unit-testable
# --------------------------------------------------------------------------- #

def compute_leaf_mastery(
    events: list[dict[str, Any]],
    content_ids: set[str],
    total: int,
    now: float,
    alpha: float,
    beta: float,
    tau_days: float,
    id_field: str = "triple_id",
) -> dict[str, Any]:
    """Mastery for one leaf section from its own events.

    ``events`` are this section's quiz/recall events; ``content_ids`` the ids of its content
    units; ``total`` their count (coverage denominator). ``id_field`` selects which event field
    identifies the studied unit — ``triple_id`` for the legacy KG path, ``concept_key`` for the
    concept path — so the same coverage×accuracy×decay math serves both.
    """
    if not events:
        return {
            "mastery": 0.0,
            "coverage": 0.0,
            "accuracy": 0.0,
            "decay": 0.0,
            "attempts": 0,
            "lastSeen": None,
        }
    attempts = len(events)
    correct = sum(1 for e in events if e.get("correct"))
    accuracy = (correct + alpha) / (attempts + alpha + beta)

    tested = {e[id_field] for e in events if e.get(id_field)}
    covered = len(tested & content_ids)
    coverage = (covered / total) if total > 0 else 0.0

    last_seen = max(e["ts"] for e in events)
    dt_days = max(0.0, (now - last_seen) / 86400.0)
    decay = math.exp(-dt_days / tau_days) if tau_days > 0 else 1.0

    return {
        "mastery": coverage * accuracy * decay,
        "coverage": coverage,
        "accuracy": accuracy,
        "decay": decay,
        "attempts": attempts,
        "lastSeen": last_seen,
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


def _weighted_average(pairs: list[tuple[float, float]]) -> float:
    num = sum(value * weight for value, weight in pairs)
    den = sum(weight for _value, weight in pairs)
    return (num / den) if den > 0 else 0.0


# --------------------------------------------------------------------------- #
# Concept coverage (replaces triple coverage for concept-extracted docs)
# --------------------------------------------------------------------------- #

def _doc_has_concepts(db: StandardDatabase, doc: str | None) -> bool:
    try:
        if not db.has_collection("concepts"):
            return False
        rows = list(
            db.aql.execute(
                "FOR c IN concepts FILTER @doc == null OR c.docId == @doc LIMIT 1 RETURN 1",
                bind_vars={"doc": doc},
            )
        )
        return bool(rows)
    except Exception:
        return False


def _section_concept_ids(db: StandardDatabase, section_key: str, doc: str | None) -> set[str]:
    """The concept _keys taught in a section — the per-concept coverage denominator."""
    try:
        rows = db.aql.execute(
            "FOR c IN concepts FILTER c.sectionKey == @s AND (@doc == null OR c.docId == @doc) "
            "RETURN c._key",
            bind_vars={"s": section_key, "doc": doc},
        )
        return set(rows)
    except Exception:
        return set()


def _concept_intervals(db: StandardDatabase, doc: str | None) -> dict[str, float]:
    """concept _key → current SM-2 interval in days, for retrievability-based decay."""
    try:
        if not db.has_collection("concept_reviews"):
            return {}
        rows = db.aql.execute(
            "FOR r IN concept_reviews FILTER @doc == null OR r.docId == @doc "
            "RETURN {key: r._key, interval: r.interval}",
            bind_vars={"doc": doc},
        )
        return {r["key"]: float(r.get("interval") or 0.0) for r in rows}
    except Exception:
        return {}


def _section_tau(content_ids: set[str], intervals: dict[str, float], default_tau: float) -> float:
    """A leaf section's effective decay τ = stability from the mean SM-2 interval of its
    spaced-reviewed concepts (falls back to the global τ when none have been reviewed)."""
    revd = [intervals[c] for c in content_ids if intervals.get(c, 0.0) > 0]
    eff = (sum(revd) / len(revd)) if revd else None
    return _stability_tau(eff, default_tau)


# --------------------------------------------------------------------------- #
# Top-level: DB-backed assembly
# --------------------------------------------------------------------------- #

def compute_mastery(now: float | None = None, doc: str | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    alpha, beta, tau = _alpha(), _beta(), _tau_days()

    forest, _edges, err, _mentions = get_toc_tree(doc)
    if err:
        return {"bySection": {}, "overall": 0.0, "weakest": [], "error": err}

    labels, titles, children = collect_sections(forest)
    leaf_keys = [k for k in labels if not children.get(k)]

    db = connect_arango()
    events = _fetch_events(db, doc, graded_only=True)
    events_by_section: dict[str, list[dict[str, Any]]] = {}
    for e in events:
        sk = (e.get("section_key") or "").strip()
        if sk:
            events_by_section.setdefault(sk, []).append(e)

    # Concept docs cover sections by concepts; legacy KG docs by content triples.
    use_concepts = _doc_has_concepts(db, doc)
    intervals = _concept_intervals(db, doc) if use_concepts else {}
    leaf_stats: dict[str, dict[str, Any]] = {}
    weights: dict[str, int] = {}
    for k in leaf_keys:
        if use_concepts:
            content_ids = _section_concept_ids(db, k, doc)
            id_field = "concept_key"
            tau_eff = _section_tau(content_ids, intervals, tau)
        else:
            content_ids = {triple_id(t) for t in content_triples_for_section(k, doc=doc)}
            id_field = "triple_id"
            tau_eff = tau
        total = len(content_ids)
        weights[k] = total
        leaf_stats[k] = compute_leaf_mastery(
            events_by_section.get(k, []), content_ids, total, now, alpha, beta, tau_eff, id_field=id_field
        )

    by_section: dict[str, dict[str, Any]] = {}
    for k in labels:
        if children.get(k):  # internal section → rollup over descendant leaves
            leaves = descendant_leaves(k, children)
            mastery = _weighted_average(
                [(leaf_stats[lk]["mastery"], weights[lk]) for lk in leaves if lk in leaf_stats]
            )
            attempts = sum(leaf_stats[lk]["attempts"] for lk in leaves if lk in leaf_stats)
            seen = [leaf_stats[lk]["lastSeen"] for lk in leaves if leaf_stats.get(lk, {}).get("lastSeen")]
            by_section[k] = {
                "mastery": mastery,
                "attempts": attempts,
                "lastSeen": max(seen) if seen else None,
                "isRollup": True,
            }
        else:  # leaf section → its own stats
            st = leaf_stats.get(k, {})
            by_section[k] = {
                "mastery": st.get("mastery", 0.0),
                "coverage": st.get("coverage", 0.0),
                "accuracy": st.get("accuracy", 0.0),
                "attempts": st.get("attempts", 0),
                "lastSeen": st.get("lastSeen"),
            }

    overall = _weighted_average([(leaf_stats[k]["mastery"], weights[k]) for k in leaf_keys])

    studyable = [k for k in leaf_keys if weights.get(k, 0) > 0]
    studyable.sort(key=lambda k: (leaf_stats[k]["mastery"], k))
    weakest = [
        {
            "sectionKey": k,
            "label": labels[k],
            "title": titles.get(k),
            "mastery": leaf_stats[k]["mastery"],
        }
        for k in studyable[:3]
    ]

    return {
        "bySection": by_section,
        "overall": overall,
        "weakest": weakest,
        "params": {"alpha": alpha, "beta": beta, "tauDays": tau},
    }


def compute_concept_mastery(now: float | None = None, doc: str | None = None) -> dict[str, Any]:
    """Per-concept mastery + SR schedule state. Joins the study-event floor (accuracy/decay/
    attempts, keyed by concept_key) with concept_reviews (due/state). One concept = one unit, so
    coverage is 1 once it's been studied — mastery is then accuracy×decay."""
    now = time.time() if now is None else now
    alpha, beta, tau = _alpha(), _beta(), _tau_days()
    try:
        db = connect_arango()
        if not db.has_collection("concepts"):
            return {"byConcept": {}, "overall": 0.0}
        concepts = list(
            db.aql.execute(
                "FOR c IN concepts FILTER @doc == null OR c.docId == @doc "
                "RETURN {key: c._key, name: c.name, sectionKey: c.sectionKey}",
                bind_vars={"doc": doc},
            )
        )
        events = _fetch_events(db, doc, graded_only=True)
        reviews: dict[str, dict[str, Any]] = {}
        if db.has_collection("concept_reviews"):
            for r in db.aql.execute(
                "FOR r IN concept_reviews FILTER @doc == null OR r.docId == @doc "
                "RETURN {key: r._key, due: r.due, state: r.state, interval: r.interval}",
                bind_vars={"doc": doc},
            ):
                reviews[r["key"]] = r
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {"byConcept": {}, "overall": 0.0, "error": str(exc)}

    events_by_concept: dict[str, list[dict[str, Any]]] = {}
    for e in events:
        ck = (e.get("concept_key") or "").strip()
        if ck:
            events_by_concept.setdefault(ck, []).append(e)

    by_concept: dict[str, dict[str, Any]] = {}
    masteries: list[float] = []
    for c in concepts:
        ck = c["key"]
        rv = reviews.get(ck, {})
        # Retrievability from this concept's own spaced-rep stability, not a global τ.
        tau_eff = _stability_tau(rv.get("interval"), tau)
        st = compute_leaf_mastery(
            events_by_concept.get(ck, []), {ck}, 1, now, alpha, beta, tau_eff, id_field="concept_key"
        )
        by_concept[ck] = {
            "name": c["name"],
            "sectionKey": c["sectionKey"],
            "mastery": st["mastery"],
            "accuracy": st["accuracy"],
            "attempts": st["attempts"],
            "lastSeen": st["lastSeen"],
            "due": rv.get("due"),
            "state": rv.get("state", "new"),
        }
        masteries.append(st["mastery"])

    overall = (sum(masteries) / len(masteries)) if masteries else 0.0

    # Prerequisite gating (Knowledge Space Theory): a not-yet-mastered concept is "ready" when
    # all its prerequisites are mastered, else "locked" (blockedBy = the unmet ones). Uses the
    # concept_prereq DAG; an edge (from -> to) means `from` requires `to`.
    mastered_th = float(os.environ.get("MASTERY_MASTERED", "0.7"))
    prereqs: dict[str, list[str]] = {}
    try:
        if db.has_collection("concept_prereq"):
            for e in db.aql.execute(
                "FOR e IN concept_prereq FILTER @doc == null OR e.docId == @doc "
                "RETURN {f: e._from, t: e._to}",
                bind_vars={"doc": doc},
            ):
                prereqs.setdefault(str(e["f"]).split("/")[-1], []).append(str(e["t"]).split("/")[-1])
    except Exception:  # noqa: BLE001 — gating is supplementary
        prereqs = {}

    mastered = {ck for ck, v in by_concept.items() if v["mastery"] >= mastered_th}
    counts = {"mastered": 0, "ready": 0, "locked": 0, "total": len(by_concept)}
    for ck, v in by_concept.items():
        if ck in mastered:
            gate, blocked = "mastered", []
        else:
            unmet = [p for p in prereqs.get(ck, []) if p not in mastered]
            if unmet:
                gate = "locked"
                blocked = [by_concept[p]["name"] for p in unmet if p in by_concept]
            else:
                gate, blocked = "ready", []
        v["gate"] = gate
        v["blockedBy"] = blocked
        counts[gate] = counts.get(gate, 0) + 1

    return {
        "byConcept": by_concept,
        "overall": overall,
        "counts": counts,
        "masteredThreshold": mastered_th,
    }
