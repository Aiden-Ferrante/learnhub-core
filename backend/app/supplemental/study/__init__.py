"""Study — the learning loop over extracted concepts.

Exactly TWO graded activities, both FSRS-scheduled through the same review queue:
skeleton recall (rebuild a chapter's structure from memory) and concept recall.
Owns: the append-only study_events floor + mastery/activity/forecast read models
(mastery), FSRS review scheduling incl. skeleton + chapter-resurface items
(reviews, srs), and the derived working sessions / review calendar (sessions,
calendar). Passive engagement (read / listen / orient) is logged ungraded and
feeds the activity heatmap only.
Depends on: process/content, process/extraction (chapter stage ledger), gateways.
"""

from app.supplemental.study.calendar import build_review_calendar, build_study_debt
from app.supplemental.study.manual import delete_manual_session, upsert_manual_session
from app.supplemental.study.mastery import compute_activity, compute_concept_mastery, compute_forecast, compute_mastery, record_engagement
from app.supplemental.study.reviews import (
    build_review_queue,
    delete_concept_reviews,
    ensure_chapter_item,
    grade_review,
    practice_review_key,
)
from app.supplemental.study.sessions import fetch_sessions

__all__ = [
    "build_review_calendar",
    "build_review_queue",
    "build_study_debt",
    "compute_activity",
    "compute_concept_mastery",
    "compute_forecast",
    "compute_mastery",
    "delete_concept_reviews",
    "practice_review_key",
    "delete_manual_session",
    "ensure_chapter_item",
    "fetch_sessions",
    "grade_review",
    "record_engagement",
    "upsert_manual_session",
]
