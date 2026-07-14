"""Daily new-card intake allowance — the pure helpers behind the review-queue cap."""

import time

from app.api.concept_study_routes import day_start, new_allowance


def test_new_allowance_counts_down_and_floors_at_zero():
    assert new_allowance(10, 0) == 10
    assert new_allowance(10, 4) == 6
    assert new_allowance(10, 10) == 0
    assert new_allowance(10, 25) == 0


def test_new_allowance_defensive_on_negatives():
    assert new_allowance(10, -3) == 10  # bogus negative count never inflates the cap
    assert new_allowance(0, 0) == 0


def test_day_start_is_local_midnight():
    now = time.time()
    start = day_start(now)
    lt = time.localtime(start)
    assert (lt.tm_hour, lt.tm_min, lt.tm_sec) == (0, 0, 0)
    assert 0 <= now - start < 86400 + 3600  # within a day (+DST slack)
    # Same moment later in the day maps to the same boundary.
    assert abs(day_start(start + 3600) - start) < 1e-6
