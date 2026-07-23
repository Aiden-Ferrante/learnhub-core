---
id: TASK-18
title: Process page chapter list diverges from course outline — unify on one object
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-23 15:35'
updated_date: '2026-07-23 15:54'
labels:
  - frontend
  - backend
  - processing
  - content
dependencies: []
references:
  - backend/app/process/content/chapters.py
  - backend/app/process/content/toc_tree.py
  - frontend/src/surfaces/processing/process-dashboard.tsx
  - frontend/src/gateways/api/chapter.ts
  - frontend/src/surfaces/library/use-course-chapters.ts
priority: high
type: bug
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Process page's document/build list and the course page's syllabus tree render DIFFERENT TOCs for the same book. They must be literally the same object (or derived from one).

CONCRETE EVIDENCE (live 2026-07-23):
- Fundamentals of Software Architecture: course tree (/api/toc-tree) = 28 top-level entries (27 chapters + 'Discussion Questions'); Process build list (/api/chapters) = 54 units — every chapter effectively DUPLICATED because the 'Discussion Questions' subtree is exploded into 27 phantom per-chapter units (keys toc:1~2 … toc:27~2). You can enqueue builds against bogus chapters.
- A Philosophy of Software Design: course tree = 25 (incl. content-less 'Back Cover'); Process list = 24 — 'Back Cover' silently dropped.

ROOT CAUSE: both derive from get_toc_tree(), but backend/app/process/content/chapters.py:chapter_units adds a has_content() gate + content-less-container descent that the syllabus tree (toc_tree.py:get_toc_tree, which returns build_tree_from_outline(_drop_hidden_entries(outline))) does NOT. So /api/chapters (used by the Process dashboard via fetchCourseChapters) and /api/toc-tree (used by the course page's SyllabusTree/ChapterStateStrip) cannot agree by construction. The chapter.ts contract comment CLAIMS /api/chapters is the single canonical derivation 'so surfaces cannot drift' — but it is itself the drift.

FIX GOAL (user's words): the course outline on the Process page and the course outline on the course page are the SAME object / from the same object. Direction options to weigh at PLAN: (a) Process dashboard consumes the toc-tree forest's top-level chapter nodes directly (same object the course page uses) instead of the flat chapter_units derivation; or (b) reconcile chapter_units so it returns EXACTLY the toc-tree's top-level chapters (no has_content drop, no subtree explosion) and route both surfaces through it. Either way: one derivation, both surfaces are views of it.

SEPARATE DATA-QUALITY OBSERVATION (log, maybe own task): FoSA's converted outline has a 'Discussion Questions' top-level node with 27 children keyed toc:N~2 and duplicate-ish chapter titles — a conversion artifact worth a look, but not the same bug as the two-endpoint divergence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 For every ready document, the chapter list shown on the Process page equals the top-level chapters shown by the course page's syllabus tree (same keys, same titles, same count)
- [ ] #2 FoSA shows the same chapter count on both surfaces (no ~2 phantom-chapter duplication in the build list)
- [ ] #3 PoSD's content-less entries (e.g. Back Cover) are handled identically on both surfaces
- [ ] #4 There is ONE server-side derivation of a course's chapters; both surfaces consume it (documented in the chapter.ts / chapters.py contract comments)
- [ ] #5 Enqueuing a build from the Process page can only target a real chapter that exists in the course outline
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Direction (b) from cycle plan, approved: 1. chapter_units returns EXACTLY the visible toc-tree's top-level nodes (same keys/titles/order) + hasContent flag per unit (scope_blocks probe); legacy has_content-gate + container-descent deleted (parts stage already demotes Part containers at convert). 2. frontend CourseChapter type gains hasContent?; Process dashboard disables Build/Schedule when hasContent===false instead of hiding rows. 3. Drift-proof pytest: chapter_units keys/titles == toc-tree top-level on a fixture incl. content-less node + container-with-content-children (the FoSA shape). 4. Live diff script scripts/check_chapter_drift.sh across all ready docs. 5. Live: FoSA 54->28, PoSD 24->25 w/ Back Cover build-disabled.
<!-- SECTION:PLAN:END -->
