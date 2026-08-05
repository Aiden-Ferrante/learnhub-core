---
id: TASK-19
title: 'Event-floor hygiene: require doc on study-event writers, log write failures'
status: To Do
assignee: []
created_date: '2026-07-23 16:44'
updated_date: '2026-08-05 23:38'
labels:
  - backend
  - study
  - habit
dependencies: []
references:
  - backend/app/supplemental/study/mastery.py
priority: medium
type: bug
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two latent defects in the study_events writers (supplemental/study/mastery.py record_grade_event + record_engagement), to fix BEFORE heartbeat instrumentation multiplies event volume:

1. doc is optional and doc-less rows are counted in EVERY course scope by _fetch_events ('OR doc IS NULL' back-compat branch). Any doc-less write inflates all courses' heatmaps at once. Live DB has ZERO doc-less rows (2 events total, both tagged), so the branch protects nothing — make doc effectively required at the writers and drop the read-side NULL branch.
2. Both writers swallow ALL exceptions silently ('except: pass'). Keep the never-break-study-flow contract but emit one log line on failure — with heartbeats, silent schema drift would otherwise erase weeks of history invisibly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A study event without a doc is not written (skipped like the existing no-section_key case), and the skip is logged
- [ ] #2 _fetch_events no longer includes doc-IS-NULL rows in per-course scopes (branch removed; verified safe against live data first)
- [ ] #3 Writer failures emit one log line while still never raising into the study flow
- [ ] #4 Existing pytest suite green; a unit test covers the doc-required skip
<!-- AC:END -->
