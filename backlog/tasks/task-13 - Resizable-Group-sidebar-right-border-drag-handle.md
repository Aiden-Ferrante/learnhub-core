---
id: TASK-13
title: Resizable Group sidebar (right-border drag handle)
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-23 15:17'
updated_date: '2026-07-23 15:57'
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
- [ ] #1 A drag handle on the sidebar's right edge resizes its width; no other edge is draggable
- [ ] #2 Width is clamped to a sensible min/max so neither the sidebar nor the course shelf grid can collapse
- [ ] #3 A horizontal-resize cursor appears on hover over the right border
- [ ] #4 The chosen width persists across page reloads
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. group-sidebar.tsx: width-styled wrapper + 6px right-edge drag handle (pointer events, col-resize cursor), clamp 200-440px, persist localStorage 'learnhub_group_sidebar_width' (device pref, not user-settings). 2. tsc+hub check. 3. Live: drag works right-edge-only, clamps, persists across reload, grid reflows.
<!-- SECTION:PLAN:END -->
