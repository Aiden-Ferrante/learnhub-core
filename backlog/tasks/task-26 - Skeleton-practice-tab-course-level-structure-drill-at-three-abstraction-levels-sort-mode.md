---
id: TASK-26
title: >-
  Skeleton practice tab: course-level structure drill at three abstraction
  levels + sort mode
status: Done
assignee:
  - '@claude'
created_date: '2026-07-26 14:54'
updated_date: '2026-07-26 15:04'
labels:
  - frontend
  - studying
dependencies: []
priority: high
type: feature
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Skeleton recall today is chapter-scoped and reachable only from inside the reader's study drawer (chapter-walk.tsx). Lift it to the course level as its own surface, reached from a 'Skeleton practice' button in the course outline toolbar beside Read the book / Guided reading / Concepts.

The user's learning ladder — chapters, then sub-chapters, then concepts — becomes an explicit LEVEL chooser you pick on demand instead of a fixed walk:
  * Chapters  — rebuild the whole book's chapter list (NEW; scope sentinel 'book', real section keys are always toc:* so it cannot collide)
  * Sections  — pick a chapter, rebuild its sections (today's skeleton, with LLM essences)
  * Concepts  — pick a section, recall the concepts it holds

Plus a second MODE alongside simple recall: drag-and-drop SORT — items shuffled, drag into the right order, auto-checked.

User forks (2026-07-26): sort is PRACTICE-ONLY (no FSRS write, no schedule impact); the book-level chapter list IS scheduled like any other skeleton item; all three parts ship in one cycle.

Frontend-only: the typed-review plumbing already keys skeleton rows by (doc, sectionKey) and stores heading/children snapshots, so book-level scheduling needs no backend change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Skeleton practice button sits in the course outline toolbar and opens the surface
- [x] #2 The level chooser offers Chapters / Sections / Concepts, with a scope picker where the level needs one
- [x] #3 Recall mode reveals the correct structure and self-grades on the shared 1-4 scale
- [x] #4 Recall at the Chapters level grades a book-scoped skeleton item that reaches the review queue
- [x] #5 Sort mode shuffles items, supports drag-and-drop reordering, and checks the order
- [x] #6 Sort mode writes nothing to the schedule and says so
- [x] #7 Item labels match the course outline's numbered titles
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. surfaces/studying/skeleton-practice.tsx: level+scope+mode state; items derived from tree (chapters/sections) or fetchSectionConcepts (concepts); essences via fetchSkeleton for the sections level; labels via numberSections/numberedSectionTitle. 2. Recall: hide -> Reveal -> GRADES; submitSkeletonReviewGrade(doc, scope|'book', grade, {heading, chapterScope, children}) for structural levels only. 3. Sort: HTML5 DnD (same pattern as the group sidebar), Check marks correct/misplaced + score, practice-only banner. 4. Hub export + app/courses/[courseId]/skeleton/page.tsx + toolbar button wired through course-home props. 5. tsc/hub/build; live verify all ACs incl. a real book-level grade reaching the queue, then clean up the seeded review row.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified 2026-07-26 on rebuilt :3001. Toolbar now reads Read the book | Guided reading | Concepts · 4 | Skeleton practice; the button opens /courses/<id>/skeleton. Chapters level: 25 items, numbered titles identical to the outline ('1 Introduction', '2 The Nature of Complexity'); Reveal -> Good wrote skel-ce47a23d9f6a4b82 with section_key='book', heading=book title, 25 children, reps=1, due +2d — i.e. the book-scoped item reaches the queue. Sections level: 20 chapters offered, essences render under each section. Concepts level: toc:11 lists the 4 real concepts with their signals and shows 'Drill only — graded concept recall lives in the review queue.' Sort mode: 10 items shuffled out of order, DragEvent reorder moved row 3 to the top, Check order -> '2/10 in place' with per-row 'belongs at #N' hints, rows become non-draggable, and counts before/after were IDENTICAL (3 reviews / 4 events) proving the practice-only contract. BUG FOUND AND FIXED DURING TEST: grading reset the panel — onAnswered -> data.retry refetched the tree, changing the items identity, which re-ran the round-reset effect and wiped the 'Graded' confirmation. Round state is now keyed to the drill (level+scope+mode) and ignores background refetches; re-verified 'Graded — scheduled.' persists. All verification rows deleted afterwards (back to the original 2 reviews / 2 events). tsc real-exit 0, next build 0, hub contract holds, 137 backend tests green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Skeleton practice shipped as a course-level surface: toolbar button -> /courses/<id>/skeleton with a Chapters/Sections/Concepts level chooser and Recall + drag-and-drop Sort modes. Structural recall grades the existing FSRS skeleton item (book level via the reserved 'book' scope, needing no backend change); sort is practice-only by design. Frontend-only. All 7 ACs live-verified.
<!-- SECTION:FINAL_SUMMARY:END -->
