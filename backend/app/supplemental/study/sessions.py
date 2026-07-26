"""Working sessions — derived, never stored.

A session is a run of study events whose gaps stay under ``GAP_SECONDS`` (~25 min). Sessions
are a VIEW over the append-only ``study_events`` floor: nothing is written, so the whole
history sessionizes retroactively and the definition can evolve without a migration.
``cluster_events`` is pure (unit-testable); ``fetch_sessions`` is the DB-backed assembly.
"""

from __future__ import annotations

import time
from typing import Any

from app.gateways import db

GAP_SECONDS = 25 * 60.0

# Passive kinds never define a session's identity when graded work is present.
_PASSIVE = {"read", "listen"}


def _dominant_kind(kinds: dict[str, int]) -> str:
    """A session is what you mostly did in it; graded work outweighs passive kinds
    (10 quiz answers + 12 read pings is a quiz session, not a reading one)."""
    if not kinds:
        return "other"
    active = {k: n for k, n in kinds.items() if k not in _PASSIVE}
    pool = active or kinds
    return max(pool.items(), key=lambda kv: kv[1])[0]


def cluster_events(events: list[dict[str, Any]], gap: float = GAP_SECONDS) -> list[dict[str, Any]]:
    """Group events (any order) into sessions split at gaps > ``gap`` seconds.
    Returns sessions newest-first; each carries duration, per-kind counts, the dominant
    kind, the courses and scopes touched, and graded accuracy."""
    timed = sorted((e for e in events if e.get("ts")), key=lambda e: float(e["ts"]))
    sessions: list[dict[str, Any]] = []
    run: list[dict[str, Any]] = []

    def flush() -> None:
        if not run:
            return
        start, end = float(run[0]["ts"]), float(run[-1]["ts"])
        kinds: dict[str, int] = {}
        docs: list[str] = []
        scopes: list[str] = []
        graded = correct = 0
        for e in run:
            k = e.get("kind") or ("review" if e.get("correct") is not None else "other")
            kinds[k] = kinds.get(k, 0) + 1
            d = e.get("doc")
            if d and d not in docs:
                docs.append(d)
            s = e.get("sectionKey")
            if s and s not in scopes:
                scopes.append(s)
            if e.get("correct") is not None:
                graded += 1
                correct += 1 if e["correct"] else 0
        sessions.append(
            {
                "start": start,
                "end": end,
                "durationMin": round((end - start) / 60.0, 1),
                "events": len(run),
                "kinds": kinds,
                "kind": _dominant_kind(kinds),
                "docs": docs,
                "scopes": scopes[:12],
                "graded": graded,
                "correct": correct,
            }
        )

    for e in timed:
        if run and float(e["ts"]) - float(run[-1]["ts"]) > gap:
            flush()
            run = []
        run.append(e)
    flush()
    sessions.reverse()
    return sessions


def merge_sessions(
    derived: list[dict[str, Any]], manual: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Interleave derived sessions with manual blocks, newest-first — pure, so the
    ordering rule is testable without a DB."""
    return sorted(derived + manual, key=lambda s: float(s["start"]), reverse=True)


def fetch_sessions(doc: str | None = None, days: int = 90) -> dict[str, Any]:
    """Sessionize the last ``days`` of study events (optionally one course), merge in the
    user's manual time blocks (manual.py — the one stored layer), with course titles
    resolved and a summary strip (count / minutes / per-kind event totals)."""
    from app.supplemental.study.manual import fetch_manual_rows

    since = time.time() - max(1, days) * 86400.0
    try:
        with db() as conn:
            rows = conn.execute(
                'SELECT extract(epoch from ts)::float8 AS ts, kind, doc, '
                'section_key AS "sectionKey", correct FROM study_events '
                "WHERE ts >= to_timestamp(%(since)s) "
                "AND (%(doc)s::text IS NULL OR doc = %(doc)s) ORDER BY ts",
                {"since": since, "doc": doc},
            ).fetchall()
            titles = {
                r["k"]: r["t"]
                for r in conn.execute("SELECT key AS k, title AS t FROM raw_documents").fetchall()
            }
        manual = fetch_manual_rows(doc, since)
    except Exception as exc:  # noqa: BLE001 — soft error, never 500
        return {"sessions": [], "summary": {}, "error": str(exc)}

    sessions = merge_sessions(cluster_events(rows), manual)
    by_kind: dict[str, int] = {}
    for s in sessions:
        s["courses"] = [{"doc": d, "title": titles.get(d) or d} for d in s.pop("docs")]
        for k, n in s["kinds"].items():
            by_kind[k] = by_kind.get(k, 0) + n
    return {
        "sessions": sessions,
        "summary": {
            "count": len(sessions),
            "totalMinutes": round(sum(s["durationMin"] for s in sessions), 1),
            "byKind": by_kind,
            "days": days,
        },
    }
