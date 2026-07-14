"""Unit tests for the SM-2-lite scheduler (pure, no DB)."""

from app import srs

NOW = 1_000_000.0
DAY = srs.DAY


def test_new_state_is_due_now():
    s = srs.new_state(NOW)
    assert s["state"] == "new"
    assert s["reps"] == 0
    assert srs.is_due(s, NOW) is True


def test_good_grows_interval_over_reps():
    s = srs.new_state(NOW)
    s1 = srs.schedule(s, 3, NOW)  # Good, rep 1
    assert s1["reps"] == 1
    assert s1["interval"] == 1.0
    assert s1["state"] == "review"
    assert s1["due"] == NOW + DAY

    s2 = srs.schedule(s1, 3, NOW)  # Good, rep 2
    assert s2["interval"] == 6.0

    s3 = srs.schedule(s2, 3, NOW)  # Good, rep 3 -> interval * ease
    assert s3["interval"] == round(6.0 * s2["ease"])
    assert s3["interval"] > s2["interval"]


def test_again_lapses_and_requeues_same_session():
    s = srs.new_state(NOW)
    s = srs.schedule(s, 3, NOW)
    s = srs.schedule(s, 3, NOW)  # built up some interval
    lapsed = srs.schedule(s, 1, NOW)  # Again
    assert lapsed["reps"] == 0
    assert lapsed["lapses"] == 1
    assert lapsed["state"] == "learning"
    assert lapsed["due"] == NOW + srs.AGAIN_SECONDS
    assert srs.is_due(lapsed, NOW + srs.AGAIN_SECONDS + 1) is True


def test_ease_drifts_down_on_hard_up_on_easy_floored():
    s = srs.new_state(NOW)
    hard = srs.schedule(s, 2, NOW)
    assert hard["ease"] < srs.DEFAULT_EASE
    easy = srs.schedule(s, 4, NOW)
    assert easy["ease"] > srs.DEFAULT_EASE
    # Ease never sinks below the floor even after many Hard/Again grades.
    st = srs.new_state(NOW)
    for _ in range(20):
        st = srs.schedule(st, 1, NOW)
    assert st["ease"] >= srs.MIN_EASE


def test_easy_interval_exceeds_good():
    s = srs.new_state(NOW)
    good = srs.schedule(s, 3, NOW)
    easy = srs.schedule(s, 4, NOW)
    assert easy["interval"] > good["interval"]
