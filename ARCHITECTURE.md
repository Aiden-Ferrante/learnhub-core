# Architecture

Learn Hub is a **domain-partitioned modular monolith** (per *Fundamentals of Software
Architecture*, Richards & Ford): one Python deployable organized by domain, inside a
service-based system topology (frontend / backend / tools as separate containers).

> For a clickable, file-level index of everything below, see [MAP.md](MAP.md).

## System topology

```
frontend/  Next.js 15 app (:3001) — auth, UI, and a proxy layer that forwards
           /api/learn/* to the backend with the X-User-Db tenancy header
backend/   FastAPI service (:8010) — everything below
deploy/    docker-compose + service images (app, learn, ollama)
           Tools: PostgreSQL :5432, Ollama :11434
```

## Backend packages (`backend/app/`)

Dependency rule: **`gateways` ← `process/content` ← domains ← `conductor` ← `api`**.
`process/` and `supplemental/` are grouping folders — `process/` is everything that turns
an uploaded PDF into studyable content (`ingestion`, `content`, `extraction`);
`supplemental/` is what the app layers on top of it (`study`, `media`). Each package
inside a group keeps its own facade, and the layer rules apply to the packages, not the
groups.
Domains may import `gateways`, `process/content`, and another domain's *public* functions;
never each other's internals, never anything above them. `api` is thin routers only.
There are **zero import cycles** (checked by AST; keep it that way).

**The module-hub contract** (docs/module-hubs.md, enforced by `scripts/check_hubs.py` in CI):
every package's `__init__.py` is its **facade** — the only thing another package may import
(`from app.study import grade_review`, never `from app.study.reviews import ...`), holding
imports + the package's documentation docstring and nothing else. Private (underscore) names
never cross a package boundary. Tests may deep-import; `app/main.py` is the assembly point.
The facade docstrings are surfaced into MAP.md automatically by `gen_map.py`.

| Package | Owns |
|---|---|
| `gateways/` | The connections to programs outside this process: Postgres pool + X-User-Db schema tenancy (`db.py`), Ollama client (`llm.py`, `llm_schemas.py`), and the persistent jobs ledger stored in Postgres (`ledger.py` — rows only, no worker; the doc resolver is injected) |
| `process/ingestion/` | PDF → markdown conversion (`reader.py`, `pdf_convert.py`) |
| `process/content/` | The book itself, in the `raw_` tables: identity/stub + status (`documents.py`), the TOC as a self-referencing tree + the markdown blocks + figures (`store.py` writes `raw_structure`/`raw_content`/`raw_elements`), markdown→section splitting (`sections.py`), page-range assignment (`pages.py`), the canonical bookmark outline (`outline.py`), figure reads (`elements.py`), scope resolution — "what's inside chapter X" (`scope.py`), TOC tree (`toc_tree.py`), chapter units (`chapters.py`), keyword search (`find.py`) |
| `process/extraction/` | LLM generation passes, into the `ext_` tables: concept extraction (`concepts_extract.py`) + its critic eval gate (`eval_gate.py`), concept reads (`concept_store.py`), the derived chapter briefing over the `ext_briefing` **view** (`guided_reading.py`), skeleton + orient (`skeleton.py`), reading guides (`reading_guide.py`) — each row anchored to a `raw_structure` node by a nullable FK |
| `supplemental/study/` | Learning state — exactly two graded activities, both FSRS-scheduled: skeleton recall + concept recall through one review queue (`reviews.py`, `srs.py`); memory-state read models — coverage + FSRS-retrievability retention (states new/solid/shaky/fading) — plus activity/cadence/forecast over the append-only `study_events` floor (`mastery.py`); derived sessions + calendar |
| `supplemental/media/` | Audiobook TTS — Kokoro, synthesized straight through and dispatched by the queue (the checkpoint/resume layer was deleted in v0.16.0; see ADR 0002) |
| `conductor/` | Decides what runs, and wires it (the job rows live in `gateways/ledger`): the one queue worker + runner registry + `JobCtx` (`worker.py`), phase-1 ingest (`ingest.py`), phase-2 extract runner (`build.py`; `build` kind = compat alias), per-document state (`lifecycle.py` — extraction is on-demand per chapter; whole-book auto-chain is opt-in via `LEARN_AUTOCHAIN=1`), and the composition root that registers every job-kind runner and starts the worker (`registry.py`) |
| `api/` | The HTTP boundary — eight thin routers mirroring the groups: `content` (the book), `process` (convert/extract/build), `concept` (read+curate), `reading`, `study` (doing), `progress` (tracking), `media` (audiobook), `system`. Routers validate, call one facade, shape the envelope — no business logic |

