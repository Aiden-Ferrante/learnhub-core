"""Study — the learning loop over extracted concepts.

Owns: the append-only study_events floor + mastery/activity/forecast/calibration
read models (mastery), FSRS review scheduling incl. skeleton/figure recall
(reviews, srs), derived working sessions (sessions), quiz sessions (quiz_session),
exams (exam), drills (drill), free recall (recall), LLM quiz authoring with its
critic (concept_quiz_llm, concept_quiz_gen), and distractor selection (cards).
Depends on: content, extraction (chapter stage ledger), search (embeddings),
platform.
"""

from app.study.calendar import build_review_calendar
from app.study.concept_quiz_llm import author_scope_sync, scope_question_status
from app.study.drill import grade_drill, start_drill
from app.study.exam import grade_exam, start_exam
from app.study.mastery import compute_activity, compute_calibration, compute_concept_mastery, compute_forecast, compute_mastery, record_engagement
from app.study.quiz_session import answer_quiz, prepare_quizzes, quiz_prepare_status, start_quiz_session
from app.study.recall import check_recall
from app.study.reviews import build_review_queue, ensure_chapter_item, grade_review
from app.study.sessions import fetch_sessions

__all__ = [
    "answer_quiz",
    "author_scope_sync",
    "build_review_calendar",
    "build_review_queue",
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
    "scope_question_status",
    "start_drill",
    "start_exam",
    "start_quiz_session",
]
