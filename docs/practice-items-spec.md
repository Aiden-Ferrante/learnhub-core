# Practice items — design note (2026-08-22, amended 2026-08-28)

**Status: Phase 1 built (v0.19.0).** Decisions taken 2026-08-22: one item pool,
self-graded verification only, FSRS-scheduled in its own session.

**Amended 2026-08-28 (user decision, re-planning the aborted cycle):** the scope grew —
MCQ, step-ordering, and Match-style games are IN (as *drill-only activities*), a local
sandbox code runner is IN (kind `code`, executed against tests), and exams get a stored
sitting. The 2026-08-22 non-goals section below is rewritten accordingly; what survives
unchanged: **no LLM in the graded loop**, fixed pool + regenerate (no generate-on-demand),
and no auto-grading of open answers. Delivery is phased: v0.19.0 the pool (retrieve +
problem, built) → v0.19.1 games → v0.19.2 exams → v0.19.3 the code runner.

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
  kind         text                      -- 'retrieve'|'problem'|'mcq'|'order'|'code'
  prompt       text                      -- the question / task
  answer       text                      -- the worked solution, markdown
  rubric       text                      -- optional: what a good answer must contain
  payload      jsonb                     -- per-kind check data (2026-08-28); NULL for retrieve/problem
  "order"      int
  created_at   timestamptz
  edited_at    timestamptz               -- NULL = generated, untouched, regenerable
