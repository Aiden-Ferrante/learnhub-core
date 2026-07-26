---
id: TASK-24
title: Today strip on Courses page jumps to the study planner
status: Done
assignee:
  - '@claude'
created_date: '2026-07-26 13:45'
updated_date: '2026-07-26 13:47'
labels:
  - frontend
  - library
dependencies: []
priority: medium
type: enhancement
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User fork (2026-07-26): option (b) — no duplicate calendar on the Courses page; instead the existing Today strip (today-strip.tsx, currently pure display) becomes the affordance: clicking it opens /study, with a visible 'Open planner' cue when items are due. The review calendar stays on the study tab.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking the Today strip navigates to /study
- [x] #2 A visible affordance (Open planner + chevron) shows when items are due
- [x] #3 Strip still hides entirely when nothing is tracked, and keeps its caught-up state
- [x] #4 Hover signals clickability
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Wrap the strip card in next/link -> /study; add hover ring + ChevronRight; 'Open planner' label on the due state. tsc + live click-through on :3001.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified on rebuilt :3001: strip renders as <a href=/study> with pointer cursor, due-state shows brand 'Open planner' + chevron (caught-up state reveals it on hover), click lands on /study with planner rendered. Hide-when-untracked early-return untouched. tsc real-exit 0, hub contract holds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Today strip is now the way into the planner: whole card links to /study with hover states + Open-planner cue; calendar stays on the study tab per user fork. Live click-through verified.
<!-- SECTION:FINAL_SUMMARY:END -->
