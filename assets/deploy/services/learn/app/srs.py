"""Spaced-repetition scheduler (SM-2 lite) — pure functions, no DB/HTTP imports so the
scheduling logic is unit-testable in isolation (same discipline as quiz_gen.py).

A *review state* is a plain dict carrying the scheduler fields; ``schedule(state, grade, now)``
returns the next state. Grades are 1-4: 1=Again, 2=Hard, 3=Good, 4=Easy. Isolated here so a
richer scheduler (e.g. FSRS) can be dropped in without touching the routes.
"""

from __future__ import annotations

from typing import Any

DAY = 86400.0
DEFAULT_EASE = 2.5
MIN_EASE = 1.3
AGAIN_SECONDS = 600.0  # "Again" reappears in ~10 minutes (same session relearn)
EASY_BONUS = 1.3
HARD_MULT = 0.8

Grade = int  # 1=Again, 2=Hard, 3=Good, 4=Easy


def new_state(now: float) -> dict[str, Any]:
    """A fresh review row for a never-studied concept (due immediately = a 'new' card)."""
    return {
        "ease": DEFAULT_EASE,
        "interval": 0.0,  # days
        "reps": 0,
        "lapses": 0,
        "state": "new",
        "due": now,
        "lastReview": None,
        "lastGrade": None,
    }


def schedule(state: dict[str, Any], grade: Grade, now: float) -> dict[str, Any]:
    """Advance a review state by one graded recall. Returns a new state dict.

    Again (1) lapses the card and re-queues it within the session. Hard/Good/Easy grow the
    interval by the ease factor (Hard shrinks it, Easy adds a bonus); ease drifts down on Hard
    and up on Easy, floored at MIN_EASE.
    """
    grade = int(grade)
    ease = float(state.get("ease", DEFAULT_EASE))
    interval = float(state.get("interval", 0.0))
    reps = int(state.get("reps", 0))
    lapses = int(state.get("lapses", 0))

    if grade <= 1:  # Again
        reps = 0
        lapses += 1
        ease = max(MIN_EASE, ease - 0.20)
        interval = 0.0
        due = now + AGAIN_SECONDS
        new_st = "learning"
    else:
        if grade == 2:  # Hard
            ease = max(MIN_EASE, ease - 0.15)
        elif grade == 4:  # Easy
            ease = ease + 0.15
        reps += 1
        if reps == 1:
            interval = 0.5 if grade == 2 else (4.0 if grade == 4 else 1.0)
        elif reps == 2:
            interval = 3.0 if grade == 2 else (6.0 if grade == 3 else 8.0)
        else:
            mult = ease * (EASY_BONUS if grade == 4 else (HARD_MULT if grade == 2 else 1.0))
            interval = max(1.0, round(interval * mult))
        due = now + interval * DAY
        new_st = "review"

    return {
        **state,
        "ease": round(ease, 3),
        "interval": interval,
        "reps": reps,
        "lapses": lapses,
        "state": new_st,
        "due": due,
        "lastReview": now,
        "lastGrade": grade,
    }


def is_due(state: dict[str, Any], now: float) -> bool:
    return float(state.get("due", 0.0)) <= now