`app/main.py` assembles the FastAPI app: middleware (tenancy header), routers, and
`conductor/registry.install()` (job-runner wiring).

## Database schema — sections, one owner each

Integrity lives in the database, not in application convention. Tables are grouped by
**name prefix**, each section owned by the package above:

| Prefix | Owner | Tables |
|---|---|---|
| `sources` | `process/` | The uploaded book itself — one row per PDF, holding the file-level facts (filename, hash, page count, figures) that are true no matter how many courses are cut from it |
| `raw_` | `process/` | `raw_documents` (a **course version** over a source — identity + status + name/origin/is_main), `raw_structure` (the TOC as a self-referencing tree; `id = doc_id::section_key`), `raw_content` (markdown blocks), `raw_elements` (figures/tables) |
| `ext_` | `process/extraction` | `ext_concepts`, `ext_orient`, `ext_skeleton`, `ext_guides` — plus `ext_briefing`, a **view** derived from orient + skeleton (aggregators are views, never stored tables) |
| `study_`-ish | `supplemental/study` | `concept_reviews`, `study_events`, `chapter_progress` (unchanged this pass — no doc FK yet) |
| operational | `gateways/ledger` + `conductor` | `chapter_builds` (job ledger), `learn_meta` (queue flag) |
| deferred | frontend | `app_documents`, `user_settings` (the course card + UI state — the user layer) |

Rules the schema enforces: every child of a document carries a NOT NULL `doc_id` FK with
`ON DELETE CASCADE`; `structure_id` is a nullable FK to a `raw_structure` node (content
and concepts are finer-grained than the TOC, so a row may anchor to no node). A stub
`raw_documents` row is created at upload (`status='converting'`), so a job or content row
always has a parent — which is why the stub is inserted **before** the convert job
enqueues. Deleting a document is one `DELETE FROM raw_documents`; the cascade removes its
whole `raw_`/`ext_` graph + its jobs (the un-FK'd study tables are pruned explicitly until
the study layer is re-anchored). Pages are metadata on the structure/content rows — there
is no page-content table; the raw PDF is served from disk for a page view.

## The document lifecycle

A document flows `uploaded → converted → extracted → studyable`, with enrichment
(skeleton / guides / quizzes / audiobook) as a lazy overlay on top. All background
work — conversion, extraction, every enrichment pass, and audiobook TTS — runs on the
**one persistent queue** (rows in `gateways/ledger`, drained by `conductor/worker`) as a registered *kind*; there are no in-memory
job systems. Conversion and extraction are separate steps: converting yields the structure
tree and the reader immediately; concept extraction runs on demand, per chapter, from the
TOC (Process tab) — a whole-book LLM pass is hours, not seconds. `LEARN_AUTOCHAIN=1`
re-enables the old convert→extract-everything chain for unattended bulk ingests. See
[MAP.md](MAP.md) § 4.

## The book / course seam

A **source** is the uploaded book. A **course version** (`raw_documents`) is a named path
through it — its own `raw_structure` tree, its own study state. Every book has a `Default`
version, created at upload from the PDF's own table of contents; a user can add versions
that re-cut the same book into their own chapters.

The design constraint that shaped this: roughly **48 SQL sites across 28 files key off
`doc_id`**. Making a version *be* a `raw_documents` row means structure and tracking
partition per version with no change to any of them — a threaded `version_id` column was
rejected because one missed predicate leaks another version's data into your statistics.
For every book ingested before versions existed, `raw_documents.key == source_id`
(the identity backfill), so no row moved and no id changed.

What belongs to which:

| | Owns |
|---|---|
| **source** | the PDF on disk (`<SHARED_DIR>/ingest/<source>/original.pdf`), its figures, filename, hash, page count |
| **version** | its `raw_structure` tree, `toc_route`, section/char counts, and all study state |

Anything reaching for the uploaded material resolves through `source_id_of()` first —
`/api/document/pdf` and `figure_path()` both do, so every version of a book serves the
same original file.

The split runs down the middle of the child tables:

| | Owns |
|---|---|
| **book** | `raw_content` · `raw_elements` · `ext_concepts` (FK `sources`) |
| **version** | `raw_structure` · `ext_orient`/`skeleton`/`guides` · all study state |
| **`version_blocks`** | the join: which of the book's blocks a version keeps, where it places them, in what order |

So two versions share one copy of the text. Distilling is deleting mapping rows, not
copying markdown. Every read of a version's content goes through that join — see
`process/content/blocks.py`, which owns it; a bare `raw_content WHERE doc_id` reads the
whole BOOK and silently ignores a version's cut.

Blocks report two section keys: `sectionKey` is the placement in *this* version's
outline, `sourceSectionKey` is where it came from in the book. Concepts are extracted
against the book, so inheritance resolves on the latter.

