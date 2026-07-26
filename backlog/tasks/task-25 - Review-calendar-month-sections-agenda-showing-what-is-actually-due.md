---
id: TASK-25
title: 'Review calendar: month sections + agenda showing what is actually due'
status: Done
assignee:
  - '@claude'
created_date: '2026-07-26 13:55'
updated_date: '2026-07-26 14:02'
labels:
  - frontend
  - backend
  - studying
dependencies: []
priority: high
type: enhancement
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The /study review calendar is unreadable and effectively empty. Three real problems: (1) the grid is one continuous ~9-week Monday-aligned run with NO month boundaries; (2) a due day renders only a count in a square — you must click to learn anything, and even then you get course names + counts, never WHAT is due (item names are not in the payload at all); (3) overdue items live only in dueNow and never appear on the grid, so with everything overdue the calendar shows entirely blank squares — the state the user hit ('there isn't anything displayed': days: [] with dueNow.total 2).

User forks (2026-07-26): always-visible agenda list with real item names; overdue pinned at the top of the agenda (grid stays future-only — a past square cannot be 'due').

Backend: build_review_calendar LEFT JOINs ext_concepts so each bucket carries items [{key, doc, title, name, type, scope}] (name = heading | concept name | section key); per-bucket item cap surfaced, totals stay exact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The calendar renders as separate month sections with month/year headers
- [x] #2 An agenda under the calendar lists real item names with type and course
- [x] #3 Overdue items appear pinned at the top of the agenda in their own group
- [x] #4 Clicking a calendar day filters the agenda to that day; clicking again clears
- [x] #5 Empty states are honest (nothing scheduled vs nothing tracked)
- [x] #6 Day counts and totals stay accurate (no silent truncation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. backend calendar.py: _bucket gains items[]; SQL LEFT JOIN ext_concepts on key for concept names; _add appends {key,doc,title,name,type,scope}; cap 50/bucket w/ itemsTruncated flag, totals exact. 2. planner.ts: CalendarItem type + items on CalendarDay/dueNow. 3. study-planner.tsx: CalendarGrid -> month-sectioned mini-grids; new ReviewAgenda (overdue group pinned + per-day groups, type badges, course line); selected day filters agenda. 4. pytest for bucket shaping/cap; tsc+build; live verify on :3001 incl. a seeded FUTURE due row to prove non-overdue rendering, then remove it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified 2026-07-26 on rebuilt :3001. Verification needed FUTURE due rows (user's data is 100% overdue — the very cause of the blank grid), so 4 temporary concept_reviews rows were seeded against REAL concept keys, verified, then DELETED; final state confirmed back to the original 2 rows (dueNow 2, days 0, tracked 2). Evidence: (1) month sections render 'July 2026'/'August 2026'/'September 2026' each as its own Monday-aligned grid w/ counts on the right squares (Jul 29 -> 2, Aug 7 -> 1); (2) agenda lists real names+types+course: 'STRUCTURE 2 The Nature of Complexity', 'CONCEPT Design alternatives comparison', 'CONCEPT Interface consideration factors'...; (3) 'OVERDUE · 2' group pinned at the top; (4) clicking Jul 29 filters agenda to that day and hides the overdue group, 'Show all' restores it; (5) with temp rows removed the page still names both overdue items instead of showing blank squares — the reported symptom is gone; empty-state copy distinguishes nothing-scheduled vs nothing-tracked; (6) 4 unit tests pin the naming fallback chain and cap-with-flag (137 total green). Agenda item click navigates to the right course. tsc real-exit 0, next build 0, hub contract holds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Review calendar rebuilt: month-sectioned grid + a What's-due agenda naming every scheduled item (overdue pinned first), backed by build_review_calendar now carrying item identities via a LEFT JOIN on ext_concepts with capped-but-flagged item lists. Verified live with temporary future rows (removed) and against the user's real all-overdue state.
<!-- SECTION:FINAL_SUMMARY:END -->
