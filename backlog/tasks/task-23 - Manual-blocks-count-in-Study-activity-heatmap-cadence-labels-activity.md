---
id: TASK-23
title: 'Manual blocks count in Study activity heatmap + cadence (labels: activity)'
status: Done
assignee:
  - '@claude'
created_date: '2026-07-26 13:43'
labels:
  - frontend
  - backend
  - studying
dependencies: []
priority: medium
type: enhancement
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User decision after seeing v0.12.0 live (reversal of the original 'graded-only heatmap' fork): manual time blocks light the heatmap on their start day and the cadence chip counts ANY-activity days. Labels relabeled reviews->activity for honesty (counts already included passive read/listen events).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A manual block shades its day on the heatmap with byKind manual
- [ ] #2 Cadence chip counts any-activity days in the trailing 7 (key renamed activeDays)
- [ ] #3 Labels read 'N activities this year' / 'N activities · date' / 'any study activity' tooltip
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
compute_activity merges fetch_manual_rows (+1 per block on UTC start day); cadence graded_days->active_days over ALL activity. Unit test test_compute_activity_counts_manual_blocks (133 total green). Live-verified: /api/activity shows 2026-07-26 count 1 + byKind manual + cadence {activeDays:1}; UI shows shaded cell '1 activity · 2026-07-26', '3 activities this year', chip '1/7 days this week' w/ new tooltip. In passing: fixed pre-existing Next-15 async-params mismatch in section [...key] proxy routes that poisoned the tsc gate (df61380).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Heatmap + cadence now count manual blocks; labels say activity. Verified live + unit test. Commits df61380 + heatmap commit; tag v0.12.1.
<!-- SECTION:FINAL_SUMMARY:END -->