**Concept inheritance.** Concepts are extracted against the book, so a version sees the
ones its material was drawn from — a re-cut course inherits an extraction it never paid
for. Every concept read goes through `concept_filter()` in `blocks.py`, the single place
that decision lives; it returns the SQL predicate + binds, and falls back to the whole
book when a version has no mapping at all (absent information must not read as "covers
nothing"). Extraction *writes* against the book too, so building a chapter from a custom
version enriches the source every other version inherits from.

**Coverage per version, retention per source.** `concept_reviews` holds two kinds of row
and they scope differently — the rule lives in `study/review_scope.py`:

| Row | Scope | Why |
|---|---|---|
| concept card (`item_type IS NULL`) | the **book** | memory is memory; re-cutting an outline must not reset the scheduler |
| `skeleton` / `chapter` | the **version** | structure recall drills *that* outline, in its order |

So a new version of a studied book inherits its concepts' FSRS state (same due dates, same
retention) while its structure drills start fresh. Grading a concept writes the review row
against the book and the *study event* against the version you were reading, so shared
memory and per-course activity stay separable.

> Two smaller gaps remain, both frontend-side: `app_documents` cards still resolve their own
> `learn_doc_id`, so setting main does not yet change what a shelf card opens; and
> `section_count` is not recomputed after a version's material changes. The whole-library
> review calendar attributes shared concept rows to the book, which is the only sensible
> answer but means they appear under the Default course.

## Identifiers — the two document ids

There are **two** ids for a document and they are not interchangeable. Confusing them is the
single easiest way to get an empty result from a query that "should" work.

| Name | Where it lives | Used for |
|---|---|---|
| **learn-doc-key** | `raw_documents.key` (PK). Every backend table references it as `doc_id` (a NOT NULL FK for the `raw_`/`ext_` tables) — `raw_structure`, `raw_content`, `ext_concepts`, `concept_reviews`, `chapter_*`, … | The canonical id in the backend. Every content/study/enrichment row is keyed by it. |
| **app-document-id** | `app_documents.key` = `app_documents.id` (same value) | The frontend's id for a course card and the id in the URL `/courses/<id>`. Backend content code never sees it. |

The bridge is one column: **`app_documents.learn_doc_id → documents.key`**. The frontend
resolves it before any content/study call (see the frontend ARCHITECTURE's Identifiers note).

**Backend parameter convention:** a parameter named `doc` or `doc_id` is *always* the
**learn-doc-key**, never the app id. Both spellings mean the same thing — `doc_id` matches the
column, `doc` is the HTTP query-string key (`?doc=…`) threaded through the study read-models.
The one column wart is `study_events.doc` (named `doc`, not `doc_id`, for historical reasons —
annotated in `01-schema.sql`); it still holds the learn-doc-key. A blanket rename was
deliberately *not* done — the names are consistent within each scope, and `?doc=` / the columns
are external contracts; this table is the disambiguator instead.

## Conventions

- New backend code goes in the domain package it belongs to; if a route handler grows
  logic, move the logic into the domain and keep the handler thin.
- The jobs queue never imports domains — new job kinds register a runner in
  `conductor/registry.py` (called by `main.py` at startup).
- `main.py` is a composition root: the app, tenancy middleware, `/health`, and the landing
  page — nothing else. Every route lives in a router under `api/`.
- Scope resolution (chapter → section keys) always goes through `process/content/scope.py`,
  so no two surfaces can disagree about a chapter's extent.
- Rebuild the affected image after backend/frontend changes:
  `docker compose -f deploy/compose/docker-compose.yml build learn && ... up -d learn`
  (same for `app`, which serves :3001).
- Tests — **mount `conftest.py` too**. It is not in the image, and without it the
  `integration` marker is unregistered, so the eight Postgres tests neither skip nor
  gate: they error out after ~30s each of connection retries (240s of "failures" that
  read as environment noise). Unit tier:
  `docker run --rm -v $PWD/backend/app:/app/app -v $PWD/backend/tests:/app/tests
  -v $PWD/backend/conftest.py:/app/conftest.py compose-learn:latest
  sh -c "pip install -q pytest; python -m pytest tests -q"`
  Both tiers need the compose network and the gate:
  `docker run --rm --network compose_default -e LEARN_PG_TESTS=1
  -e "POSTGRES_DSN=host=postgres port=5432 user=learnhub password=learnhub_local dbname=learnhub"
  -v $PWD/backend/app:/app/app -v $PWD/backend/tests:/app/tests
  -v $PWD/backend/conftest.py:/app/conftest.py compose-learn:latest
  sh -c "pip install -q pytest; python -m pytest tests -q"`
