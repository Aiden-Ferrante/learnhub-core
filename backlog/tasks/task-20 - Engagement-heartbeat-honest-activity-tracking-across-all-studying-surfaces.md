---
id: TASK-20
title: 'Engagement heartbeat: honest activity tracking across all studying surfaces'
status: To Do
assignee: []
created_date: '2026-07-23 16:45'
updated_date: '2026-08-05 23:38'
labels:
  - frontend
  - studying
  - reading
  - habit
dependencies:
  - TASK-19
references:
  - frontend/src/gateways/api/progress.ts
  - frontend/src/surfaces/reading/guided-reading/guided-reading.tsx
  - frontend/src/surfaces/reading/book-reader.tsx
  - frontend/src/surfaces/reading/audiobook-panel.tsx
  - backend/app/supplemental/study/sessions.py
priority: high
type: feature
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Activity tracking today under-feeds the event floor: passive engagement has ONE caller in the whole frontend (guided-reading.tsx:212 fires a single 'read' ping on chapter load). The sessionizer (sessions.py) derives duration from event SPREAD inside 25-min-gap clusters, so single-ping surfaces contribute zero minutes — 'time studied' and session history cannot be honest.

DESIGN (approved direction 2026-07-23): one frontend primitive — useEngagementHeartbeat(kind, scope, doc) — that fires an entry ping on mount, then one ping every ~3 minutes while the surface is genuinely active. Active = tab visible (document.visibilityState) AND user interaction (scroll/pointer/key) since the last ping; for audio, active = audio element actually playing (listening with screen off is real studying). Fire-and-forget via existing recordEngagement — no new endpoint, no schema change, no stored session state (gap-clustering already sessionizes retroactively; explicit start/stop events rejected).

INSTRUMENTATION MAP:
- Chapter reader (guided reading): kind 'read', visible+interaction — REPLACES the single load ping
- Book reader: kind 'read', visible+interaction (currently records nothing)
- Audiobook/narration: kind 'listen', while playing (currently records nothing)
- Briefing/orient view: entry ping only, kind 'orient' (brief surface)
- Review/walk/lock-in: unchanged — every grade already writes an event

Emergent property: at ~3-min intervals, 30 min of reading ≈ 10 events ≈ a 10-card review session, so heatmap intensity approximates effort across kinds without weighting logic. Existing kind taxonomy reused (read | listen | orient) — no new kinds. Deliberately does NOT touch mastery/coverage (the 'should studying move coverage?' decision stays open; this supplies the data to make it later).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 useEngagementHeartbeat fires an entry ping on mount and ~3-min pings only while the tab is visible AND the user interacted since the last ping (idle open tab records nothing)
- [ ] #2 Guided reading and book reader record 'read' heartbeats; the old single load ping is replaced
- [ ] #3 Audiobook records 'listen' heartbeats only while audio is actually playing, including with the tab hidden
- [ ] #4 Orient/briefing records one entry ping
- [ ] #5 Review/walk/lock-in surfaces are unchanged (grades remain the only graded writers)
- [ ] #6 End-to-end honesty test: a real ~20-min reading session yields ~7 events, ONE session of ~20 min in the planner, +1 heatmap day, and mastery/coverage unmoved
<!-- AC:END -->
