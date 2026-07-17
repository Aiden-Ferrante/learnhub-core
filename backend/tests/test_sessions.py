"""Unit tests for working-session clustering (pure, no DB)."""

from app.supplemental.study.sessions import GAP_SECONDS, cluster_events

T0 = 1_000_000.0
MIN = 60.0


def ev(ts, kind="read", doc="d1", section="toc:1", correct=None):
    return {"ts": ts, "kind": kind, "doc": doc, "sectionKey": section, "correct": correct}


def test_gap_splits_sessions():
    events = [ev(T0), ev(T0 + 5 * MIN), ev(T0 + GAP_SECONDS + 6 * MIN)]
    sessions = cluster_events(events)
    assert len(sessions) == 2
    # Newest first.
    assert sessions[0]["start"] > sessions[1]["start"]
    assert sessions[1]["events"] == 2
    assert sessions[1]["durationMin"] == 5.0


def test_unsorted_input_and_single_event_session():
    sessions = cluster_events([ev(T0 + 10 * MIN), ev(T0)])
    assert len(sessions) == 1
    assert sessions[0]["events"] == 2
    lone = cluster_events([ev(T0)])
    assert lone[0]["durationMin"] == 0.0


def test_dominant_kind_prefers_graded_over_passive():
    # 3 quiz answers inside a longer reading stretch → a quiz session.
    events = [ev(T0), ev(T0 + MIN), ev(T0 + 2 * MIN), ev(T0 + 3 * MIN)]
    events += [ev(T0 + 4 * MIN + i, kind="quiz", correct=True) for i in range(3)]
    (s,) = cluster_events(events)
    assert s["kind"] == "quiz"
    assert s["kinds"] == {"read": 4, "quiz": 3}
    # Pure reading stays a reading session.
    (r,) = cluster_events([ev(T0), ev(T0 + MIN)])
    assert r["kind"] == "read"


def test_accuracy_and_touched_docs_scopes():
    events = [
        ev(T0, kind="quiz", correct=True),
        ev(T0 + MIN, kind="quiz", correct=False, doc="d2", section="toc:2"),
        ev(T0 + 2 * MIN),  # passive, no correct
    ]
    (s,) = cluster_events(events)
    assert s["graded"] == 2 and s["correct"] == 1
    assert s["docs"] == ["d1", "d2"]
    assert s["scopes"] == ["toc:1", "toc:2"]


def test_null_kind_counts_as_quiz_when_graded():
    (s,) = cluster_events([{"ts": T0, "kind": None, "doc": "d1", "sectionKey": None, "correct": True}])
    assert s["kinds"] == {"quiz": 1}
    assert s["kind"] == "quiz"


def test_events_without_ts_are_ignored():
    sessions = cluster_events([{"ts": None, "kind": "read"}, ev(T0)])
    assert len(sessions) == 1 and sessions[0]["events"] == 1
