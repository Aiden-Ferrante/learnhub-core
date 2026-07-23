# Changelog

All notable changes to Learn Hub are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions are cut per completed
P→B→T→R cycle (see the vault's Development Protocol) — the tag is the transaction
commit.

## [0.11.1] — 2026-07-23

### Fixed
- **Process chapter rows now show the course outline's exact numbered titles**
  ("1  Introduction", not "Introduction") — units carry the tree node's label and
  the dashboard renders through the same `numberSections`/`numberedSectionTitle`
  functions the syllabus tree uses, so the strings are identical by construction
  (including synthesized numbers for slug chapters). The drift script compares
  labels too. (TASK-21, follow-up to TASK-18)

## [0.11.0] — 2026-07-23

Frontend QOL sweep — sub-cycle B of the Road to 1.0. Six tasks: five shipped,
one closed not-a-bug. Every fix live-verified on the deployed stack; details and
evidence in the Backlog tasks (TASK-13…18).

### Fixed
- **Study page due-now/calendar chips navigated to "Course not found"** — the
  planner keys courses by learn-doc-key but the `/courses/[courseId]` route wants
  the app-document-id; chips now resolve the id before navigating. (TASK-15)
- **Process build list disagreed with the course outline** — `/api/chapters` is
  now EXACTLY the syllabus tree's top level (same keys/titles/order) with a
  `hasContent` flag, instead of its own re-derivation. FoSA dropped from 54
  phantom build units to its real 28 chapters; PoSD's "Back Cover" is listed
  build-disabled instead of silently missing. Guarded by drift-proof unit tests
  and `scripts/check_chapter_drift.py` (live diff across all converted docs).
  (TASK-18)
- Course cards no longer double the author prefix ("by by Luciano Ramalho").
  (TASK-16)

### Added
- **Group sidebar is resizable** via a right-border drag handle (200–440 px,
  width persisted per device). (TASK-13)
- **Group hierarchy reorganizes by drag and drop** — drop onto a group to
  re-parent, next to one to reorder siblings, onto "All courses" to un-nest;
  drops into a group's own subtree are rejected. (TASK-14)

### Changed
- Group sibling order is now manual (array order) rather than forced
  alphabetical — required for drag-to-reorder; existing groups were re-sorted
  alphabetically once as the new baseline. (TASK-14)

### Closed without change
- "Study activity heatmap subtitle says last week on a year view" — the copy is
  the 7-day cadence chip's own tooltip and is correct. (TASK-17)
