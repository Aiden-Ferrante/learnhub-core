---
id: TASK-14
title: Drag-and-drop group hierarchy reorganization
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
- [x] #1 Dragging a group onto another group re-parents it under that group
- [x] #2 Dropping a group at the top level un-nests it
- [x] #3 Reordering sibling groups within the same parent is supported
- [x] #4 Invalid moves are prevented (a group cannot be dropped into its own descendant)
- [x] #5 The new hierarchy persists across reloads and course counts update to match
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. course-groups.ts: pure moveGroup(groups, dragId, target) helper — re-parent / un-nest / sibling reorder by array reposition, reject self-or-descendant targets; unit-testable pure fn. 2. group-sidebar.tsx: HTML5 drag on rows (drag handle = row), drop zones: onto-row=re-parent, above/below=sibling reorder, 'All courses'=un-nest; visual indicators. 3. course-shelf.tsx: onMoveGroup mutates groupsState (existing persist effect saves via /api/user-settings). 4. tsc+hub. 5. Live: re-parent, un-nest, reorder, self-descendant rejected, reload persists, counts correct, rename/delete intact.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified 2026-07-23 via DragEvent drive against the real /api/user-settings store: re-parent (Tactical -> into Strategic; server state shows parentId set), un-nest (drop on 'All courses' -> ROOT), sibling reorder (ML Math dropped in top quarter -> first in array), self-descendant guard (Strategic into its own child Machine Learning -> state unchanged), reload -> tree + counts persist, 6 group-action menus intact (rename/delete live). NOTE for review: sibling order is now ARRAY order, not alphabetical — buildGroupTree's forced localeCompare sort was removed because manual reordering cannot coexist with it; existing groups were re-sorted alphabetically once as a baseline.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Drag-and-drop over the group tree: onto=re-parent, edges=sibling reorder, 'All courses'=un-nest; pure moveGroup() guards invalid moves; persists through the same user-settings state as rename/delete. All five ACs live-verified against the server store. Commit 862f0b9.
<!-- SECTION:FINAL_SUMMARY:END -->
