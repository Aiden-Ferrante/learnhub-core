---
id: TASK-14
title: Drag-and-drop group hierarchy reorganization
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-23 15:17'
updated_date: '2026-07-23 15:59'
labels:
  - frontend
  - library
dependencies: []
references:
  - frontend/src/surfaces/library/group-sidebar.tsx
  - frontend/src/surfaces/library/course-groups.ts
  - frontend/src/surfaces/library/course-shelf.tsx
type: feature
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In the Group sidebar on the Library page, let the user reorganize the group tree by drag and drop: reorder siblings and re-parent a group under another group or back to top level. Groups already support create/rename/delete via the group-actions (⋯) menu; this adds MOVING them. Persist the new hierarchy in the same store used for group create/rename, and reflect it in per-group course counts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dragging a group onto another group re-parents it under that group
- [ ] #2 Dropping a group at the top level un-nests it
- [ ] #3 Reordering sibling groups within the same parent is supported
- [ ] #4 Invalid moves are prevented (a group cannot be dropped into its own descendant)
- [ ] #5 The new hierarchy persists across reloads and course counts update to match
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. course-groups.ts: pure moveGroup(groups, dragId, target) helper — re-parent / un-nest / sibling reorder by array reposition, reject self-or-descendant targets; unit-testable pure fn. 2. group-sidebar.tsx: HTML5 drag on rows (drag handle = row), drop zones: onto-row=re-parent, above/below=sibling reorder, 'All courses'=un-nest; visual indicators. 3. course-shelf.tsx: onMoveGroup mutates groupsState (existing persist effect saves via /api/user-settings). 4. tsc+hub. 5. Live: re-parent, un-nest, reorder, self-descendant rejected, reload persists, counts correct, rename/delete intact.
<!-- SECTION:PLAN:END -->
