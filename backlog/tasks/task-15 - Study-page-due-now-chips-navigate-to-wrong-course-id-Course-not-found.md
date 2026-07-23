---
id: TASK-15
title: Study page due-now chips navigate to wrong course id (Course not found)
status: Done
assignee:
  - '@claude'
created_date: '2026-07-23 15:27'
updated_date: '2026-07-23 16:13'
labels:
  - frontend
  - studying
dependencies: []
references:
  - frontend/src/app/study/page.tsx
  - frontend/src/surfaces/studying/study-planner.tsx
  - frontend/ARCHITECTURE.md
priority: high
type: bug
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On /study, clicking a course chip in the Due-now panel (or a calendar day's breakdown) lands on 'Course not found'. Cause: app/study/page.tsx:10 pushes /courses/${doc} where doc is the LEARN-DOC-KEY from the calendar API, but the /courses/[courseId] route expects the APP-DOCUMENT-ID (Course.id). The two-ID distinction is documented in frontend/ARCHITECTURE.md ('Identifiers — Course.id vs Course.learnDocId'). Observed live 2026-07-23: chip links /courses/d22654c3-… while the real card route is /courses/282c53f0-….

Fix direction: resolve learnDocId → Course.id before navigating (fetch the course list and match learnDocId ?? id), rather than pushing the doc key raw.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking a Due-now course chip opens that course's Course Home
- [x] #2 Clicking a course chip in a selected calendar day's breakdown also opens the right course
- [x] #3 Legacy courses where learnDocId is unset (doc key == app id) still navigate correctly
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. app/study/page.tsx: use useDocuments() (DocumentProvider wraps all routes via root layout) to map the planner's learn-doc-key -> app-document-id before router.push; fallback to the raw key for legacy rows where the two coincide. 2. tsc green. 3. Live verify: PoSD due-now chip (doc d22654c3...) lands on Course Home card 282c53f0...; calendar-day chips too.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified 2026-07-23: Due-now chip for PoSD (learn-doc-key d22654c3...) now lands on /courses/282c53f0... (the app-document-id) — real Course Home, no 'Course not found'. AC2: the calendar-day breakdown chip is the SAME CourseChips/onOpenCourse callback (study-planner.tsx:272 vs :249) — verified at the shared path; no calendar day currently carries scheduled items to click directly. AC3: fallback push(doc) preserves the exact pre-fix behavior, which is correct for legacy rows where learn key == app id; no legacy rows exist in the live DB to exercise.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Study page resolves learn-doc-key -> Course.id via the documents context before navigating (app/study/page.tsx), raw-key fallback for legacy ids. Live-verified chip -> correct Course Home. Commit b0d3a84.
<!-- SECTION:FINAL_SUMMARY:END -->
