---
id: TASK-21
title: >-
  Process chapter list must render the same numbered titles as the course
  outline
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-23 17:11'
labels:
  - frontend
  - backend
  - processing
dependencies: []
priority: medium
type: bug
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-18 (which unified keys/titles/order but not DISPLAY): the course outline renders numberedSectionTitle(numberSections(tree), label, title) — always-numbered, gap-filling — while the Process build list renders the bare title. Python Language Reference shows '1  Introduction' on the course page but 'Introduction' on Process. Fix: /api/chapters units carry the tree node's label; the Process dashboard computes numbers with the SAME numberSections + numberedSectionTitle functions the syllabus tree uses, so the strings are identical by construction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 For every converted doc, each Process chapter row's visible text equals the course outline's top-level rendering (number included)
- [ ] #2 Python Language Reference shows '1  Introduction' (etc.) on both surfaces
- [ ] #3 check_chapter_drift.py also compares labels so display inputs can't drift
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. backend chapter_units: add label: n.get('label'). 2. drift script compares (key,title,label). 3. frontend CourseChapter gains label?; process-dashboard renders numberedSectionTitle(numberSections(minimal nodes), ...) — same fns as syllabus-tree. 4. pytest + tsc + live check on Python Language Reference + FoSA slug chapters.
<!-- SECTION:PLAN:END -->
