---
id: TASK-8
title: Handle Part-structured TOCs (parts then chapters)
status: Done
assignee:
  - '@claude'
created_date: '2026-07-17 22:32'
updated_date: '2026-07-17 22:46'
labels: []
dependencies: []
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FoSA-style bookmarks nest chapters under "Part I/II/III" containers at depth 0, so every depth-0-equals-chapter consumer (syllabus tree, reader chapter picker, syllabus Build pills, chapter spans) sees 3 parts instead of 24 chapters. Add a `parts` stage to toc_controller: detect depth-0 part-titled containers with children, hide them (`part-container` stored flag, same as curate) and promote each subtree one level so chapters land at depth 0. Logged in the decision log. Backfill the already-converted FoSA doc.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Converting a book with Part containers yields chapters at depth 0; part nodes stored hidden with reason part-container
- [x] #2 Decision log names the demoted parts (parts: demoted N ...)
- [x] #3 Books without parts are byte-identical (PoSD fixture behavior-lock stays green); childless orphan-Part rule unchanged
- [x] #4 Frontend chapter pickers skip hidden entries; FoSA syllabus shows real chapters after backfill
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. toc_controller: HIDE_PART constant + demote_part_containers(entries) pure fn (detect depth-0 part-titled entries with children; hide container, listDepth-1 for subtree; log line). 2. Wire into resolve_toc after canonicalize and after normalize path; curate_outline gains pre_hidden param so demoted parts are not re-flagged orphan. 3. Backend tests (demote unit + resolve integration + fixture lock green). 4. Frontend toc.ts chaptersFromOutline skips hiddenReason entries. 5. Backfill FoSA raw_structure (depth/parent/hidden) + append ledger decision line. 6. Rebuild learn+app, live verify syllabus/chapters. 7. Commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Controller stage + tests done (122 passed incl. PoSD behavior-lock). Frontend: chaptersFromOutline skips hiddenReason; OutlineEntry typed. Unblocked a pre-existing tsc error in use-shift-select (newer @types/react from parallel npm install): handleItemClick now takes structural ModifierKeys instead of React.MouseEvent. Rebuilding images; FoSA backfill script ready in scratchpad.

Verification: resolve_toc integration test proves part demotion end-to-end; 122 backend tests pass incl. PoSD fixture behavior-lock. Live: FoSA backfill updated 351 raw_structure rows; toc-tree API returns 28 real chapters at top level, hiddenParts=[Part I/II/III]; ledger decision log carries the backfilled parts line; PoSD tree unchanged. Also fixed pre-existing tsc break (use-shift-select ModifierKeys) surfaced by parallel npm install.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a parts stage to the TOC controller: depth-0 Part containers with children are hidden (part-container stored flag) and their subtrees promoted one level, so real chapters land at depth 0 everywhere. Decision-logged; frontend chapter pickers skip hidden entries; FoSA backfilled in place and verified live; part-less books byte-identical per PoSD behavior-lock.
<!-- SECTION:FINAL_SUMMARY:END -->
