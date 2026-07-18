# Study System Strip-Down — Plan

Goal: reduce the study loop to exactly two graded activities — **skeleton recall** and
**concept recall** — both FSRS-scheduled. Remove quizzes, exams, drills, free recall,
and figure recall, plus the quiz-fed diagnostics (calibration, mistakes). The
append-only `study_events` floor and the mastery/activity/forecast read models stay;
their only graded inputs become review grades.

Data loss is acceptable (single-user dev; DB can be wiped). Prefer deletion over
feature-flagging — dead code is the enemy here.

## What stays (do not touch beyond noted edits)

- `supplemental/study/srs.py` — FSRS scheduler (pure, keep as-is)
- `supplemental/study/reviews.py` — review queue + grading for concept & skeleton items
  (edit: remove figure-item support, see Phase 3)
- `supplemental/study/mastery.py` — event floor + mastery/activity/forecast
  (edit: remove calibration + quiz-only fields, see Phase 4)
- `supplemental/study/sessions.py`, `calendar.py` — derived read models
- Chapter path: orient + skeleton generation/grading (skeleton recall is a keeper)
- `record_engagement` passive events (read/listen/orient) — activity heatmap input

## Phase 1 — Backend: delete the four activities

Delete modules from `app/supplemental/study/`:
- `quiz_session.py`, `concept_quiz_llm.py`, `concept_quiz_gen.py`, `cards.py`
- `exam.py`, `drill.py`, `recall.py`

Update `app/supplemental/study/__init__.py`: drop the corresponding imports/exports
(`answer_quiz`, `author_scope_sync`, `prepare_quizzes`, `quiz_prepare_status`,
`start_quiz_session`, `grade_exam`, `start_exam`, `grade_drill`, `start_drill`,
`check_recall`).

`app/api/study_routes.py`: delete endpoints
- `/api/concept-quiz/session`, `/api/concept-quiz/prepare` (GET+POST), `/api/concept-quiz/answer`
- `/api/exam/start`, `/api/exam/grade`
- `/api/drill/start`, `/api/drill/grade`
- `/api/recall/check`

Conductor: search `app/conductor/` for registered job kinds belonging to quiz
preparation (`prepare_quizzes` / quiz authoring). Remove the kind registration and
any runner. VERIFY: no other kind depends on it.

Investigate before deleting: `ext_concepts.quiz_questions` column and
`PUT /api/concept/{key}/questions` (concept_routes). If the concept-recall review
prompt renders from `quiz_questions`, keep both; if only the quiz flow read them,
delete the route, the column write path, and the column (schema edit). Record the
finding in the PR description.

## Phase 2 — Backend: remove quiz-fed diagnostics

- `mastery.py`: delete `compute_calibration`; in `record_quiz_event` drop the
  `stem`, `expected`, `confidence` parameters and their INSERT columns.
- `progress_routes.py`: delete `/api/calibration` and `/api/mistakes`.
- `study_events` schema: drop columns `stem`, `expected`, `confidence`, `triple_id`
  (triple_id is retired-KG legacy — verify zero readers first, then drop).
- Keep `kind` — after the strip its values should only be
  `review | skeleton | read | listen | orient` (+ any chapter-path engagement kinds).

## Phase 3 — Backend: strip figure recall from reviews

In `reviews.py`:
- Remove figure item creation/selection (`item_type` figure branches, `caption`,
  `page`, `figure_order`, `children` handling in queue building and grading).
- VERIFY what `item_type` values exist in code (expect concept / skeleton / figure);
  after the strip only concept + skeleton remain.
- `concept_reviews` schema: drop figure-only columns (`caption`, `page`, `order`,
  `figure_order`, `children`, `heading` — confirm each has no non-figure reader
  before dropping). Also drop legacy `ease`/`interval`… **no** — keep `interval`:
  mastery decay (`_concept_intervals`) still reads it. Revisit interval→stability
  unification as a separate task (noted in backlog, not this strip).

## Phase 4 — Frontend

