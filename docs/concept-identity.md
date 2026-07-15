# Concept identity across re-extraction

*Decided 2026-07-15 as part of nailing down the extraction → concept → learning loop.*

## The problem

`concept_key = sha256(doc_id | section_key | lower(name))[:16]`. The key is the join point
for the learning loop: `concept_reviews` (SM-2 schedule) and `study_events` (answer history)
both reference it. Because the **name is part of the key**, a forced re-extraction that
*improves* a concept's name — "LLM" → "Large language model" — mints a new key, and the
learner's review schedule and history for that concept are orphaned. That makes extraction
quality improvements and past study time enemies: every prompt upgrade taxes the learner.

## The stance (implemented)

**Carry review history forward across renames, deterministically, at write time.**

`write_section_concepts` now does, inside its transaction and before wiping the section's
old rows:

1. Find old concepts whose key is absent from the new set (*vanished*: renamed or dropped)
   **and** that actually have a `concept_reviews` row — unreviewed concepts need no care.
2. Match them against new concepts whose key is absent from the old set (*appeared*), by
   normalized-name similarity (`difflib.SequenceMatcher`, threshold 0.75, greedy best-first,
   each successor used at most once, deterministic tie-break). Unchanged names never enter
   the matcher — same name means same key.
3. For each match, re-key the review row (skipped if the successor somehow already has one)
   and re-point the concept's `study_events` history so mastery accounting follows.

Genuinely *dropped* concepts (no plausible successor) leave their review rows orphaned —
same as before; the document-delete cascade still cleans them up.

## Why this over the alternatives

- **Embedding-based matching** — stronger recall on aggressive renames, but embeddings are
  written lazily (often NULL at write time), it adds a service dependency to the write path,
  and it's non-deterministic across model versions. Name similarity is stdlib, deterministic,
  and covers the common case (spelling/expansion/canonicalization changes). If real renames
  start slipping past the 0.75 threshold, embeddings are the upgrade path — behind the same
  `match_renamed_concepts` seam.
- **Accept the reset** — simplest, but it directly contradicts the goal: extraction must be
  re-runnable-and-improving without punishing study time.
- **Name-independent keys (e.g. sequence numbers)** — breaks the idempotent delete-and-
  reinsert write model and every existing stored key; a migration with no user-visible win.

## Invariants to preserve when touching this

- Same name (case-insensitive) ⇒ same key ⇒ no matcher involvement.
- The matcher only ever maps *reviewed-and-vanished* → *newly-appeared*, 1:1.
- Re-keying happens in the same transaction as the section wipe — no window where a review
  points at nothing.
