---
id: TASK-21
title: >-
  Process chapter list must render the same numbered titles as the course
  outline
status: Done
assignee:
  - '@claude'
created_date: '2026-07-23 17:11'
updated_date: '2026-07-23 17:16'
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
- [x] #1 For every converted doc, each Process chapter row's visible text equals the course outline's top-level rendering (number included)
- [x] #2 Python Language Reference shows '1  Introduction' (etc.) on both surfaces
- [x] #3 check_chapter_drift.py also compares labels so display inputs can't drift
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. backend chapter_units: add label: n.get('label'). 2. drift script compares (key,title,label). 3. frontend CourseChapter gains label?; process-dashboard renders numberedSectionTitle(numberSections(minimal nodes), ...) — same fns as syllabus-tree. 4. pytest + tsc + live check on Python Language Reference + FoSA slug chapters.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified 2026-07-23 on rebuilt :3001: Python Language Reference renders '1  Introduction' / '2  Lexical analysis' / '3  Data model' BYTE-IDENTICAL on Process and the course syllabus tree; FoSA gap-fill case matches too (slug 'Chapter 6...' takes synthesized 6, 'Discussion Questions' = 28). Mechanism: units carry the tree label; dashboard renders via the same numberSections+numberedSectionTitle. Drift script now compares labels (all 6 docs OK, exit 0). 126 tests pass incl PG tier. Also fixed a lying test gate: tsc exit code was being read from tail; stale .next/types was masking nothing real (clean tsc after cache clear).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Process chapter rows now render the course outline's exact numbered titles via the same numbering functions; verified byte-identical live on two books incl the synthesized-number case. Commit follows TASK-18's contract.
<!-- SECTION:FINAL_SUMMARY:END -->
