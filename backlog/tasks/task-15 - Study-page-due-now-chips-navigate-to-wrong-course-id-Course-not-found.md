---
id: TASK-15
title: Study page due-now chips navigate to wrong course id (Course not found)
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-23 15:27'
updated_date: '2026-07-23 15:53'
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
- [ ] #1 Clicking a Due-now course chip opens that course's Course Home
- [ ] #2 Clicking a course chip in a selected calendar day's breakdown also opens the right course
- [ ] #3 Legacy courses where learnDocId is unset (doc key == app id) still navigate correctly
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. app/study/page.tsx: use useDocuments() (DocumentProvider wraps all routes via root layout) to map the planner's learn-doc-key -> app-document-id before router.push; fallback to the raw key for legacy rows where the two coincide. 2. tsc green. 3. Live verify: PoSD due-now chip (doc d22654c3...) lands on Course Home card 282c53f0...; calendar-day chips too.
<!-- SECTION:PLAN:END -->
