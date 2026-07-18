---
id: TASK-12
title: 'Three-question tracking: coverage + FSRS retention, re-homed surfaces'
status: Done
assignee: []
created_date: '2026-07-18 01:50'
updated_date: '2026-07-18 02:01'
labels: []
dependencies: []
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace composite mastery (coverage×accuracy×decay) with per-section coverage + FSRS-retrievability retention (states new/solid/shaky/fading); delete the SM-2 decay model + MASTERY_ALPHA/BETA/TAU knobs; add derived 7-day cadence to activity. Re-home: course home = per-chapter memory map (coverage+retention+due pill) only; /study = action (queue/debt/calendar/forecast) + history (sessions/heatmap/cadence). No new persisted state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 compute_mastery/concept_mastery return coverage+retention+state from FSRS retrievability; composite %, SM-2 decay, and env knobs deleted; unit tests cover the state buckets
- [x] #2 Activity response carries a 7-day cadence block derived from graded events; no schema changes anywhere
- [x] #3 Course home shows only the memory map + due pill; forecast/heatmap/weakest moved off; /study has action + history sections incl. cadence chip; each number has one home
- [x] #4 Backend tests + tsc + hub checks green; live verify on :3001 with real graded data
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Backend done: mastery.py rewritten to coverage+retention via srs.retrievability (SM-2 decay + alpha/beta/tau knobs deleted; compute_mastery no longer touches study_events), cadence block on activity, retention_state buckets + summarize_memory pure fns w/ 7 new unit tests (118 green). Frontend done: progress.ts retyped (forecast fetcher removed — its numbers live on /study calendar), course-home = memory map (MemoryRow: state dot/coverage bar/retention/fading chip) + fading rail + state headline (forecast card/heatmap/weakest/ProgressRing removed), /study history column gains heatmap + cadence chip (heatmap card header), concepts dot/tree/card/detail/popover on state+retention, guided-reading tint/wash state-based (masteredThreshold plumbing gone), syllabus badge = retention. tsc + both hub checks clean. Rebuilding for live verify.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped 38a1b84. Composite mastery replaced by coverage + FSRS-retrievability retention with new/solid/shaky/fading states (SM-2 decay + all MASTERY_* knobs deleted; compute_mastery no longer reads study_events); cadence rides the activity response; zero new persisted state. Course home = memory map + due pill only; /study = action (calendar carries forecast) + history (heatmap w/ cadence chip, sessions). Verified live with real grades: ch11 1/4 covered · 100% solid on the map, 2 due on the calendar, 1/7 cadence, 118 tests + tsc + hub checks green.
<!-- SECTION:FINAL_SUMMARY:END -->
