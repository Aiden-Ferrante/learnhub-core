# Changelog

All notable changes to Learn Hub are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions are cut per completed
P→B→T→R cycle (see the vault's Development Protocol) — the tag is the transaction
commit.

## [0.14.0] — 2026-07-26

### Added
- **Skeleton practice** — a course-level structure drill, opened from a new button in the
  course outline toolbar beside Read the book / Guided reading / Concepts. Pick the
  abstraction level on demand instead of following a fixed walk:
  **Chapters** (rebuild the whole book's chapter list — new), **Sections** (rebuild a
  chapter's sections, with their essences), **Concepts** (recall a section's concepts).
- **Sort mode** alongside recall: items are shuffled and dragged into order, then checked
  with per-row "belongs at #N" hints and a score. Sort is **practice-only** — it never
  writes to your schedule, and says so.
- Recall at a structural level self-grades on the shared 1–4 scale and feeds the same
  FSRS skeleton item the reader's chapter walk uses; the book-level list schedules under
  a reserved `book` scope (real section keys are always `toc:*`, so it cannot collide).

## [0.13.0] — 2026-07-26

### Added
- **The review calendar now says what's due, by name.** A "What's due" agenda under the
  grid lists every scheduled item — concept names, chapter headings, type badge, course —
  with **overdue pinned at the top**. Clicking a day filters the agenda; "Show all"
  clears. Previously a due day was only a number in a square and item names weren't in
  the payload at all, so a library whose reviews were all overdue rendered an entirely
  blank calendar. (TASK-25)

### Changed
- **The calendar is laid out as real months** — "July 2026", "August 2026", … each its
  own Monday-aligned grid — instead of one continuous nine-week run. (TASK-25)
- `build_review_calendar` carries item identities (`items[]` per bucket, named via
  heading → concept name → section key) with exact counts and an `itemsTruncated`
  remainder rather than a silent cap.

## [0.12.2] — 2026-07-26

### Added
- **The Today strip on the Courses page now opens the study planner** — the whole
  card links to /study with an "Open planner" cue when items are due. The review
  calendar stays on the study tab (chosen over duplicating it on the shelf). (TASK-24)

## [0.12.1] — 2026-07-26

### Changed
- **Manual time blocks now light the Study activity heatmap** and count toward the
  weekly cadence chip (any-activity days, not only graded ones) — user decision after
  seeing v0.12.0 live. Labels follow the data: "N activities this year", chip tooltip
  "any study activity". (The counts already included passive read/listen events.)

### Fixed
- Section `[...key]` proxy routes now await Next 15's async `params` — runtime was
  fine via the compat shim, but the stale signature failed `tsc` against generated
  route types whenever a build had run.

## [0.12.0] — 2026-07-26

### Added
- **Manual study-time entries** — log, edit, and delete your own time blocks from the
  /study Recent-sessions panel (course, date, start, duration, note). Blocks live in
  their own `manual_sessions` table (the one stored layer over the derived sessions),
  merge into the session list and Time-studied totals, and cascade away with their
  course. The study-event floor, activity heatmap, and cadence chip stay records of
  what actually happened — derived sessions remain read-only. (TASK-22)

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
