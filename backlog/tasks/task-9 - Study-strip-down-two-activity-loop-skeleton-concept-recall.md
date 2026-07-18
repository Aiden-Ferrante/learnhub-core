---
id: TASK-9
title: 'Study strip-down: two-activity loop (skeleton + concept recall)'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-18 00:07'
updated_date: '2026-07-18 00:29'
labels: []
dependencies: []
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Apply docs/STUDY-SIMPLIFICATION.md: delete quizzes/exams/drills/free-recall/figure-recall + calibration/mistakes diagnostics; study loop = FSRS-scheduled skeleton recall + concept recall only. Event floor + mastery/activity/forecast/sessions read models stay. Deletion over flagging. Extra scope beyond the doc: strip the matching learn-hub MCP tools (mcp/) that call removed endpoints.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Removed modules/routes/surfaces gone; grep sweep (concept-quiz, exam, drill, recall/check, calibration, mistakes, quiz_session, author_scope, figure_order) has zero code hits in backend/app + frontend/src
- [ ] #2 quiz_questions / dump-view / triple_id / figure-column investigations resolved and recorded
- [ ] #3 Backend tests green after pruning removed-module tests; frontend build green
- [ ] #4 Live smoke: skeleton grade + concept review grade both feed /api/mastery, /api/activity, /api/forecast, /api/study/sessions
- [ ] #5 Schema (init SQL + live DB) drops quiz/figure-only columns; ARCHITECTURE.md + study __init__ docstring describe the two-activity loop
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Investigations resolved: quiz_questions read only by deleted modules + concept_store curation → column/route/tool go. dump-view = free-recall UI (calls checkRecall) → delete. triple_id zero code readers → drop. concept_reviews: heading/children/chapter_scope used by skeleton+chapter items → keep; drop only caption/page/order/figure_order; keep ease+interval (FSRS lazy migration + mastery decay). Extra scope: chapter-path stage machine loses quizzes+exam stages (learn-path.ts, lockin-panel exam row, use-chapter-path soft gate, backend skeleton.py docstring); section-concepts-panel loses ConceptQuickCheck; ledger KINDS -quizzes; MCP quiz tools removed; record_quiz_event → record_grade_event (name lied), concept grades log kind=review, skeleton kind=skeleton. Order: P1 backend deletions → P2 diagnostics+events → P3 reviews figure strip → schema (init SQL + live ALTER) → P4 frontend → MCP → tests/build → deploy+smoke → docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All phases + extra scope applied. Backend: 7 modules deleted, routes/conductor/ledger/facades stripped, mastery recorder renamed record_grade_event (kinds: review/skeleton/resurface), reviews.py figure-free. Schema: init SQL + live ALTERs (study_events -stem/-expected/-confidence/-triple_id; concept_reviews -caption/-page/-order/-figure_order; ext_concepts -quiz_questions). Frontend: 8 files + 2 routes deleted, path stages now orient/read/skeleton/lockin, review panel/gateway figure-free. MCP: 5 tools removed. 124 backend tests green (incl PG tier vs live DB), tsc + both hub checkers clean, MAP/ARCHITECTURE regenerated. Building images for live smoke.
<!-- SECTION:NOTES:END -->
