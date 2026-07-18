---
id: TASK-10
title: 'Audiobooks: raw text only (drop guided + summary sources)'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-18 01:12'
updated_date: '2026-07-18 01:20'
labels: []
dependencies: []
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove the guided (LLM-scripted) and concepts/summary narration sources from the audiobook pipeline; keep only the raw chapter text source. Strip the source dimension from routes, queue scoping, frontend picker; clean leftover work dirs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Backend chapter_segments/make_audiobook are text-only; guided/concepts code deleted; audiobook jobs no longer take a source
- [ ] #2 Frontend audiobook panel has no source picker; generates/plays raw-text narration
- [ ] #3 Tests + tsc + hub checks green; live smoke: audiobook generate starts on raw text
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. audiobook.py: single text source (chapter_segments text-only; guided/concepts fns + GuidedScript LLM call deleted; paths keep __text suffix for existing files; queue scope keeps ::text for key stability). 2. media_routes: source param dropped from generate/status/timeline/file. 3. gateways: GuidedScript + orphaned AuthoredSet/AuthoredQuestion schemas deleted. 4. Frontend: audiobook.ts + panel source picker removed; narration-bar arity fix. 5. Delete leftover guided checkpoint in volume (126M). 6. Rebuild, live smoke, commit.
<!-- SECTION:PLAN:END -->