```

**`kind` stays the how-the-answer-is-checked axis and grows values** (2026-08-28): `mcq`
(choice-checked, `payload {"choices":[...],"answerIndex":0}` — stored with the correct
answer first, shuffled at render, distractors authored at generation time never play
time), `order` (sequence-checked, `payload {"steps":[...]}` in correct order), `code`
(executed against tests, `payload {"language","starter","tests":[...],"timeoutMs"}`).
These are rows 2–4 of the table above finally being built. **`payload` over per-mode
columns**: authoring, editing, regeneration, assembly and `concept_filter` reads are
identical for all five kinds — nullable per-mode columns would each be NULL for 4 of 5
kinds and cost a migration per future mode; only the kind's own player reads its payload
(precedent: `chapter_builds.payload`).

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

**Prompt hardening + deterministic post-filter (2026-08-28, from the spike findings).**
Both observed failure modes are the same shape — a reference to the book's FURNITURE
("According to the text…", "as shown in step 3 of Table 2-1") instead of its subject —
so the prompts ban the construction explicitly AND `practice.py` drops any prompt matching
the `_FURNITURE_TELLS` regexes as a backstop. Refusal (an empty list) is treated as
success. The job receipt is `{authored, dropped, refused, total}` so prompt drift is
visible in the Process tab rather than silently truncated.

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

**Revisited 2026-08-28 — the escape hatch is invoked.** Comprehensive per-chapter and
multi-chapter exams (v0.19.2) store a SITTING (`exam_sessions`): the item set must freeze
at start (a mid-exam regeneration must not shift it), answers must survive a reload, and
resit comparison needs two persisted rows. Quiz and per-section practice remain queries.
Every exam grade writes through the same `prac-` engine (`event_kind="exam"`), so exams
feed production fluency through one deterministic path.

## Scope boundary (rewritten 2026-08-28)

The 2026-08-22 exclusions (no MCQ, no step ordering, no code execution) were REOPENED by
user decision on 2026-08-28 — all three are in scope, phased. What still holds, and is
non-negotiable:

- **No LLM in the graded loop** — `reviews.py:1` declares itself keyless and
  deterministic, and that property is kept. Generation is LLM; doing is not. The code
  runner (v0.19.3) is likewise never on the grading critical path: execution results
  *inform* a self-grade in the session, and an exam's code item degrades to self-graded
  when the runner is down.
- **Fixed pool + regenerate**, not generate-on-demand: a curated per-section set;
  regeneration replaces only `edited_at IS NULL` rows.
- **No auto-grading of open answers**, and MCQ distractors are authored and stored —
  never generated at play time.
- **Games are activities, not measures** (Match / MCQ play / step-ordering play):
  drill-only, they write engagement events (`kind='game'`) and never touch
  `concept_reviews`. The measures are production fluency and exam scores — both flow
  through the one deterministic `prac-` engine. An activity is not a measure.

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

## The answer to the open question — production fluency (decided 2026-08-25)

The question this section used to leave open: *should a practice grade feed anything the
concept loop already measures?* **Yes, and it must be its own number.**

The reason is the whole point of the feature. Steps 1–4 above build an *activity*; what is
actually wanted is a way to **audit your own understanding**, which is a *measure*. Without
one, a practice grade moves the activity heatmap and nothing else — you would have built a
question pool that can only tell you that you answered questions. `mastery.py:3` states the
three-question model: *what should I do?* (forecast) · *what's the state of my memory?*
(coverage + retention) · *what have I done?* (activity). Competency asks a fourth — **can I
use it?** — and no existing number can answer it, because coverage and retention are both
computed over `ext_concepts`.

Charted as **Competency** (`0ee146aab681`), the fourth sub-group under *Make learning more
efficient*; the other three all measure recall.

### It is the same function over a different denominator

`summarize_memory(concept_keys, retention)` (`mastery.py:271`) is **pure**: a list of keys
plus a retention map in, a summary out. And `_retention_by_key` reads `concept_reviews`
through `review_scope(doc)` with **no `item_type` filter**, so `prac-` rows already land in
the retention map — they are inert today only because `summarize_memory` is handed keys
drawn from `ext_concepts`.

So production fluency is that same call with a different key list:

- **denominator** — the section's `ext_practice` rows `WHERE kind IN ('problem','code')`,
  read through `concept_filter()`, mirroring `_concepts_by_section` exactly (which is also
  what makes it inherit correctly across a re-cut version). MCQ/order/retrieve are
  deliberately EXCLUDED: they are recognition, and counting them is the Competency
  falsifier ("recall wearing a problem's clothes") firing inside the measure itself
- **numerator** — those of them with a `prac-` review row
- **fluency** — mean FSRS retrievability over the attempted ones, the same engine as
  retention, so "fading" means one thing in both places

No new scheduler, no second memory model, no new query shape. One key-list builder and one
extra call.

### Three rules it must not break

1. **Never averaged into retention.** It is a separate axis on the surface, always. The
   season-long waypoint on `0d6a42ad415a` rests on retention meaning one thing; folding
   production evidence into it destroys the only number that waypoint can be read off.
2. **Zero items means unknown, not zero fluency.** Coverage's denominator is safe because
   concepts exist the moment extraction runs. Practice items are generated on demand, so a
   section with no items has *no information*, and rendering that as 0% is exactly the
   failure the honesty arc exists to kill — an absent measurement displayed as a bad score.
   Unknown is a distinct state from zero throughout, per v0.15.0.
3. **Do not reuse the retention thresholds.** `RETENTION_SOLID = 0.9` is FSRS's scheduling
   target for twenty-second concept cards. A ten-minute derivation answered correctly once
   is not "solid", and saying so would be the same confident-wrong-answer this codebase has
   been repairing. Either calibrate separate thresholds or name the states differently —
   decide when there is real data, and until then report the raw fraction rather than a
   flattering word.

### What this changes upstream

Step 4 is designed around it rather than bolted onto it: the `_TypedItem` entry keeps its
`prac-` prefix and `event_kind="practice"` as specified, and the read model gains its key
list next to `_concepts_by_section`. The falsifier on the Competency node is the thing to
watch — *every practice item is answerable by restating a concept's definition* — because a
fluency number computed over recall-in-disguise items is worse than no number at all: it
would report production skill the pool never tested.

## The sandbox runner (v0.19.3 — designed 2026-08-28, not yet built)

`code` items are the one kind whose check executes. The runner is a **separate compose
service** (`deploy/services/runner/`), not in-process — the `learn` container holds the
GPU, docling, and the DB DSN, so a sandbox escape there lands in the most privileged
place; a tiny FastAPI service costs one Dockerfile and ~150 lines.

- **API**: `POST /run {language, code, tests[], timeoutMs}` →
  `{ok, results[{name,passed,error}], stdout, stderr, timedOut, oom}`; `GET /healthz`.
- **Adapter per language** (`prepare(workdir, code, tests) -> argv`); Python first.
- **Per-execution**: fresh tmpfs workdir, `python -I`, empty env, rlimits (CPU, AS 512MB,
  FSIZE, NOFILE, NPROC), wall-clock 2× CPU with killpg, output capped 64KB.
- **Container posture**: `read_only` rootfs, unprivileged user, `cap_drop: ALL`,
  `no-new-privileges`, `pids_limit`, `mem_limit`, and a dedicated `internal: true`
  network — submitted code has NO route to the internet; only `learn` can reach it.
- **Determinism boundary**: `reviews.py`/`grade_review` never import the runner. Session:
  per-test results inform the 1–4 self-grade. Exam: the objective score is the server-side
  re-run on submit; runner down → the item degrades to self-graded and the exam completes.
- **Authoring-time quality gate**: generation runs each candidate solution against its own
  tests and DISCARDS failures (receipt `execFailed`) — the automated analogue of the
  spike's hand-checked truth table; a plausible problem with a wrong solution is worse
  than none.
