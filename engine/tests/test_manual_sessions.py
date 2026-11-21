"""Manual study-time blocks (TASK-22): shaping, validation, and the merge rule.

Pure tests — the DB-backed CRUD roundtrip lives in test_manual_sessions_pg.py.
The contract under guard: manual blocks are session-SHAPED (so the frontend list
renders one type), merge newest-first with derived sessions, and count toward
totalMinutes — while never entering the event floor.
"""

from __future__ import annotations

from app.supplemental.study.manual import shape_manual_row, validate_block
from app.supplemental.study.sessions import cluster_events, merge_sessions


def test_shape_manual_row_is_session_shaped():
    s = shape_manual_row(
        {"key": "m1", "doc": "doc-a", "note": "  ", "start": 1000.0, "end": 1000.0 + 90 * 60}
    )
    assert s["kind"] == "manual" and s["manual"] is True and s["key"] == "m1"
    assert s["durationMin"] == 90.0
    assert s["kinds"] == {"manual": 1}
    assert s["docs"] == ["doc-a"]
    assert s["graded"] == 0 and s["events"] == 0
    # blank note normalizes to None so the UI doesn't render an empty line
    assert s["note"] is None


def test_validate_block_rejects_impossible_spans():
    assert validate_block(0, 0) is not None  # missing
    assert validate_block(2000, 2000) is not None  # zero duration
    assert validate_block(2000, 1000) is not None  # end before start
    assert validate_block(1000, 1000 + 25 * 3600) is not None  # > 24h
    assert validate_block(1000, 1000 + 3600) is None  # a normal hour


def test_compute_activity_counts_manual_blocks(monkeypatch):
    """v0.12.1 (user decision): manual blocks light the heatmap (+1 on their start day,
    byKind['manual']) and any-activity days drive the cadence window — which no longer
    requires a GRADED event."""
    import app.supplemental.study.manual as manual_mod
    import app.supplemental.study.mastery as mastery_mod

    now = 1_800_000_000.0
    day = 86_400.0
    # One graded event 10 days ago (outside the 7-day window), one manual block yesterday.
    monkeypatch.setattr(
        mastery_mod, "_fetch_events",
        lambda doc: [{"ts": now - 10 * day, "kind": "review", "correct": True}],
    )
    monkeypatch.setattr(
        manual_mod, "fetch_manual_rows",
        lambda doc, since: [
            {"key": "m1", "doc": "d", "note": None, "start": now - 1 * day, "end": now - 1 * day + 3600}
        ],
    )

    act = mastery_mod.compute_activity(doc=None, now=now)
    assert act["total"] == 2  # event day + manual day
    assert act["byKind"]["manual"] == 1
    assert act["cadence"] == {"activeDays": 1, "windowDays": 7}  # manual day counts, old event doesn't


def test_merge_sessions_orders_newest_first_across_layers():
    derived = cluster_events(
        [
            {"ts": 1_000.0, "kind": "review", "doc": "d", "sectionKey": "toc:1", "correct": True},
            {"ts": 9_000_000.0, "kind": "read", "doc": "d", "sectionKey": "toc:2", "correct": None},
        ]
    )
    manual = [
        shape_manual_row({"key": "m1", "doc": "d", "note": None, "start": 5_000_000.0, "end": 5_003_600.0})
    ]
    merged = merge_sessions(derived, manual)
    starts = [s["start"] for s in merged]
    assert starts == sorted(starts, reverse=True)  # newest first, interleaved
    assert [s.get("kind") for s in merged] == ["read", "manual", "review"]
    # totals include the manual block — same summation fetch_sessions performs
    assert round(sum(s["durationMin"] for s in merged), 1) == round(
        sum(s["durationMin"] for s in derived) + 60.0, 1
    )