Delete surfaces (and their exports in `surfaces/studying/index.ts`):
- `concept-quiz-panel.tsx`, `quiz-choice-list.tsx`, `exam-panel.tsx`,
  `drill-view.tsx`, and the free-recall surface (`dump-view.tsx` — VERIFY it is the
  free-recall UI calling `/api/recall/check`; if it's the chapter-path brain-dump
  writing only engagement events, keep it and note so).
- `gateways/api/quiz.ts`; quiz/exam/drill/recall paths in `learn-proxy.ts`.
- Calibration + mistakes widgets (search `calibration`, `mistakes` under
  `surfaces/`; likely course-home / progress views) and their fetchers in
  `gateways/api/progress.ts`.
- Update `study-planner.tsx`, `chapter-walk.tsx`, `study-drawer.tsx`,
  `course-home.tsx` to drop links/tabs for removed activities. The chapter walk
  keeps orient → skeleton; the study surface keeps the review queue.

## Phase 5 — Verification (do all)

1. `grep -ri` for: `concept-quiz`, `exam`, `drill`, `recall/check`, `calibration`,
   `mistakes`, `quiz_session`, `author_scope`, `figure_order` — expect zero hits in
   `backend/app` and `frontend/src` (exception: the word "drill"/"exam" in prose/docs).
2. `pytest backend/tests` — delete tests of removed modules; keep + green everything
   touching reviews/srs/mastery.
3. Frontend `npm run build` — no dangling imports.
4. Manual smoke: convert nothing; open a course → chapter walk (orient/skeleton),
   grade a skeleton; open review queue, grade a concept; confirm `/api/mastery`,
   `/api/activity`, `/api/forecast`, `/api/study/sessions` all still return data
   fed by those two grade paths.
5. Update `ARCHITECTURE.md` + the `study/__init__.py` docstring to describe the
   two-activity loop.

## Explicitly out of scope (separate tasks later)

- Unifying mastery decay onto FSRS `retrievability()` (the two-memory-models issue)
- Recency weighting for accuracy
- Tightening the `doc IS NULL` legacy clauses in event queries
- Any caching of read models

---

## Applied — 2026-07-17 (Backlog TASK-9)

All five phases landed. Investigation verdicts the plan asked for:

- **`ext_concepts.quiz_questions`**: read ONLY by the deleted quiz modules
  (`quiz_session.py`, `concept_quiz_llm.py`, `exam.py`) plus the curation write path.
  Concept review cards render from `ext_concepts.name/kind/signal/source` — the column,
  `PUT /api/concept/{key}/questions`, `set_concept_questions` (store + MCP tool), and the
  course-status `chaptersWithQuizzes` stat were all deleted. Schema column dropped.
- **`dump-view.tsx`**: confirmed the free-recall UI (imported `checkRecall` →
  `/api/recall/check`) — deleted along with its `/courses/[id]/dump` route.
- **`study_events.triple_id`**: zero code readers (one docstring mention) — dropped.
- **`concept_reviews` figure columns**: `caption`, `page`, `"order"`, `figure_order`
  dropped. `heading`/`children`/`chapter_scope` KEPT — skeleton and chapter-resurface
  items snapshot their reveal there. `ease`+`interval` KEPT (FSRS lazy migration reads
  ease; mastery decay reads interval — the interval→stability unification stays a
  separate task).

Beyond the plan (same spirit):

- The chapter path lost its `quizzes` and `exam` stages end-to-end
  (`learn-path.ts` → orient/read/skeleton/lockin; lock-in no longer shows an
  exam-pass row; the quiz soft-gate in `use-chapter-path` is gone).
- `record_quiz_event` → `record_grade_event` (the name lied); concept grades log
  `kind='review'`, skeleton grades `kind='skeleton'` (was `recall`), chapter resurfaces
  stay `resurface`. `study_events.kind` values are now
  `review | skeleton | resurface | read | listen | orient`.
- The learn-hub MCP server lost `prepare_quizzes`, `quiz_prepare_status`, `quiz_next`,
  `quiz_answer`, and `set_concept_questions`.
- `ConceptQuickCheck` (the per-section MCQ embed) removed from
  `section-concepts-panel.tsx`; the panel is the encoding pass, the review queue is
  the graded retrieval.
- The `quizzes` job kind removed from the conductor registry and ledger KINDS.
