# Goal Prompt — Say what you did

Super-cycle · learn-hub `v0.15.0 → v0.17.0`
Drafted 2026-08-22. Fossilised on Build gate — corrections go to ADRs, never back-edits.

Addresses **Make learning more efficient** (`0d6a42ad415a`)

---

## 0. The protocol, inlined

*Development Protocol 1.0 lived in the vault's `Projects/` tree, archived 2026-08-14. The
mechanics this arc uses are restated here so the prompt is self-contained.*

```
   PLAN ────────► BUILD ────────► TEST ────────► REVIEW
   human          agent           both           human
   leads          leads                          leads
     ▲                                              │
     └────── retro → Backlog.md → next Plan ◄───────┘
```

A cycle is **atomic**: it passes all four phases and cuts a version, or it cuts nothing.
There is no version for "got through build and testing". If the re-plan valve fires
mid-cycle, the cycle aborts — learnings go to a retro, no version is cut.

The version bump is the transaction commit. `CHANGELOG.md` is the write-ahead log; git
tags are the only durable record of finished work.

| Unit | Version move | Ends with |
|---|---|---|
| **Sub-cycle** (one atomic P→B→T→R) | MINOR `0.14.0 → 0.15.0` | CHANGELOG entry + tag + cycle record |
| Light cycle (fix / small addition) | PATCH | CHANGELOG line |
| **Super-cycle** (this arc) | MAJOR, eventually | the artifact made *trustworthy* |

PBTR attaches to a **problem**, never a project. Cycle records live in
`learnhub-core/docs/cycles/` — under git, travelling with the code, per `_records_dir`'s
own stated preference and its lesson from the 2026-08-14 archive.

---

## 1. Problem

Learn Hub does not fail loudly. It fails **confidently**, returning HTTP 200 with a
plausible, wrong answer — and every affected surface renders that answer as fact.

A 2026-08-21/22 audit read the upload, delete, persistence, study, content and frontend
layers end to end. 44 findings, verified in source. They are not 44 unrelated bugs; they
are three repeated mistakes:

**(a) The book/version seam is crossed in the wrong direction, silently.** The
source-vs-version split (ARCHITECTURE.md § "The book / course seam") is enforced by
convention at ~48 SQL sites. Four of them get it backwards, and because both ids are
opaque strings the result is an empty set rather than an error:

- `reviews.py:393` filters book-keyed concepts against version-keyed section keys —
  disjoint keyspaces. A re-cut course serves **zero** concept cards and renders "all
  caught up". The same function 100 lines up does it correctly *with a comment explaining
  why* (`:294`), so this is a missed call site, not a design gap.
- `skeleton.py:121,249` and `eval_gate.py:56` read `ext_concepts` by version id; that
  column holds a source id. Zero rows, always, for any custom version — the skeleton
  prompt loses its grounding and caches the degraded result, and the quality gate stops
  scoring, which reads as "eval disabled".
- `elements.py:139,172` list figures by version id while `figure_path():196` correctly
  resolves through `source_id_of`. The URLs work and the listings are empty.

**(b) `except Exception: return {}` is the house style for reads.** A transient DB error
becomes "you have studied nothing" (`mastery.py:222,237`), "this chapter has no content"
(`chapters.py:39`), "0 concepts extracted" (`toc_tree.py:194,228`), or an empty book with
no error key at all (`documents.py:81`). Three `progress_routes.py` handlers return a bare
dict, so FastAPI sends **200** on a DB exception and `http.ts:5` — the app's only failure
detector — passes it through. `use-course-data.ts:106-113` then renders a confident
"0 reviews due" and the user skips their reviews.

**(c) An endpoint can be dead for weeks with nobody noticing.** `/api/engagement`
(`progress_routes.py:55`) calls `record_engagement(dict(body))` — one positional argument —
against a four-parameter signature. Guaranteed `TypeError` → 500 on every call since it was
written. The frontend fires it as `void fetch(...).catch(() => {})`, so **`study_events`
has only ever contained graded rows**: the heatmap's read/listen bars, `byKind`, the
cadence chip and `sessions._dominant_kind`'s entire `_PASSIVE` branch are all dead code
against data that was never written.

What is at stake: this app's whole value is being a *measurement* of what you know. Every
finding above is the measurement lying in the direction of "you're fine" — an empty review
queue, full coverage bars on an unstudied chapter, zero reviews due. A study tool that
under-reports debt is worse than no study tool, because it is trusted.

Two auth holes ride along and are cheap to close in the same pass: the middleware matcher's
static-extension lookahead is anchored on the whole pathname, so `/api/learn/concept/x.map`
**skips auth entirely** (verified against the real regex), and `getUserDbName()` then fails
*open* to the primary tenant rather than erroring.

## 2. Vision + measuring stick

**Vision.** Learn Hub either tells you the truth or tells you it doesn't know. There is no
third answer, and no surface renders "I couldn't find out" as "nothing".

