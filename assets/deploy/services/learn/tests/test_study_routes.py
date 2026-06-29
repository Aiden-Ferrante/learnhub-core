"""Tests for quiz session housekeeping."""

from app.study_routes import SESSION_TTL_SECONDS, _sweep_sessions


def test_sweep_drops_only_expired_sessions():
    now = 10_000.0
    sessions = {
        "fresh": {"created": now - 10},
        "edge": {"created": now - SESSION_TTL_SECONDS},
        "stale": {"created": now - SESSION_TTL_SECONDS - 1},
        "ancient": {"created": now - 10 * SESSION_TTL_SECONDS},
    }
    _sweep_sessions(sessions, now)
    assert set(sessions) == {"fresh", "edge"}


def test_sweep_drops_sessions_missing_created():
    now = 10_000.0
    sessions = {"legacy": {}, "fresh": {"created": now}}
    _sweep_sessions(sessions, now)
    assert set(sessions) == {"fresh"}


def test_sweep_empty_dict_is_noop():
    sessions: dict = {}
    _sweep_sessions(sessions, 0.0)
    assert sessions == {}
