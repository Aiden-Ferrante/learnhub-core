"""Manual study-time blocks — the user's corrections layer over the derived sessions.

Sessions remain a pure view over the append-only ``study_events`` floor (sessions.py);
manual blocks are the ONE stored exception: explicit intervals the user logs, edits,
and deletes. ``fetch_sessions`` merges them into the session list and time-studied
totals at read time. They deliberately do NOT touch the event floor, the activity
heatmap, or the cadence chip — those stay records of what actually happened.
"""

from __future__ import annotations

from typing import Any

from app.gateways import db

# Sanity bound: a single manual block longer than this is almost certainly a typo.
MAX_BLOCK_SECONDS = 24 * 3600.0


def shape_manual_row(row: dict[str, Any]) -> dict[str, Any]:
    """A manual_sessions row → the exact session dict shape cluster_events emits,
    plus ``manual``/``key``/``note`` so the UI can offer edit/delete."""
    start, end = float(row["start"]), float(row["end"])
    return {
        "start": start,
        "end": end,
        "durationMin": round((end - start) / 60.0, 1),
        "events": 0,
        "kinds": {"manual": 1},
        "kind": "manual",
        "docs": [row["doc"]],
        "scopes": [],
        "graded": 0,
        "correct": 0,
        "manual": True,
        "key": row["key"],
        "note": (row.get("note") or "").strip() or None,
    }


def validate_block(start: float, end: float) -> str | None:
    """Reject impossible blocks. Returns an error string, or None when valid."""
    if not (start > 0 and end > 0):
        return "start and end are required"
    if end <= start:
        return "end must be after start"
    if end - start > MAX_BLOCK_SECONDS:
        return "a single block cannot exceed 24 hours"
    return None


def upsert_manual_session(
    doc: str,
    start: float,
    end: float,
    note: str | None = None,
    key: str | None = None,
) -> dict[str, Any]:
    """Create (no key) or update (key) a manual block. Timestamps are epoch seconds."""
    if not doc:
        return {"error": "doc is required", "status": 400}
    err = validate_block(start, end)
    if err:
        return {"error": err, "status": 400}
    try:
        with db() as conn:
            if key:
                row = conn.execute(
                    "UPDATE manual_sessions SET doc=%(d)s, start_ts=to_timestamp(%(s)s), "
                    "end_ts=to_timestamp(%(e)s), note=%(n)s WHERE key=%(k)s RETURNING key",
                    {"d": doc, "s": start, "e": end, "n": note, "k": key},
                ).fetchone()
                if not row:
                    return {"error": "manual session not found", "status": 404}
            else:
                row = conn.execute(
                    "INSERT INTO manual_sessions (doc, start_ts, end_ts, note) "
                    "VALUES (%(d)s, to_timestamp(%(s)s), to_timestamp(%(e)s), %(n)s) RETURNING key",
                    {"d": doc, "s": start, "e": end, "n": note},
                ).fetchone()
        return {"key": row["key"], "ok": True}
    except Exception as exc:  # noqa: BLE001 — FK violation (unknown doc) lands here too
        return {"error": str(exc), "status": 400}


def delete_manual_session(key: str) -> dict[str, Any]:
    if not key:
        return {"error": "key is required", "status": 400}
    try:
        with db() as conn:
            row = conn.execute(
                "DELETE FROM manual_sessions WHERE key=%(k)s RETURNING key", {"k": key}
            ).fetchone()
        if not row:
            return {"error": "manual session not found", "status": 404}
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "status": 503}


def fetch_manual_rows(doc: str | None, since: float) -> list[dict[str, Any]]:
    """Manual blocks overlapping the window, session-shaped, for fetch_sessions to merge."""
    with db() as conn:
        rows = conn.execute(
            "SELECT key, doc, note, extract(epoch from start_ts)::float8 AS start, "
            "extract(epoch from end_ts)::float8 AS end FROM manual_sessions "
            "WHERE end_ts >= to_timestamp(%(since)s) "
            "AND (%(doc)s::text IS NULL OR doc = %(doc)s)",
            {"since": since, "doc": doc},
        ).fetchall()
    return [shape_manual_row(r) for r in rows]
