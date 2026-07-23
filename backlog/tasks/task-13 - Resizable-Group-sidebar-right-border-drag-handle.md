---
id: TASK-13
title: Resizable Group sidebar (right-border drag handle)
status: Done
assignee:
  - '@claude'
created_date: '2026-07-23 15:17'
updated_date: '2026-07-23 16:13'
labels:
  - frontend
  - library
dependencies: []
references:
  - frontend/src/surfaces/library/group-sidebar.tsx
  - frontend/src/surfaces/library/course-shelf.tsx
type: enhancement
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On the Library page, the Group sidebar (surfaces/library/group-sidebar.tsx, mounted in course-shelf.tsx) is fixed-width. Let the user resize its width by dragging its RIGHT border only, and persist the chosen width across reloads (localStorage, same as saved group state).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A drag handle on the sidebar's right edge resizes its width; no other edge is draggable
- [x] #2 Width is clamped to a sensible min/max so neither the sidebar nor the course shelf grid can collapse
- [x] #3 A horizontal-resize cursor appears on hover over the right border
- [x] #4 The chosen width persists across page reloads
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. group-sidebar.tsx: width-styled wrapper + 6px right-edge drag handle (pointer events, col-resize cursor), clamp 200-440px, persist localStorage 'learnhub_group_sidebar_width' (device pref, not user-settings). 2. tsc+hub check. 3. Live: drag works right-edge-only, clamps, persists across reload, grid reflows.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified 2026-07-23 via pointer-event drive on :3001: drag right handle 224->344px applied + persisted (localStorage learnhub_group_sidebar_width); clamp proven at both extremes (1200px drag -> 440 saved, -800px -> 200); exactly ONE separator element exists (right edge only); width 344 restored after reload. cursor:col-resize confirmed via computed style.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Right-border drag handle on the sidebar wrapper (pointer capture, 200-440px clamp, localStorage persistence); sidebar component stays width-blind. Live-verified drag/clamp/persist/reload. Commit 6f0dfb9.
<!-- SECTION:FINAL_SUMMARY:END -->
