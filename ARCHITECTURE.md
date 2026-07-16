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
deploy/    docker-compose + service images (app, learn, ollama, sentence-transformers)
           Tools: PostgreSQL+pgvector :5432, Ollama :11434, embeddings :8000
```

## Backend packages (`backend/app/`)

Dependency rule: **`platform` ← `content` ← domains ← {`overview`, `pipeline`} ← `api`** (overview and pipeline are siblings).
Domains may import `platform`, `content`, and another domain's *public* functions;
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
| `platform/` | Postgres pool + X-User-Db schema tenancy (`db.py`), Ollama client (`llm.py`, `llm_schemas.py`), the persistent jobs ledger/worker (`jobs.py` — pure mechanics, runners injected), vaultwriter seam |
| `content/` | The book itself: document metadata (`documents.py`), markdown→section splitting (`sections.py`), page provenance (`pages.py`), canonical TOC outline (`outline.py`), figures/tables (`elements.py`), scope resolution — "what's inside chapter X" (`scope.py`), persist + reads (`store.py`), TOC tree (`toc_tree.py`), chapter units (`chapters.py`) |
| `ingestion/` | PDF → markdown conversion (`reader.py`, `pdf_convert.py`) |
| `extraction/` | LLM generation passes: concept extraction (`concepts_extract.py`) + its critic eval gate (`eval_gate.py`), concept reads (`concept_store.py`), assembled chapter briefing (`deep_chapter.py`), skeleton, reading guides |
| `study/` | Learning state: SRS reviews + grading (`reviews.py`), MCQ sessions (`quiz_session.py`), quiz generation (deterministic + LLM), mastery, drill/exam/recall, SM-2 (`srs.py`) |
| `search/` | Embeddings + semantic search over content vectors |
| `media/` | Audiobook TTS (own checkpointed generation, dispatched by the queue) |
| `overview/` | Cross-domain read models: Today plan (`plan.py`), chapter readiness/coverage grids (`coverage.py`) |
| `pipeline/` | The **conductor** over the document lifecycle: phase-1 ingest (`ingest.py`), phase-2 extract runner (`build.py`; `build` kind = compat alias), per-document state + auto-chain `converted → extract` (`lifecycle.py`), and the composition root that registers every job-kind runner with `platform/jobs` (`registry.py`) |
| `api/` | One thin router module per surface |

`app/main.py` assembles the FastAPI app: middleware (tenancy header), routers, and
`pipeline/registry.install()` (job-runner wiring).

## The pipeline (document lifecycle)

A document flows `uploaded → converted → extracted → studyable`, with enrichment
(deep / skeleton / guides / quizzes / audiobook) as a lazy overlay on top. All background
work — conversion, extraction, every enrichment pass, and audiobook TTS — runs on the
**one persistent queue** (`platform/jobs`) as a registered *kind*; there are no in-memory
job systems. An upload auto-chains to core extraction (`LEARN_AUTOCHAIN`, default on), so a
converted document becomes studyable without a manual build. See [MAP.md](MAP.md) § 4.

## Identifiers — the two document ids

There are **two** ids for a document and they are not interchangeable. Confusing them is the
single easiest way to get an empty result from a query that "should" work.

| Name | Where it lives | Used for |
|---|---|---|
| **learn-doc-key** | `documents.key` (PK). Every backend table references it as `doc_id` — `concepts`, `section_content`, `elements`, `concept_reviews`, `chapter_*`, `content_vectors`, … | The canonical id in the backend. Every content/study/enrichment row is keyed by it. |
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
  `pipeline/registry.py` (called by `main.py` at startup).
- `main.py` is a composition root: the app, tenancy middleware, `/health`, and the landing
  page — nothing else. Every route lives in a router under `api/`.
- Scope resolution (chapter → section keys) always goes through `content/scope.py`,
  so no two surfaces can disagree about a chapter's extent.
- Rebuild the affected image after backend/frontend changes:
  `docker compose -f deploy/compose/docker-compose.yml build learn && ... up -d learn`
  (same for `app`, which serves :3001).
- Tests: `docker run --rm -v $PWD/backend/app:/app/app -v $PWD/backend/tests:/app/tests
  compose-learn:latest sh -c "pip install -q pytest; python -m pytest tests -q"`
