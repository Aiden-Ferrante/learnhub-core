# Practice items — design note (2026-08-22)

**Status: design settled, nothing built.** Decisions taken this session: one item pool,
self-graded verification only, FSRS-scheduled in its own session. One question left open
at the bottom.

Goal: quizzes, exams, and practice problems — in two categories the user named.
**(1) Knowledge retrieval**: concepts, definitions, summaries. **(2) Problems**: derive
this, code that. Generated as a baseline, then edited to polish.

## The generalization: type by how the answer is checked, not by subject

"Math problems" vs "coding problems" is the wrong axis — subject matter is unbounded and
typing on it means building forever. The thing that actually determines what you store
and what you build is **how the answer gets checked**, and that collapses to four modes:

| Mode | Applies to | Cost |
|---|---|---|
| **Self-graded vs. a worked solution** | everything — derivations, proofs, design questions, "explain why" | zero; already the app's only mode |
| **Step ordering** | derivations, proofs, algorithms, any procedure | low; `skeleton-practice.tsx` sort mode already does this UI |
| **Normalized exact match** | a closed-form numeric/symbolic answer | low, but brittle (expression equivalence) |
| **Executed against tests** | code only | high — needs a sandbox runner that does not exist in this stack |

The floor is the whole trick: **self-graded-against-a-worked-solution generalizes to every
subject, and every other mode is an optional upgrade on the same row.** You never have to
answer "how do I auto-check a derivation" in order to ship. v1 builds the floor only.

This is not a new mechanism. Every graded activity in the product today — concept recall,
skeleton recall — is already *prompt → reveal → 4-button self-grade* (`review-panel.tsx:156-216`).
There is no MCQ, no answer field, and no scoring anywhere in the codebase. A problem item
is the same three beats with a richer reveal.

## What already exists and is not being used

Before building anything, three assets are already on disk:

1. **A retrieval-question generator, orphaned.** `reading_guide.py` prompts for *"TWO short
   comprehension questions … each with a concise model answer"* → schema `Check {q, a}`
   (`llm_schemas.py:45-52`), cached in `ext_guides`, authored via the registered `guides`
   job kind, served by `/api/reading-guide` + prepare GET/POST (`reading_routes.py:25-60`).
   **Zero frontend consumers; `ext_guides` has 0 rows.** It has never been run.
2. **A question UI, dead but intact.** `concept-detail.tsx:95-119` renders a "Test yourself"
   block with per-question reveal, driven by `ConceptLesson.questions` — hardcoded `[]`
   since `ext_concepts.quiz_questions` was dropped (`STUDY-SIMPLIFICATION.md:130-136`).
3. **Step-ordering UI**, if mode 2 is ever wanted: `skeleton-practice.tsx` sort mode.

**History worth respecting:** commit `99e4279` deleted `quiz_session.py`,
`concept_quiz_llm.py` (421 lines of LLM authoring), `concept_quiz_gen.py`, `exam.py`,
`drill.py`, `recall.py` and their surfaces. The stated reason was *too many activities*,
not *MCQ is wrong*. This design reintroduces one activity, not five.

## The item

**One table, one `kind` column.** Retrieval and problems share authoring, editing,
assembly, and grading — splitting them doubles every one of those for a discriminator's
worth of difference.

```
ext_practice
  key          text PRIMARY KEY          -- uuid, NOT derived from a concept name (see below)
  doc_id       text NOT NULL REFERENCES sources(key) ON DELETE CASCADE
  structure_id text REFERENCES raw_structure(id) ON DELETE CASCADE
  section_key  text
  kind         text                      -- 'retrieve' | 'problem'
  prompt       text                      -- the question / task
  answer       text                      -- the worked solution, markdown
  rubric       text                      -- optional: what a good answer must contain
  "order"      int
  created_at   timestamptz
  edited_at    timestamptz               -- NULL = generated, untouched, regenerable
```

Modelled on `ext_concepts` (`01-schema.sql:193-204`) and `ext_guides`.

**Ownership: the book, not the version.** FK to `sources`, like `ext_concepts` — so every
cut of a book inherits the questions written against it, and reads go through
`concept_filter()` (`blocks.py:120-149`), which already resolves the book/version split
and falls back to the unfiltered book when a version has no `version_blocks` mapping.
Bypassing `concept_filter` is the recurring bug in this codebase; don't.

**`key` is a uuid, deliberately not a content hash.** `concept_key()` is
`sha256(doc|section|name)[:16]` (`concepts_extract.py:201`), so renaming a concept mints a
new key and orphans anything anchored to it — which is why `match_renamed_concepts()`
(`:205-234`) exists to re-key `concept_reviews` and `study_events` on every re-extraction.
Practice items anchor to `(doc_id, section_key)` and carry their own stable id, so they
never need that machinery. A regenerate replaces rows; it does not chase names.

## Generation

New job kind `practice`. Six mechanical edits, no schema surprises:

1. `ledger.py:67` — add `"practice"` to `KINDS`
2. `process/extraction/practice.py` — `author_practice_sync(doc, scope, on_progress)` +
   `fetch_practice(doc, scope)`; copy `reading_guide.py`'s shape wholesale
3. `registry.py` — one `register_runner("practice", _run_practice)` line
4. Facade export from `process/extraction/__init__.py`
5. Routes: enqueue + status poller, per `process_routes.py:103-145`
6. `llm_schemas.py` — `PracticeItem` / `PracticeSet`, wire-format field names, no aliases

**Grain: per outline section, coalesced.** `load_section_blocks(..., coalesce=True)` — the
2026-08-20 finding applies directly: per-block extraction fed a small model 558 chars
instead of 8,073 and produced garbage, which read as a model-quality failure but was an
input-size failure. Fix granularity before reaching for a bigger model.

