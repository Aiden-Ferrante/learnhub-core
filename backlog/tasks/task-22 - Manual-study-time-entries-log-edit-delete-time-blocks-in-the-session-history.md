---
id: TASK-22
title: >-
  Manual study-time entries: log, edit, delete time blocks in the session
  history
status: Done
assignee:
  - '@claude'
created_date: '2026-07-26 04:05'
updated_date: '2026-07-26 04:18'
labels:
  - frontend
  - backend
  - studying
dependencies: []
priority: medium
type: feature
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sessions are derived from the append-only study_events floor and cannot be edited. User decision (2026-07-25 fork): manual time lives in its OWN layer — a manual_sessions table — merged into the session list and time-studied totals; derived sessions stay read-only; heatmap/cadence stay graded-only. From /study's Recent-sessions panel: log a block (course, date, start, duration, note), edit it, delete it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A 'Log time' action on the Recent sessions panel creates a manual block (course + date + start + duration + optional note)
- [x] #2 Manual blocks appear in the session list (marked manual) merged chronologically with derived sessions, and count toward Sessions and Time studied stats
- [x] #3 Manual blocks can be edited and deleted; derived sessions offer no edit affordance
- [x] #4 Invalid blocks are rejected (end before start, zero/negative duration)
- [x] #5 Heatmap and cadence chip are unaffected by manual blocks
- [x] #6 Deleting a course cascades away its manual blocks
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Schema: manual_sessions (key pk, doc FK raw_documents ON DELETE CASCADE, start_ts/end_ts timestamptz w/ CHECK end>start, note, created_at) in 01-schema.sql + live CREATE. 2. backend supplemental/study/manual.py: upsert/delete/fetch + pure row->session shaping (kind 'manual', kinds {manual:1}); fetch_sessions merges newest-first before summary. 3. routes: POST/DELETE /api/study/manual-session in progress_routes (proxy catch-all forwards verbatim). 4. frontend planner.ts fetchers + WorkingSession {manual,key,note}; study-planner: Log-time button + dialog (course from useDocuments), manual rows get edit/delete. 5. Tests: unit (shaping/validation/merge), PG-tier roundtrip; live browser verify all ACs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified 2026-07-26 on rebuilt :3001: Log time -> 45min block created (1 DB row), MANUAL badge + note + course in list, Time studied 3m->48m; edit prefilled and 45->90 saved (93m); duration-0 rejected client-side w/ message + dialog stays open (backend validate_block+CHECK constraint cover the API path, unit+PG tested); heatmap unchanged ('2 reviews this year') with a 90-min block present; delete -> row gone, 3m again, DB count 0. AC6 cascade proven by PG test test_course_delete_cascades_manual_blocks. Suite 132 passed (126+6 new: 3 unit shaping/validation/merge + 3 PG roundtrip/rejection/cascade); tsc real-exit 0; next build green; hub contract holds. NOTE (environment, not app): the in-app browser pane never advances CSS animations, so radix Dialog close appeared stuck (data-state=closed, exit animation 'running' forever) — dispatching animationend unmounts instantly; real browsers are unaffected (same Dialog pattern as the shipped group dialogs).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Manual study-time blocks: manual_sessions table (FK cascade, CHECK end>start), supplemental/study/manual.py CRUD + session-shaped merge into fetch_sessions, POST/DELETE /api/study/manual-session, Log-time dialog + editable manual rows on /study. All six ACs verified live + by 6 new tests.
<!-- SECTION:FINAL_SUMMARY:END -->