**Measuring stick.** Three numbers, all currently failing:

| Measure | Now | Target |
|---|---|---|
| Read paths that turn an exception into empty data | 11 | 0 |
| Backend handlers returning 200 on failure | 3 | 0 |
| SQL sites keying a source-scoped table by version id | 4 | 0 |

Plus one binary: a custom course version with an edited outline serves the right concept
cards, or it does not.

## 3. Appetite

**Three sub-cycles, one theme each.** Scope bends, the split does not — each cuts its own
tag and each must be independently revertable. If a sub-cycle overruns, it sheds findings
to the next rather than growing.

## 4. The arc

### v0.15.0 — Say what you did *(this cycle)*

The confident wrong answers, and the two auth holes.

- **S1** middleware matcher `/api/:path*`; `getUserDbName()` throws instead of falling back.
- **S3** `resolve_doc_id` validates its id before it reaches `os.path.join`.
- **S4** login `from` param must be a same-origin path.
- **A1** `/api/engagement` — fix the call, map `scope → section_key`.
- **A2** `reviews.py:393` translates the span through `source_sections`, as `:294` does.
- **A3** `skeleton.py` / `eval_gate.py` resolve through `source_id_of` + `source_section_key`.
- **A4** `elements.py` listings resolve through `source_id_of`.
- **A5** `mastery.py` loaders propagate their error; `compute_mastery` surfaces it.
- **A8** `fetch_chapter` resolves extent through `scope.py`, not a page span.
- **A9/A10** `scope.py` understands slug keys and `~n` dedup keys.
- **A11** cadence uses a day-floor, not a seconds offset.
- **E3/E4** the three `progress_routes.py` handlers return `JSONResponse` with a status;
  `use-course-data.ts` distinguishes "0 due" from "couldn't ask".

**Non-goals.** No delete work. No job-queue work. No splitter work. Not fixing A6's
coverage rollup — `test_mastery.py:92-96` asserts the current behaviour, so changing it is
a product decision, not a bug fix. Not addressing S2 (the backend trusts `X-User-Db`
unauthenticated); loopback-only publishing is the control and the deployment is
single-tenant — documented in ARCHITECTURE.md, not coded around.

### v0.16.0 — Delete means delete

- **B1** the Processing tab's delete actually calls the backend (it is currently a no-op
  that toasts success; the shelf already has the correct pattern).
- **B2** `delete_document` runs in one transaction.
- **B3** the 404 check moves above the `rmtree`.
- **B5** audiobooks are removed, via a `media` facade export composed at the `api` layer
  (`content` may not import `media` — the layering forbids it).
- **B8** study pruning uses a `to_regclass` precheck, not `except: continue` — note the
  guard differs per function: `versions.py:175` sits inside a transaction, so catching
  there leaves it already poisoned.
- **B7** `origin` gets a CHECK constraint (one line standing between a typo and losing
  every concept in a book).
- **F4/F5** version delete gains a confirm; the shelf dialog names the sibling versions it
  destroys. Disclosure only — what delete removes does not change.
- **B4/B6** re-convert's cascade and the pre-transaction figure `rmtree`.
- Tests: the delete paths have **zero** coverage today.

### v0.17.0 — Jobs that admit failure

- **C1** terminal ledger writes stop being best-effort — including the `running` claim,
  whose loss re-hands the same row to the next poll (a silent double-run).
- **C2** every exit from `run_convert` marks the document; a broken import stops squatting
  on its content hash.
- **C3** an extraction where every section failed reports failure.
- **C4** skeleton stops caching empty essences at the current prompt version.
- **C5** interrupted jobs get an attempt cap and `not_before` backoff (the column exists
  and `next_job` already honours it).
- **C6** the cheap half only: `ctx.progress` in the runners that never call it, so cancel
  fires at all, plus honest UI copy. Real convert-cancel needs docling in a subprocess and
  incremental concept writes change the dedup's first-occurrence semantics — both deferred
  as design changes.
- **D1–D7** the splitter: fenced code blocks, setext headings, duplicate-heading collisions.

## 5. Exit criteria for the arc

The waypoint on `0d6a42ad415a` is the honest version of this. Everything else is a task
list. Concretely, the arc is done when:

1. The three measures in §2 read 0 / 0 / 0.
2. A custom version with an edited outline serves the right concept cards, verified
   against a real book — not a fixture.
3. Deleting a course from either surface removes its rows, its files and its audiobooks,
   and a 404 delete touches nothing.
4. A job that fails is red; a job that is cancelled stops; a document that broke mid-convert
   can be re-imported without hand-editing the database.

## 6. How this gets verified

Per the vault's standing rule: **render the real artifact**. A green suite over fixtures
proves nothing here — every one of these bugs produces a *plausible* value, so a test
asserting a plausible value passes while the app lies. Each sub-cycle ships with at least
one check driven against a real converted book in the running app, and the images are
rebuilt before any browser check (the `:3000` dev server is not what Mission Control opens).
