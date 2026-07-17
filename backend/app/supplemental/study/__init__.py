"""Study — the learning loop over extracted concepts.

Owns: the append-only study_events floor + mastery/activity/forecast/calibration
read models (mastery), FSRS review scheduling incl. skeleton/figure recall
(reviews, srs), derived working sessions (sessions), quiz sessions (quiz_session),
exams (exam), drills (drill), free recall (recall), LLM quiz authoring with its
critic (concept_quiz_llm, concept_quiz_gen), and quiz-target filtering (cards).
Depends on: process/content, process/extraction (chapter stage ledger), gateways.
"""

from app.supplemental.study.calendar import build_review_calendar, build_study_debt
from app.supplemental.study.concept_quiz_llm import author_scope_sync
from app.supplemental.study.drill import grade_drill, start_drill
from app.supplemental.study.exam import grade_exam, start_exam
from app.supplemental.study.mastery import compute_activity, compute_calibration, compute_concept_mastery, compute_forecast, compute_mastery, record_engagement
from app.supplemental.study.quiz_session import answer_quiz, prepare_quizzes, quiz_prepare_status, start_quiz_session
from app.supplemental.study.recall import check_recall
from app.supplemental.study.reviews import build_review_queue, delete_concept_reviews, ensure_chapter_item, grade_review
from app.supplemental.study.sessions import fetch_sessions

__all__ = [
    "answer_quiz",
    "author_scope_sync",
    "build_review_calendar",
    "build_review_queue",
    "delete_concept_reviews",
    "build_study_debt",
    "check_recall",
    "compute_activity",
    "compute_calibration",
    "compute_concept_mastery",
    "compute_forecast",
    "compute_mastery",
    "ensure_chapter_item",
    "fetch_sessions",
    "grade_drill",
    "grade_exam",
    "grade_review",
    "prepare_quizzes",
    "quiz_prepare_status",
    "record_engagement",
    "start_drill",
    "start_exam",
    "start_quiz_session",
]
