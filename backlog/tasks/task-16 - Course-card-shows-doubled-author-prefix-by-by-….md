---
id: TASK-16
title: Course card shows doubled author prefix ('by by …')
status: Done
assignee:
  - '@claude'
created_date: '2026-07-23 15:27'
updated_date: '2026-07-23 16:13'
labels:
  - frontend
  - library
dependencies: []
references:
  - frontend/src/surfaces/library/courses.ts
priority: low
type: bug
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Fluent Python course card on /courses reads 'by by Luciano Ramalho'. surfaces/library/courses.ts:26 always prepends 'by ' to the author parsed from the document name, but some raw filenames already contain a 'by' (cleanCourseTitle passes it through). Fix direction: strip a leading 'by ' from the parsed author (case-insensitive) before prefixing — or make cleanCourseTitle own the normalization.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A document whose parsed author already starts with 'by' renders a single 'by Author' on the card
- [x] #2 Authors without the prefix are unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. cleanCourseTitle (kit/lib/course-title.ts): strip leading 'by ' (case-insensitive) from the parsed author segment so courses.ts's 'by ${author}' prefix cannot double. 2. tsc + build green. 3. Live verify on rebuilt :3001 - Fluent Python card reads single 'by Luciano Ramalho'.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Live-verified on rebuilt :3001 2026-07-23: Fluent Python card renders 'by Luciano Ramalho' (single prefix); all other authors unchanged (Ousterhout, Richards/Ford, Huyen, Beaulieu). tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
cleanCourseTitle now strips a leading 'by ' from the parsed author segment (course-title.ts); verified live on the shelf — single 'by' on the affected card, others untouched. Commit b7241ce.
<!-- SECTION:FINAL_SUMMARY:END -->
