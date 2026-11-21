"""Spaced-repetition scheduler — FSRS (py-fsrs) behind a pure state-dict contract, no
DB/HTTP imports so the scheduling logic is unit-testable in isolation.

A *review state* is a plain dict carrying the scheduler fields; ``schedule(state, grade, now)``
returns the next state. Grades are 1-4: 1=Again, 2=Hard, 3=Good, 4=Easy — they map 1:1 onto
FSRS ratings. The library types (Card/Rating/State) never leak past this module.

FSRS models each item as (stability, difficulty): stability = days for recall probability to
fall to 90%, difficulty = how slowly stability grows. ``retrievability(state, now)`` exposes
the modelled "fraction still remembered right now". Rows written by the pre-2026-07-16 SM-2
scheduler carry interval/ease but no stability — ``schedule`` seeds FSRS memory from those on
first touch, so old review history migrates lazily with no batch rewrite.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fsrs import Card, Rating, Scheduler, State

DAY = 86400.0
AGAIN_SECONDS = 600.0  # "Again" reappears in ~10 minutes (the FSRS relearning step)

# Legacy SM-2 fields — kept in the state dict for display/back-compat and used once to seed
# FSRS memory for pre-swap rows.
DEFAULT_EASE = 2.5
MIN_EASE = 1.3

Grade = int  # 1=Again, 2=Hard, 3=Good, 4=Easy

# No learning steps: the first Good on a new card graduates straight to a multi-day interval
# (the old scheduler's feel — cards don't linger due within the session); a lapse ("Again")
# relearns in ~10 minutes. Fuzzing off: dues stay deterministic (testable, reproducible).
_SCHEDULER = Scheduler(
    learning_steps=(),
    relearning_steps=(timedelta(seconds=AGAIN_SECONDS),),
    enable_fuzzing=False,
)

_STATE_TO_STR = {State.Learning: "learning", State.Review: "review", State.Relearning: "relearning"}
_STR_TO_STATE = {"learning": State.Learning, "review": State.Review, "relearning": State.Relearning}


def new_state(now: float) -> dict[str, Any]:
    """A fresh review row for a never-studied item (due immediately = a 'new' card)."""
    return {
        "stability": None,
        "difficulty": None,
        "step": None,
        "ease": DEFAULT_EASE,
        "interval": 0.0,  # days until due (kept for display + mastery's decay tau)
        "reps": 0,
        "lapses": 0,
        "state": "new",
        "due": now,
        "lastReview": None,
        "lastGrade": None,
    }


def _dt(epoch: float) -> datetime:
    return datetime.fromtimestamp(float(epoch), tz=timezone.utc)


def _legacy_memory(state: dict[str, Any]) -> tuple[float | None, float | None]:
    """Seed (stability, difficulty) for a pre-FSRS SM-2 row: stability ≈ its interval in
    days; difficulty mapped from ease (default 2.5 → mid-scale 5, floor 1.3 → ~9)."""
    interval = float(state.get("interval") or 0.0)
    if interval <= 0:
        return None, None
    ease = float(state.get("ease") or DEFAULT_EASE)
    difficulty = min(10.0, max(1.0, 1.0 + (3.7 - ease) * (8.0 / 2.4)))
    return max(0.1, interval), difficulty


def _to_card(state: dict[str, Any], now: float) -> Card:
    st = _STR_TO_STATE.get(str(state.get("state") or ""))
    if st is None:  # "new" (or unknown) — a fresh card
        return Card(due=_dt(now))
    stability = state.get("stability")
    difficulty = state.get("difficulty")
    if stability is None:
        stability, difficulty = _legacy_memory(state)
    last = state.get("lastReview")
    step = state.get("step")
    return Card(
        state=st,
        step=int(step) if step is not None and st != State.Review else None,
        stability=float(stability) if stability is not None else None,
        difficulty=float(difficulty) if difficulty is not None else None,
        due=_dt(state.get("due") or now),
        last_review=_dt(last) if last else None,
    )


def schedule(state: dict[str, Any], grade: Grade, now: float) -> dict[str, Any]:
    """Advance a review state by one graded recall. Returns a new state dict.

    Again (1) lapses the card into a ~10-minute relearn; Hard/Good/Easy grow the next
    interval from the item's FSRS memory (stability × difficulty), targeting 90% recall.
    """
    rating = Rating(int(min(4, max(1, int(grade)))))
    card, _log = _SCHEDULER.review_card(_to_card(state, now), rating, _dt(now))

    reps = int(state.get("reps", 0))
    lapses = int(state.get("lapses", 0))
    if rating == Rating.Again:
        reps = 0
        lapses += 1
    else:
        reps += 1

    due = card.due.timestamp()
    return {
        **state,
        "stability": card.stability,
        "difficulty": card.difficulty,
        "step": card.step,
        "interval": round((due - now) / DAY, 3),
        "reps": reps,
        "lapses": lapses,
        "state": _STATE_TO_STR.get(card.state, "review"),
        "due": due,
        "lastReview": now,
        "lastGrade": int(rating),
    }


def retrievability(state: dict[str, Any], now: float) -> float | None:
    """Modelled probability the item is still recallable at ``now`` (1.0 → just reviewed,
    0.9 → at its due date). None for never-reviewed items."""
    if str(state.get("state") or "new") == "new" or not state.get("lastReview"):
        return None
    card = _to_card(state, now)
    if card.stability is None:
        return None
    return float(_SCHEDULER.get_card_retrievability(card, _dt(now)))


def is_due(state: dict[str, Any], now: float) -> bool:
    return float(state.get("due", 0.0)) <= now
