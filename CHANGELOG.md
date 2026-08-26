# Changelog

All notable changes to Learn Hub are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions are cut per completed
P→B→T→R cycle (see the vault's Development Protocol) — the tag is the transaction
commit.

## [Unreleased]

## [0.17.0] — 2026-08-26

Deleting a book now removes the book.

### Fixed
- **Deleting from the Processing tab did nothing.** It removed the row from the
  screen and toasted success; the book stayed on disk with every row intact. It
  calls the backend now, and a card whose delete failed stays on screen and stays
  selected — that card is what you point at to try again.
- **A half-finished delete could leave a book in pieces.** The whole removal runs
  in one transaction, and files come off disk only after it commits — the other
  order destroys a book's PDF and figures even when the database work rolls back.
- **Audiobooks were never removed** with the book they narrate.
- **A re-convert could strand concepts** anchored to no outline node: they survived
  naming a section that no longer existed, unreachable by every scope query while
  still counting toward coverage.
- **Errors during a delete were swallowed.** The removal runs inside a transaction,
  where the first failure poisons everything after it — so a delete that removed
  nothing reported success.

### Added
- `origin` is constrained at the database. It decides which version cannot be
  deleted and which one the main-version fallback picks, and one typo would have
  made a book's canonical version deletable.
- Deleting a course takes two deliberate clicks. It destroys that course's outline
  and everything studied against it, and sat behind one unguarded click next to
  the row that merely *switches* course.
- The shelf's delete dialog names the sibling courses it will destroy. Deleting a
  book takes every course cut from it; the card shows one name.
- Tests for the delete paths, which had none.

## [0.18.0] — 2026-08-26

The background queue stopped reporting work it did not do.

### Fixed
- **The same job could run twice.** Claiming a job was a separate write from
  selecting it, and that write swallowed its own failures — lose it and the row
  stayed queued for the next poll to hand out again, running the same conversion
  a second time with nothing anywhere saying so. Selecting and claiming are now
  one statement.
- **A conversion that failed could leave a book stuck "converting" forever.**
  Three exits from the converter never marked the document: a missing file, a
  cancel, and any unanticipated error. Such a book is invisible on the shelf,
  permanently mid-flight, and still holds its content hash — so re-uploading it
  deduped onto the corpse. Two of these were sitting in the library.
- **An extraction where every section failed reported success.** A chapter whose
  every section timed out looked exactly like a chapter that teaches nothing.
  Partial failure still succeeds.
- **A failed skeleton was remembered as a real one.** When the model call failed,
  every essence came back empty and the result was cached with the current prompt
  version — which is what the regenerate check keys on, so one bad call became
  that chapter's permanent skeleton.
- **A code comment could become a chapter.** A `#` inside a fenced code block was
  read as a heading, chopping the block mid-listing and feeding extraction half a
  code sample under a heading the author never wrote. 11 of 12 books in the
  library contain fenced code.
- **Titles underlined with `===` or `---` were lost.** Setext headings had no
  handling at all, so the title became body text of the section before it and a
  real chapter vanished from the outline.
- Cancelling now says *which* kind of nothing it found: a request naming the wrong
  job kind used to be told the job did not exist while it was running.

### Changed
- Interrupted jobs get an attempt cap and an exponential backoff, and are settled
  as errors rather than retried forever. The worker runs one job at a time, so an
  uncapped retry loop does not just retry one job — it stops every other job.

## [0.16.0] — 2026-08-25

Audiobooks stopped being too slow to use. The speedup is the headline, but the
check that mattered was the other one: a 82M-parameter model had to still sound
right reading textbook prose thick with symbols, and that was auditioned by ear
before the version was cut, not after.

### Changed
- **Narration is Kokoro-82M, not Orpheus** — the same chapter renders in **5.6s
  instead of 132.7s**, about 50× realtime. Tuning the old stack (2 → 8 Ollama
  slots, and `AUDIOBOOK_TTS_WORKERS`, which had been defaulting to 2 while the
  server offered more) had already taken a one-hour chapter from ~53 to ~25
  minutes, and that lever was spent: scaling is sublinear and oversubscription
  reverses it. The rest of the cost was structural. Orpheus is a 3B
  autoregressive LLM emitting seven audio tokens per frame, so every frame of
  audio pays a full transformer decode on a bandwidth-bound chip; SNAC decode was
  only 7% of wall time. Concurrency hides that latency, it does not reduce the
  work. Full numbers and the alternatives considered are in
  [ADR 0002](docs/adr/0002-kokoro-replaces-orpheus-tts.md).

### Removed
- **The checkpoint/resume subsystem.** A chapter that renders in six seconds does
  not need to survive an interruption, so the layer was pure cost — and it had a
  bug of its own: a chunk that synthesized to silence was saved as a valid
  checkpoint and never retried, so a sentence went missing for good.

### Fixed
- The Kokoro weights and spaCy's `en_core_web_sm` were both fetched **on first
  use, mid-render** — a runtime network dependency in a keyless-local system, and
  about 15s on the first narration. Both are baked into the image now, with a
  startup warm-up.

## [0.15.0] — 2026-08-25

One arc: a textbook's own table of contents is not always the best course, so a
book can now carry several of your own — each with its own outline, its own cut
of the material, and its own progress. Released alongside it: everything else
that had accumulated unreleased since v0.14.0 — the ingest and TOC work of
2026-08-20, the fleet look, and the audit's first repair pass.

### Added
- **Custom course versions** — several named courses over one book, with the
  TOC-derived default still available. Material is **shared, never copied**, so
  distilling a course deletes mapping rows rather than text and the book keeps
  every word. Concepts are **inherited, not re-extracted**: a re-cut course sees
  the concepts of whatever source sections its material came from, with no
  extraction run to pay for. Tracking splits the way the three-question model
  already did — coverage per version, retention per book — so a concept you have
  learned stays learned however you re-cut the outline, while skeleton drills
  quiz the outline in front of you.
- **Version switcher** in the course toolbar — shows which cut of the book you
  are studying, lists the others, and creates new ones. Picking a version makes
  it the book's main one; there is deliberately no "viewing but not main" state,
  so the course you switch to is the course you come back to. Creating a version
  switches to it.
- **Material editing** — the words a course teaches from are editable, and every
  save answers one question: is this a fix to the **book** (writes the shared
  text, every course cut from it sees the fix — for conversion damage like
  `Complexity dened`), or **your wording for this course** (copy-on-write, so the
  book and the other courses keep the original and a later book fix does not
  overwrite your rewrite). Edits address a block, never a document. Staleness is
  derived rather than stored — a section is stale when its material was edited
  after its concepts were built — and a section with no concepts reads as
  unbuilt, not stale. Rebuilding stays manual, because a chapter pass is minutes
  of local model time and should not ambush a typo fix.
- **Outline editing** — which chapters exist, how they nest, what order they run
  in, and which of the book's blocks sit under each. Deleting a section never
  deletes its material: the blocks become **unplaced** and surface in their own
  panel, to be re-filed or dropped from the course deliberately. That is the
  difference between distilling and losing things. Removing sections is refused
  on the default course, whose tree is the book's canonical one that every other
  course's concepts anchor to; renaming, reordering and nesting are safe
  everywhere. Indent/outdent/up/down rather than drag-and-drop, because
  restructuring a 150-section book is precision work.
- **Editing in the reader's own rendering** — material renders through the
  reader's own component, theme and prose settings, with an Edit handle on each
  block. The page is not a preview of the course; it is the course, with
  handles. The outline editor shows the numbers the syllabus will actually
  render, live, as rows move.
- **Authored markdown is a real upload format**, not just rendered PDFs. The
  upload UI had advertised `.md` and a drop even minted a card, so markdown
  *looked* supported — but non-PDF files went to pure client state: no backend
  row, no structure, no concepts. An inert card. The conductor now picks a
  converter by file extension and is otherwise format-blind, so there is no new
  job kind and jobs queued before this still run. Markdown gets the `light` math
  profile deliberately: the `full` heuristics exist to repair pymupdf extraction
  damage and would actively corrupt clean source, rewriting `≤` into a literal
  `\leq` outside any equation. A file with no heading at all now fails loudly
  rather than ingesting to zero blocks and reporting success.
- **The fleet look and the app switcher** — Learn Hub adopts the shared palette,
  follows the OS theme, carries the fleet header's switcher to the other apps,
  and exposes a `{ok, checks, freshness}` health endpoint probed where it can
  actually fail.

### Changed
- **A book that numbers its own headings has already written its table of
  contents down** — `# 1`, `## 1.1`, `### 1.1.2` — so a new
  `from-numbered-headings` strategy reads it and does nothing else: no font
  clustering, no page heuristics, no guessing levels from `#` depth. It runs
  ahead of every other derive strategy, because they are all recovery passes for
  documents that did not state their structure. The old text pass clamped every
  heading to three levels and promoted all of them, returning 81 entries where
  the author wrote seven chapters — correct when levels are guesses, wrong when
  they are stated. Reconcile follows the same rule and maps blocks by number
  prefix; the previous title-matching pointer let one chapter that named its own
  sub-chapters burn every entry, collapsing 67 of 81 blocks into the final
  section, which then fed extraction 558 characters of the wrong chapter. A
  heading numbered deeper than three levels is treated as content, not
  structure: still stored, still read, still extracted from — just not a node in
  the syllabus.
- **Extraction runs per section, not per content block.** `write_section_concepts`
  is idempotent per *section* — it deletes everything under `(doc, section_key)`
  before inserting — but the orchestrator called it once per *block*, so on a
  multi-block section each write wiped the one before it. A 15-block chapter
  reported one extracted concept and stored zero, because the block that found it
  was not the last to write. Results now collapse into one write per section,
  deduplicated by name and sorted by document index (they had been appended in
  async completion order, which would have made first-occurrence-wins
  nondeterministic). The larger cost was one LLM call per block; a section's
  blocks are now merged into one unit, which is what the 60,000-character
  extraction valve always implied.
- `raw_documents` used to mean both the book and the course. Those split:
  `sources` is the book, `raw_documents` is a course **version** over it, and a
  new mapping table records which of the book's blocks a version keeps and where.
  Both migrations are identity backfills — no row moved and no id changed.
- Every block read goes through one module, because a bare query against the
  book's content now reads the whole book and ignores a version's cut.
- `raw_content.structure_id` is gone: with content owned by the book, a foreign
  key into one version's tree meant rebuilding that tree would cascade-delete the
  book's text.

### Fixed
- **A book got its card at second zero, not 19 minutes later.** The course card
  was minted only after the browser polled a conversion to completion — 19
  minutes for a 410-page book — so any reload, closed tab, or 15-second blip in
  that window lost the card for good while the learn service finished the book
  anyway. The result was a course that existed in `raw_documents` and nowhere on
  the shelf, with nothing to reconcile the two. The conversion endpoint had
  always returned the id at second zero and thrown it away. Losing the tab now
  only delays the flip.
- **A duplicate heading could kill a whole conversion.** Section keys are unique
  per document by construction (`raw_structure.id` is `doc_id::section_key`), and
  the page-matched path did not uniquify them, so a book that repeats a heading
  collided on insert and took the entire conversion down with it.
- **A running job could not be stopped**, and the UI would not name the kind that
  was running. Whole-document jobs are cancellable, and a deleted document's jobs
  stop with it.
- The version switch only half-propagated — the syllabus and mastery followed it
  while the reader, concepts, heatmap, audiobook and skeleton practice read the
  card's stored id and stayed on the book. The course hook now returns a course
  whose document id **is** the active version, so all of them follow from one
  override instead of fifteen call sites each learning about versions.
- The shelf reported 0 concepts for any book whose main course is a custom cut:
  concept counts grouped by the book while the shelf row is the version's id.
  Counting now runs through the material mapping, so a distilled cut honestly
  shows fewer.
- The Next proxy forwarded only GET/POST/DELETE, so renaming a version and
  setting it as main would have failed; its PATCH helper then forwarded query
  parameters but not the body, which material edits need.

<!-- v0.15.0 — Say what you did. The audit's first sub-cycle: everywhere the app
     answered confidently and wrongly instead of admitting it did not know. -->
- **Passive study was never recorded.** `/api/engagement` passed the whole request
  body as one argument to a four-parameter function, so every call since it shipped
  raised a `TypeError` — and the client fires it and forgets, so nothing said so.
  `study_events` has only ever held graded rows, which quietly emptied the
  read/listen bars, the by-kind split and the cadence chip.
- **A re-cut course served no concept cards at all.** The review queue filtered the
  book's concepts against the *version's* section keys — two keyspaces that never
  intersect — so a chapter with forty due cards reported "all caught up". The span
  is translated now, the way the chapter snapshot beside it always did.
- **Custom versions saw none of their book's concepts or figures.** Five reads keyed
  `ext_concepts` and `raw_elements` — both book-scoped — by a version id. Skeletons
  were generated with no concepts to ground them and cached anyway; the quality gate
  scored nothing and looked disabled; figure lists came back empty while
  `/api/figure` happily served the bytes. All five now go through the one place that
  decision lives.
- **A slug-keyed chapter was one block long.** A scope with no derivable level hit a
  terminator that fired on the very next block. It now runs to the next real heading.
  Numbered chapters are unchanged.
- **`toc:1.2~2` was not inside `toc:1`.** Section keys carry a `~n` suffix whenever a
  book repeats a heading, and the ancestor check did not know that while the chapter
  lookup did — so the reader and the concept buckets disagreed about the same key.
- **A database blip read as "you have studied nothing".** Mastery's two loaders
  returned an empty dict on any error, rendering a season of study as a brand-new
  course with a 200. Three tracking endpoints returned a bare dict, so a failure
  reached the client as success, and a failed review-debt read displayed as
  "Caught up" — the one wrong answer that talks you out of your reviews. It now
  says "—", and unknown is a distinct state from zero throughout.
- **Switching courses could show the previous course's numbers.** Coverage and
  retention persisted through a switch on failure, and a slow response could land on
  top of a newer one. Both are checked against the course actually on screen.
- **Any API path ending `.js`, `.css` or `.map` skipped authentication.** The
  middleware's static-asset exemption was anchored on the whole path, not the asset
  directories, and no route does its own check — and the tenancy resolver then failed
  *open* onto the primary schema. Section and concept keys are model-generated strings
  that reach `{key:path}` routes, so this was reachable rather than theoretical.
- **The audiobook endpoint could be walked out of its own directory** — `?doc=` was
  joined into a path unvalidated, and an absolute segment discards everything before
  it. Also: signing in could redirect off-site via `?from=`.
- The cadence chip could report "8/7 days this week": a rolling 604800-second window
  compared against calendar days spans eight of them unless you study at midnight UTC.

### Not verified
- None of the above has been exercised in a browser — `:3001` sits behind a login
  wall, so every interactive flow (opening the menu, creating, switching,
  deleting, and both editors) is unexercised. Behaviour was verified against the
  live database instead, with content snapshots across three books byte-identical
  before and after.
- Reading position is keyed to the course card, so it is shared across versions;
  a shelf card still shows the book's original section count rather than the
  active version's.
- The custom-version review queue **was** driven end to end against a real
  converted book before this version was cut (2026-08-25): a re-cut course serves
  the same 54 cards as its Default, inherits 605 concepts with no extraction run,
  and after distilling four blocks reports 588 concepts and 37 cards rather than
  collapsing to zero — while the book keeps all 291 of its blocks. Figures
  inherit too (1,144 on a book that has them). Study state was byte-identical
  before and after.
- `test_toc_controller.py` was red and had been since `bcb89f7`; it is green now.
  The code's `derived-numbering` was the intended contract and the tests were
  stale — and a third failure, added later by the duplicate-key fix, was pinning
  the very defect that fix removed. Repairing them surfaced a real finding that
  is recorded as a strict xfail rather than quietly fixed: a book whose chapters
  read "Chapter 2 …" carries no `number_key` on them, so the numbered route skips
  them and builds an outline with no chapters at all. Not live-affecting — both
  library books on that route number their chapters plainly.
- The documented test command never mounted `backend/conftest.py`, which is not
  in the image, so the `integration` marker went unregistered and the eight
  Postgres tests errored instead of skipping — about 240 seconds of noise that
  read as environment trouble rather than as a broken gate.

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
