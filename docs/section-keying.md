# Section keying: the two-pass design, and what to do about it

*Written 2026-07-15 while simplifying ingestion. Status: analysis + recommendation; no code change yet.*

## The keyspace is the contract

A section key (`toc:1.2`, `toc:transformer-architecture`, `toc:3~2`) is the join key for
everything downstream: `concepts.section_key`, `concept_reviews`, `chapter_progress`,
`study_events`, skeleton/orient/guide caches, and the frontend's reading position. **Keys
stored for existing documents must never change** — a re-key orphans a user's mastery and
review history.

## How keys are assigned today (two passes)

1. **Numbering pass** — `content/sections.split_markdown_sections` walks the converted
   markdown's headings and keys each block from its heading text: `toc:<number>` when the
   heading starts with `1.2`-style numbering, else `toc:<slug>`.
2. **Outline pass** — when the PDF has embedded bookmarks, `content/outline` builds the
   canonical outline (unique nested keys, `~N` dedup suffixes) and *re-keys* each block onto
   the canonical section whose page span contains it (`assign_blocks_to_outline`, matching
   normalized heading text + page). Without bookmarks, `normalize_outline` derives the
   outline *from* the pass-1 keys instead.

So pass 1's keys are authoritative only for bookmark-less PDFs; for every real book they
are scaffolding that pass 2 overwrites. That's the confusing part — `split_markdown_sections`
*looks* like the key owner but usually isn't.

## Options considered

- **A. Status quo.** Works, tested, but ownership of the keyspace is split across two
  modules and the overwrite step is easy to misread.
- **B. Single key-assignment seam (recommended).** `split_markdown_sections` stops
  assigning `section_key` (it returns heading/level/number/order only); one new function
  `key_blocks(blocks, bookmarks, pages)` owns the keyspace, choosing the bookmark strategy
  when bookmarks exist and the heading-numbering strategy otherwise. Same outputs, one
  owner, the "re-key" disappears as a concept. Net code churn is small; the logic moves
  rather than shrinks.
- **C. Outline-only keys + re-ingest migration.** Simplest conceptually but requires
  re-keying stored documents — breaks the contract above. Rejected.

## Recommendation

Do **B**, but only when next touching the keying code (it's a refactor of working, tested
logic — no user-visible payoff on its own). The acceptance test is mechanical and strong:

> Re-run `persist_document` against each live document's stored markdown/bookmarks and
> assert the produced `section_key` set is **byte-identical** to what's in
> `section_content` today, for all documents.

Until then, the invariant to preserve when editing either module: *pass-2 keys win whenever
bookmarks exist; pass-1 keys are the no-bookmark fallback and the heading/number metadata
source.*
