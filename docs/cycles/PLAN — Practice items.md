# PLAN — Practice items

Sub-cycle plan under [[0.) Development Protocol 1.0]]
Drafted 2026-08-22 · **no version claimed yet** — see Slotting

Addresses **Make learning more efficient** (`0d6a42ad415a`)

> FSRS retrievability holds across a real book I actually studied, over a season

Full design: [`docs/practice-items-spec.md`](../practice-items-spec.md). This is the plan;
the spec is the contract. Where they disagree, the spec is wrong and gets amended.

---

## Slotting

**Deliberately unversioned.** `repo.cycle_records()` keys on `^v?\d+\.\d+\.\d+ — …`, so a
`PLAN — …` filename is invisible to shipyard's cycle index — which is the correct state
for work that is planned but not yet slotted, and is what shipyard does with its own
`PLAN — board groups.md`. Rename to `v0.X.0 — Practice items.md` to claim a version and
register it.

Why no number today: `learn-hub`'s latest **tag is v0.14.0**, and `v0.15.0` (Say what you
did) and `v0.16.0` (Six seconds a chapter) are both **open records with no tag**.
`GET /api/problems/0d6a42ad415a/cycle-options` proposes **v0.17.0**, but the arc prompt
*Say what you did (v0.15.0 → v0.17.0)* reserves v0.17.0 in prose for **Jobs that admit
failure** — a reservation shipyard cannot see, because it was written as text rather than
opened as a record. Claiming a number here would either collide with the arc or jump ahead
of it. Pick one deliberately when this opens; do not let the proposal decide.

**This is a feature cycle and sits outside the honesty arc.** That arc is repairing
measurements that lie. This adds a new activity. Do not interleave them: a half-fixed
measurement layer plus a new writer into it makes both untestable.

---

## Problem

Learn Hub has exactly two graded activities — skeleton recall and concept recall — both
free recall → reveal → 4-button self-grade. That covers *remembering*, and it covers
nothing else. There is no way to practise **doing**: deriving a result, working a proof,
writing the code a chapter is teaching. For a textbook whose value is procedural, the app
can measure that you recognise the material and cannot tell you whether you can use it.

The reason it has never been built is that "generate practice problems" looks unbounded —
every subject needs its own notion of a correct answer, so the feature appears to require
solving math checking *and* code execution *and* proof validation before it ships anything.

**That framing is the bug.** Subject matter is not the axis. The axis is *how the answer
gets checked*, and that has about four values, of which the cheapest — self-graded against
a revealed worked solution — generalises to every subject and **is already the only
grading mode in this codebase**. A problem item is the existing three-beat loop with a
richer reveal. Everything else is an optional upgrade on the same row.

Two assets are already on disk and unused, which is why step 1 is not "build a table":

- `reading_guide.py` generates two grounded comprehension Q&A per section (schema
  `Check {q,a}`), has a registered `guides` job kind and three routes — **zero frontend
  consumers, `ext_guides` has 0 rows, never run.**
- `concept-detail.tsx:95-119` renders a complete "Test yourself" block with per-question
  reveal, bound to `ConceptLesson.questions`, hardcoded `[]` since `ext_concepts.
  quiz_questions` was dropped in the strip-down.

Prior art to respect: commit `99e4279` deleted seven study modules including a 421-line LLM
quiz author. It was cut for having **too many activities**, not because the idea was wrong.
This adds one.

---

## Appetite

Two sub-cycles, split at the point where the work stops being reversible.

**First**, generation + authoring — the user's stated priority is *creating* questions.
**Second**, making them gradeable. If the first overruns it sheds the editor polish, not
the generation.

Step 1 below is a spike inside the first cycle, not a cycle of its own: it is one enqueue
and a read, and its whole job is to kill the plan early if the answer is bad.

---

## Plan

**1. Light up `reading-guide` before building anything.** Run the existing `guides` job on
one real converted chapter and read the questions it produces. This costs an enqueue and
answers the assumption the entire design rests on: *is locally-generated question quality
good enough to build a pool around?* If it is not, the prompt is the work and the schema
was never the bottleneck — re-plan here rather than proceeding.

**2. `ext_practice` + generation.** One table, one `kind` column (`retrieve` | `problem`),
FK to `sources` so every cut of a book inherits, read through `concept_filter()`. New
`practice` job kind — six mechanical edits, no schema surprises. Per-section grain with
`coalesce=True`; the 2026-08-20 finding applies directly (per-block extraction fed the
model 558 chars instead of 8,073 and read as a model-quality failure).

**3. The Practice tab.** Third tab in `course-editor.tsx`, following `material-editor.tsx`'s
structure. `edited_at IS NULL` is the regenerable set — regeneration rewrites only untouched
rows, so polish is permanent. Answers render through the reader's `MarkdownReader`, never a
lookalike.

**4. Make them gradeable.** One `_TypedItem` entry, prefix `prac-`, `event_kind="practice"`.
Separate session, not a mixed queue: a ten-minute derivation must not land mid-run of
twenty-second concept cards. Two integration details are already verified —
`calendar.py:17` `_TYPES` must gain the type or it miscounts, and the reveal must read the
worked solution from `ext_practice` rather than snapshotting prose into
`concept_reviews.children`.

**5. Exam assembly**, only if wanted. Quiz/exam/practice are three *queries* over one pool,
not three data types; exam is the only one that may later deserve a stored row.

**Non-goals.** No code execution. No step ordering. No MCQ. No auto-grading, and **no LLM
in the graded loop** — `reviews.py:1` declares itself keyless and deterministic and that
property is worth keeping. Generation is LLM; doing is not. No second dead item type:
`ensure_chapter_item` already has zero callers and one ghost is enough.

---

## Exit criteria

1. A real converted chapter yields generated practice items of both kinds, grounded in its
   actual prose — judged by reading them, not by a row count.
2. An item edited by hand survives a regeneration of its section untouched.
3. A distilled custom version inherits its book's items with no generation run.
4. Practice grades move the activity heatmap and **do not** move coverage or retention.
   (Verified in design: `_retention_query` has no `item_type` filter so `prac-` rows do
   land in the retention map, but `summarize_memory` only looks up keys drawn from
   `ext_concepts`, so the extras are inert. Confirm it live rather than trusting this.)
5. Per the standing rule — **render the real artifact.** Every one of these produces a
   plausible-looking value, so a green suite over fixtures proves nothing. Each check runs
   against a real book in the running app, images rebuilt first.

---

## Open question, not answered in the spec

**Should a practice grade feed a progress signal of its own?** Retention is safe by
construction, which also means a practice grade currently moves the heatmap and nothing
else — problems would have no measure. The three-question model is coverage / retention /
state; production fluency would be a fourth. Adding a signal to that model is a product
decision and is deliberately left open.
