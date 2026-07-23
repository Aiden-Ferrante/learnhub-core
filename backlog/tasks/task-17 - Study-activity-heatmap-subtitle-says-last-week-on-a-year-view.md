---
id: TASK-17
title: Study activity heatmap subtitle says 'last week' on a year view
status: Done
assignee: []
created_date: '2026-07-23 15:27'
updated_date: '2026-07-23 15:52'
labels:
  - frontend
  - library
dependencies: []
references:
  - frontend/src/surfaces/library/study-heatmap.tsx
priority: low
type: bug
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The activity heatmap's hover subtitle reads 'Days with at least one graded review in the last week' (surfaces/library/study-heatmap.tsx:116) but the heatmap renders a full year of cells. Shared by Course Home and /study. Fix direction: correct the copy to describe the actual window.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The subtitle/tooltip copy matches the rendered window on both Course Home and /study
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Re-verified during planning 2026-07-23: the 'last week' copy is the title tooltip of the cadence chip ('N/7 days this week', study-heatmap.tsx:116) — a 7-day stat correctly describing itself, not the year grid. Original observation misread the a11y tree (title attr surfaced as a bare generic next to the heading). No code change needed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed as not-a-bug: copy belongs to the 7-day cadence chip and is accurate; approved for closure in the v0.11.0 cycle plan review.
<!-- SECTION:FINAL_SUMMARY:END -->
