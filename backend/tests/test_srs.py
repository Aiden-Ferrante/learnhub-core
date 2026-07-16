"""Unit tests for the FSRS scheduler wrapper (pure, no DB)."""

from app.study import srs

NOW = 1_000_000.0
DAY = srs.DAY


def test_new_state_is_due_now():
    s = srs.new_state(NOW)
    assert s["state"] == "new"
    assert s["reps"] == 0
    assert s["stability"] is None
    assert srs.is_due(s, NOW) is True


def test_good_graduates_to_days_and_intervals_grow():
    s = srs.new_state(NOW)
    s1 = srs.schedule(s, 3, NOW)  # Good, rep 1
    assert s1["reps"] == 1
    assert s1["state"] == "review"
    assert s1["stability"] is not None and s1["difficulty"] is not None
    assert s1["interval"] >= 1.0  # graduates straight to a multi-day interval

    # Review it at its due date — the next interval must be longer.
    s2 = srs.schedule(s1, 3, s1["due"])
    assert s2["interval"] > s1["interval"]
    s3 = srs.schedule(s2, 3, s2["due"])
    assert s3["interval"] > s2["interval"]


def test_again_lapses_and_requeues_same_session():
    s = srs.new_state(NOW)
    s = srs.schedule(s, 3, NOW)
    lapsed = srs.schedule(s, 1, s["due"])  # Again at the due date
    assert lapsed["reps"] == 0
    assert lapsed["lapses"] == 1
    assert lapsed["state"] == "relearning"
    assert lapsed["due"] == s["due"] + srs.AGAIN_SECONDS
    assert srs.is_due(lapsed, lapsed["due"] + 1) is True
    # Recovering from the lapse returns the card to review with a real interval.
    back = srs.schedule(lapsed, 3, lapsed["due"])
    assert back["state"] == "review"
    assert back["interval"] >= 1.0


def test_grade_ordering_hard_good_easy():
    s = srs.new_state(NOW)
    hard = srs.schedule(s, 2, NOW)
    good = srs.schedule(s, 3, NOW)
    easy = srs.schedule(s, 4, NOW)
    assert hard["interval"] <= good["interval"] < easy["interval"]
    # Harder grades leave the item modelled as more difficult.
    assert hard["difficulty"] > good["difficulty"] > easy["difficulty"]


def test_legacy_sm2_row_migrates_on_first_touch():
    # A pre-FSRS row: interval/ease present, no stability/difficulty.
    legacy = {
        "ease": 2.5, "interval": 6.0, "reps": 2, "lapses": 0,
        "state": "review", "due": NOW, "lastReview": NOW - 6 * DAY,
        "lastGrade": 3, "stability": None, "difficulty": None, "step": None,
    }
    nxt = srs.schedule(legacy, 3, NOW)
    assert nxt["stability"] is not None and nxt["difficulty"] is not None
    # Seeded from a 6-day interval, a Good review must schedule further out than 6 days.
    assert nxt["interval"] > 6.0
    assert nxt["state"] == "review"


def test_retrievability_decays_toward_090_at_due():
    s = srs.schedule(srs.new_state(NOW), 3, NOW)
    r_now = srs.retrievability(s, NOW)
    r_mid = srs.retrievability(s, NOW + (s["due"] - NOW) / 2)
    r_due = srs.retrievability(s, s["due"])
    assert r_now is not None and r_now > r_mid > r_due
    assert abs(r_due - 0.9) < 0.02  # the scheduler targets 90% recall at the due date
    assert srs.retrievability(srs.new_state(NOW), NOW) is None
