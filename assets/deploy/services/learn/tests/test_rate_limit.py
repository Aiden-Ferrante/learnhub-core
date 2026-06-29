"""Tests for the per-IP sliding-window rate limiter."""

import app.rate_limit as rl


def setup_function():
    rl._hits.clear()


def test_allows_under_limit_then_blocks():
    assert all(rl.check_rate_limit("1.2.3.4", max_per_minute=3) for _ in range(3))
    assert rl.check_rate_limit("1.2.3.4", max_per_minute=3) is False  # 4th in window


def test_separate_ips_are_independent():
    assert rl.check_rate_limit("a", max_per_minute=1) is True
    assert rl.check_rate_limit("a", max_per_minute=1) is False
    assert rl.check_rate_limit("b", max_per_minute=1) is True  # b unaffected by a


def test_idle_ips_are_swept(monkeypatch):
    # An IP that hits once and never returns must not linger in the table forever.
    t = [1000.0]
    monkeypatch.setattr(rl.time, "monotonic", lambda: t[0])

    rl.check_rate_limit("ghost", max_per_minute=5)
    assert "ghost" in rl._hits

    t[0] += 61.0  # advance past the 60s window
    rl.check_rate_limit("other", max_per_minute=5)  # any later call triggers the sweep
    assert "ghost" not in rl._hits
