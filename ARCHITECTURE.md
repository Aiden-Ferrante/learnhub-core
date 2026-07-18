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
mcp/       FastMCP server driving the backend over REST only (no DB access)
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
| `supplemental/study/` | Learning state — exactly two graded activities, both FSRS-scheduled: skeleton recall + concept recall through one review queue (`reviews.py`, `srs.py`); mastery/activity/forecast read models over the append-only `study_events` floor (`mastery.py`); derived sessions + calendar |
| `supplemental/media/` | Audiobook TTS (own checkpointed generation, dispatched by the queue) |
| `conductor/` | Decides what runs, and wires it (the job rows live in `gateways/ledger`): the one queue worker + runner registry + `JobCtx` (`worker.py`), phase-1 ingest (`ingest.py`), phase-2 extract runner (`build.py`; `build` kind = compat alias), per-document state (`lifecycle.py` — extraction is on-demand per chapter; whole-book auto-chain is opt-in via `LEARN_AUTOCHAIN=1`), and the composition root that registers every job-kind runner and starts the worker (`registry.py`) |
| `api/` | The HTTP boundary — eight thin routers mirroring the groups: `content` (the book), `process` (convert/extract/build), `concept` (read+curate), `reading`, `study` (doing), `progress` (tracking), `media` (audiobook), `system`. Routers validate, call one facade, shape the envelope — no business logic |

`app/main.py` assembles the FastAPI app: middleware (tenancy header), routers, and
`conductor/registry.install()` (job-runner wiring).

## Database schema — sections, one owner each

Integrity lives in the database, not in application convention. Tables are grouped by
**name prefix**, each section owned by the package above:

| Prefix | Owner | Tables |
|---|---|---|
| `raw_` | `process/` | `raw_documents` (identity + status), `raw_structure` (the TOC as a self-referencing tree; `id = doc_id::section_key`), `raw_content` (markdown blocks), `raw_elements` (figures/tables) |
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
- Tests: `docker run --rm -v $PWD/backend/app:/app/app -v $PWD/backend/tests:/app/tests
  compose-learn:latest sh -c "pip install -q pytest; python -m pytest tests -q"`