**Two prompts, one pass.** Retrieval items are grounded in the section's extracted
concepts (name + signal + source sentence); problem items are grounded in the section's
markdown, because a concept row is too thin to derive a task from. Both must refuse rather
than invent — the `LEARN_REQUIRE_SOURCE` gate in `parse_concepts_response`
(`concepts_extract.py:151-185`) is the precedent for dropping ungrounded output.

**Model:** `gemma4` is sufficient for prose retrieval questions (measured 2026-08-20).
Problems may want more; add `LEARN_PRACTICE_MODEL` following the
request → `LEARN_EXTRACT_MODEL` → `OLLAMA_MODEL` precedence at `concepts_extract.py:416`.
Note `gateways/llm.py`'s effective timeout is the `300.0` parameter default —
`DEFAULT_TIMEOUT = 120.0` at `:24` has no readers and means nothing.

## Editing — polish survives regeneration

**`edited_at IS NULL` is the regenerable set.** A regenerate deletes and rewrites only
untouched rows; the moment you edit an item it becomes yours and no future pass will
overwrite it. This is cheaper than the material editor's copy-on-write override
(`version_blocks.markdown_override`) and it is the property actually wanted here: durable
polish, not revert-to-baseline.

Writes go through a whitelist, exactly like `concept_store.update_concept`
(`:200-218`): `EDITABLE_FIELDS = {"prompt", "answer", "rubric", "kind"}`, dynamic `SET`,
`edited_at = now()`. Plus create (hand-authored items, `edited_at` set at insert) and
delete.

**Staleness stays derived, never stored** — `max(material edited_at) > min(ext_practice
created_at)` per section, the same rule as `editing.stale_sections` (`:108-133`). Nothing
has to remember to set a flag and a rebuild clears it by construction.

**UI: a third tab in `course-editor.tsx`** (`Outline | Material | Practice`), following
`material-editor.tsx`'s structure — chapter rail left, items right, one open editor at a
time (`editingKey`/`draft`/`run()`), stale markers per chapter. Rendering the answer must
reuse the reader's `MarkdownReader`, per the rule at `material-editor.tsx:5-9`: a lookalike
drifts, and then the thing you edited stops matching the thing you study.

## Scheduling — same engine, separate session

A practice item becomes a `_TypedItem` entry in `reviews.py:184-201`, prefix `prac-`,
`event_kind="practice"`. That one dataclass gets keying, seeding, FSRS, grading, card
assembly, and event logging.

**Separate session, not a mixed queue.** `build_review_queue` gains a kind filter so a
ten-minute derivation never lands mid-way through a run of twenty-second concept cards.
Same FSRS engine, same 1-4 scale, same calendar.

Two integration details, both verified against the code:

- **The reveal cannot use `children`.** The typed-item card shape hardcodes
  `children: [{heading, essence}]` (`reviews.py:204-218`), which snapshots into
  `concept_reviews.children`. A worked solution belongs in `ext_practice`, so the card
  should carry the item key and the panel should read the answer from the item — not
  snapshot prose into the review row. This is a deliberate asymmetry with skeleton items.
- **Coverage and retention are safe.** `_retention_query` (`mastery.py:221-224`) applies no
  `item_type` filter, so `prac-` rows do land in the retention map — but `summarize_memory`
  (`:271-287`) only looks up keys drawn from `ext_concepts`, so the extra entries are inert.
  Practice grades will **not** silently move coverage or retention.
- **Two places must be told about the new type**, or it goes miscounted: `calendar.py:17`
  `_TYPES` (which still lists a vestigial `"figure"` nothing writes), and
  `sessions.py:19` `_PASSIVE` — practice is active, so it needs no entry there, but the
  `graded_only` filter in `_fetch_events` (`mastery.py:111`) will count `kind='practice'`
  events automatically since `correct IS NOT NULL`.

Do **not** add a second dead item type: `ensure_chapter_item` (`reviews.py:312-333`) has
zero callers, so `chap-` rows have never existed. One ghost is enough.

## Quiz, exam, practice are assemblies — not data types

They are three selections over one pool, the same way `version_blocks` is an ordered
selection of the book's blocks:

- **practice** — one item, drilled, from a section
- **quiz** — short, chapter-scoped, generated on demand by filter
- **exam** — long, cross-chapter

v1 stores none of them; all three are queries. **Exam is the one that may later deserve a
stored row** (a fixed set you sit twice and compare), and that is the only reason to
revisit this.

## Explicitly out of scope

No code execution. No step ordering. No MCQ. No auto-grading, and **no LLM in the graded
loop** — `reviews.py:1` declares itself keyless and deterministic, and that property is
worth keeping. Generation is LLM; doing is not.

## Sequencing

1. **Light up `reading-guide` first.** Run the existing `guides` job on one real chapter
   and look at the questions. It costs almost nothing and it answers the question this
   whole design rests on: *is locally-generated question quality good enough to build a
   pool around?* If it isn't, the prompt is the work, not the schema.
2. `ext_practice` + `practice.py` + the job kind — generation only, read via API.
3. The Practice tab in the course editor — generate, then polish.
4. The `_TYPED` entry + separate session — make them gradeable.
5. Exam assembly, if wanted.

Steps 1-3 are the user's stated priority ("creating"); 4 is what makes it stick.

## Open question

**Should a practice grade feed anything the concept loop already measures?** Retention is
safe by construction (above), so today a practice grade would move the activity heatmap
and sessions but nothing else — problems would have no progress signal of their own. The
three-question model is coverage / retention / state; production fluency is arguably a
fourth. Adding a signal is a real decision and is deliberately not taken here.
