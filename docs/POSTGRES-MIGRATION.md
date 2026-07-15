# Learn Hub — ArangoDB → PostgreSQL migration plan

> Status: **DRAFT for review.** No migration code until the decisions below are signed off.
> Goal: replace ArangoDB (and fold in Qdrant) with a single keyless, local PostgreSQL —
> zero data loss, no user-facing change.

## 0. Why this is the right move (evidence)

- **The "graph" is barely a graph.** ~105 AQL queries; only ~6 touch graph traversal, all on
  one 23-edge `relationships` collection (the TOC tree). The KG/triple/prereq-graph features
  were already pruned (`concept_prereq`, `processed_documents`, `propositions` are all **empty**).
- **The data is document/relational.** Books, sections, pages, concepts, reviews, study events,
  users. Postgres serves this with plain SQL + JSONB, and `pgvector` absorbs the separate Qdrant
  vector store — **3 data services collapse to 1**. This is the app's stated priority: simplicity,
  low cost, local-first.

## 1. Decisions (recommended — please confirm each)

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| 1 | Query layer | **psycopg3 + its connection pool** (raw parametrized SQL, thin row→dict helper). No ORM. | The ~89 queries are already hand-written and explicit; an ORM is a huge rewrite that hides SQL. psycopg3 speaks JSONB + pgvector natively and stays keyless/simple. |
| 2 | Schema style | **Hybrid.** Columns for filtered/query-heavy tables; **JSONB** for read-whole document blobs. | Best of both — indexable columns where we filter, flexible JSONB where we just load a doc. (Mapping in §2.) |
| 3 | Vectors | **Adopt `pgvector`, retire Qdrant.** Embeddings become `vector` columns on the rows that already carry them. | Deletes Qdrant + the `lc_vectorstore`/`lc_embeddings` glue. Biggest single simplification. |
| 4 | Multi-tenancy | **Schema-per-user via `SET search_path`.** X-User-Db header → schema name, 1:1. | Preserves today's per-DB isolation **without adding `WHERE tenant_id` to 89 queries** — they run unqualified against the request's schema. Auth users live in a shared `auth` schema. |
| 5 | Frontend DB access | **Route the 4 frontend DB files through the backend API.** Drop `arangojs` entirely. | Kills the frontend↔backend shared-database coupling; only ONE codebase then talks to Postgres. |
| 6 | Migration shape | **Incremental behind a data-access seam**, package by package, tests green each step. Not big-bang. | 89 queries at once on a live app with real data is how migrations fail. Keep Arango readable as fallback during the transition. |

## 2. Collection → table inventory (23 collections)

Live counts from the `learnhub` DB. **Drop** = empty/dead, do not migrate.

| Arango collection | Rows | Target | Style | Notes |
|---|---|---|---|---|
| `documents` | 5 | `documents` | cols + JSONB + text | `outline`→JSONB, `markdown`→text, counts→int cols |
| `app_documents` | 5 | `app_documents` | cols + JSONB | upload/UI metadata; `metadata`,`selectedSectionKeys`→JSONB |
| `section_content` | 2534 | `section_content` | cols | core content; index `(doc_id, section_key)` |
| `page_content` | 2550 | `page_content` | cols + JSONB | `headings`,`sectionKeys`,`sectionPath`→JSONB |
| `elements` | 2846 | `elements` | cols + JSONB + **vector** | figures/tables; `embedding`→`vector`, `bbox`/`tableData`→JSONB |
| `concepts` | 480 | `concepts` | cols + JSONB + **vector** | `embedding`→`vector`, `questions`/`prereqNames`→JSONB |
| `content_vectors` | 1227 | `content_vectors` | cols + **vector** | RAG chunks; `embedding`→`vector`, index for ANN |
| `concept_reviews` | 14 | `concept_reviews` | cols | SRS state; query-heavy (due/ease/interval) — all columns |
| `study_events` | 250 | `study_events` | cols | append-only event log; index `(doc, ts)`, `(concept_key)` |
| `chapter_builds` | 16 | `chapter_builds` | cols | queue state; `phase`,`status`,timestamps |
| `chapter_progress` | 13 | `chapter_progress` | cols + JSONB | `stages`→JSONB |
| `chapter_orient` | 15 | `chapter_orient` | cols + JSONB | `objectives`,`watchFor`→JSONB |
| `chapter_skeletons` | 18 | `chapter_skeletons` | cols + JSONB | `sections`→JSONB |
| `deep_chapter_briefing` | 10 | `deep_chapter_briefing` | cols + JSONB | `keyConcepts`,`sections`,`objectives`→JSONB |
| `reading_guides` | 174 | `reading_guides` | cols + JSONB | `checks`→JSONB |
| `section_augment` | 44 | `section_augment` | cols + JSONB | `objectives`,`recap`→JSONB |
| `entities` | 24 | `entities` | cols + JSONB | `docIds`→JSONB/array |
| `relationships` | 23 | `relationships` (**edge table**) | cols | `_from`/`_to`→`from_key`/`to_key`. TOC tree = flat `SELECT ... WHERE type=@pred`; Python `build_nested_tree()` assembles it — **no recursion/graph needed** |
| `user_settings` | 1 | `user_settings` | JSONB | `courseGroups`,`readingProgress`→JSONB |
| `learn_meta` | 1 | `learn_meta` | cols | singleton (`paused` flag) |
| `concept_prereq` | 0 | **DROP** | — | prereq graph removed |
| `processed_documents` | 0 | **DROP** | — | dead |
| `propositions` | 0 | **DROP** | — | old KG |
| `users` (in `learnhub_auth`) | 1 | `auth.users` | cols | username, password hash, `dbName`→becomes schema name |

Arango `_key` → a `key` text primary column (keep the exact string keys so cross-references —
`docId`, `sectionKey`, `concept_key` — port unchanged). Don't invent new surrogate ids initially.

## 3. Tenancy model (concrete)

- One database `learnhub`. One schema **per user** (today: just `mooteo`). A shared `auth` schema for `users`.
- Replace `platform/arango.py` with `platform/db.py`: a psycopg3 pool + `set_request_db_name()` that,
  per request, runs `SET search_path TO <schema>, public`. Same ContextVar wiring as today.
- Net effect: the ported queries stay **table-name-only** (no tenant filter), exactly like the AQL is
  collection-name-only now.

## 4. Vector consolidation

- **Embedding dim = 384** (measured from live `concepts`/`content_vectors` — a MiniLM-class model
  served by the local keyless `sentence-transformers` `/embed` service). → `vector(384)` columns on
  `concepts`, `content_vectors`, `elements`.
- Qdrant today holds two collections (`entity-embeddings`, `document-embeddings`); **pgvector absorbs both.**
- HNSW index (`vector_cosine_ops`) for ANN; `semantic_search` + `concept_resolve` query pgvector instead
  of Qdrant. Delete the `qdrant` service + `lc_vectorstore`/`lc_embeddings` Qdrant glue. The
  `sentence-transformers` embed service **stays** (it produces the vectors).

## 5. Phased execution (each phase ends green + reversible)

0. **Backup** the live `learnhub` + `learnhub_auth` (arangodump) — recovery point. *(Mirrors the
   txt2kg→learnhub DB migration already done here.)*
1. **Schema** — write DDL for the tables in §2 (+ `pgvector`, `pg_trgm` extensions). Add a `postgres`
   service to docker-compose (keyless, local volume) **alongside** Arango.
2. **Data-access seam** — introduce `platform/db.py`; add a repository layer so callers don't hand-write
   AQL inline. (Small refactor; behavior identical, still on Arango.)
3. **Port package-by-package**: `content/` → `extraction/` → `study/` → `search/` (pgvector) →
   `media/` → `overview/`. Run `backend/tests/` after each; add a golden-output check per endpoint.
4. **One-time data copy** — script Arango→Postgres per table; **verify row counts** against §2.
5. **Frontend** — add backend endpoints for the 4 `arangojs` files; delete `arangojs` from the frontend.
6. **Cutover** — point the app at Postgres (targeted `learn`+`app` recreate; ollama untouched). Verify
   the study loop, audiobooks, and search against real data.
7. **Fallback window** — keep Arango + the dumps until confirmed stable.
8. **Decommission** — remove `arangodb` + `qdrant` from compose; delete `arango_*.py`, Qdrant glue,
   `python-arango`/`arangojs` deps.

## 6. Risks & mitigations

- **89 queries is a lot of surface.** → Incremental + tests per phase; golden-output diffs per endpoint.
- **Arango string `_key` semantics** (cross-collection refs by key). → Keep keys as text PKs verbatim.
- **JSONB vs column mis-call** (querying inside a JSONB blob later). → Start hybrid per §2; a field can be
  promoted to a column later without a full remodel.
- **Embedding dimension mismatch.** → Confirm N before creating `vector(N)` columns; re-embed if needed.
- **Live app during migration.** → Both stores co-exist through phase 6; cutover is one targeted recreate
  with Arango as instant fallback.

## 7. Success criteria

- App runs entirely on Postgres; `arangodb` + `qdrant` gone from docker-compose.
- All data present & correct (row counts verified vs Arango, §2).
- `backend/tests/` pass; study loop (read → quiz → recall), audiobooks, and search unchanged.
- Keyless/local preserved; stack comes up with one `docker compose up`.

## 8. Schema DDL (concrete, per-user schema — `pgvector` + `pg_trgm`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- shared auth (was learnhub_auth.users)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  username    text PRIMARY KEY,
  password    text NOT NULL,        -- existing hash, verbatim
  schema_name text NOT NULL,        -- was users.dbName → the tenant schema
  created_at  timestamptz DEFAULT now()
);

-- everything below lives in the per-user schema (search_path target)
CREATE TABLE documents (
  key text PRIMARY KEY, title text, source_filename text, source_hash text,
  markdown text, outline jsonb,
  page_count int, section_count int, element_count int, char_count int,
  page_block_count int, has_page_provenance boolean, created_at timestamptz);

CREATE TABLE app_documents (
  key text PRIMARY KEY, id text, learn_doc_id text, name text, file text,
  status text, upload_status text, processing_method text, original_pdf_name text,
  converted_from_pdf boolean, "order" int, size bigint,
  selected_section_keys jsonb, metadata jsonb,
  extracted_date timestamptz, last_updated timestamptz);

CREATE TABLE section_content (
  key text PRIMARY KEY, doc_id text NOT NULL, section_key text, number_key text,
  heading text, level int, markdown text, "order" int, page_start int, page_end int);
CREATE INDEX ON section_content (doc_id, section_key);

CREATE TABLE page_content (
  key text PRIMARY KEY, doc_id text NOT NULL, page_no int, markdown text, char_count int,
  headings jsonb, section_keys jsonb, section_path jsonb);
CREATE INDEX ON page_content (doc_id, page_no);

CREATE TABLE elements (
  key text PRIMARY KEY, doc_id text NOT NULL, section_key text, type text, "order" int,
  page int, caption text, code text, language text, latex text, image_ref text,
  table_markdown text, bbox jsonb, bbox_origin text, table_data jsonb, embedding vector(384));
CREATE INDEX ON elements (doc_id, section_key);

CREATE TABLE concepts (
  key text PRIMARY KEY, doc_id text NOT NULL, section_key text, name text, kind text,
  signal text, source text, "order" int, page_start int, page_end int,
  deep_explanation text, deep_explained_at timestamptz,
  prereq_names jsonb, questions jsonb, embedding vector(384), created_at timestamptz);
CREATE INDEX ON concepts (doc_id, section_key);
CREATE INDEX ON concepts USING hnsw (embedding vector_cosine_ops);

CREATE TABLE content_vectors (
  key text PRIMARY KEY, doc_id text NOT NULL, section_key text, heading text, text text,
  page_start int, page_end int, embedding vector(384));
CREATE INDEX ON content_vectors USING hnsw (embedding vector_cosine_ops);

CREATE TABLE concept_reviews (
  key text PRIMARY KEY, doc_id text, section_key text, due timestamptz, ease real,
  interval int, reps int, lapses int, state text, last_grade int, last_review timestamptz);
CREATE INDEX ON concept_reviews (doc_id, due);

CREATE TABLE study_events (
  key text PRIMARY KEY, doc text, section_key text, concept_key text,
  kind text, correct boolean, ts timestamptz);
CREATE INDEX ON study_events (doc, ts);
CREATE INDEX ON study_events (concept_key);

CREATE TABLE chapter_builds (
  key text PRIMARY KEY, doc_id text, scope text, phase text, status text, done int, total int,
  error text, requested_at timestamptz, started_at timestamptz, finished_at timestamptz, not_before timestamptz);
CREATE TABLE chapter_progress    (key text PRIMARY KEY, doc_id text, scope text, stages jsonb);
CREATE TABLE chapter_orient      (key text PRIMARY KEY, doc_id text, scope text, objectives jsonb, watch_for jsonb, created_at timestamptz);
CREATE TABLE chapter_skeletons   (key text PRIMARY KEY, doc_id text, scope text, sections jsonb, created_at timestamptz);
CREATE TABLE deep_chapter_briefing (key text PRIMARY KEY, doc_id text, scope text, concept_count int,
  key_concepts jsonb, objectives jsonb, sections jsonb, watch_for jsonb, created_at timestamptz);
CREATE TABLE reading_guides   (key text PRIMARY KEY, doc_id text, section_key text, focus text, checks jsonb, created_at timestamptz);
CREATE TABLE section_augment  (key text PRIMARY KEY, doc_id text, section_key text, objectives jsonb, recap jsonb);
CREATE TABLE entities         (key text PRIMARY KEY, name text, doc_ids jsonb);
CREATE TABLE relationships    (key text PRIMARY KEY, from_key text, to_key text, type text, doc_ids jsonb);
CREATE INDEX ON relationships (from_key);  CREATE INDEX ON relationships (to_key);
CREATE TABLE user_settings    (key text PRIMARY KEY, course_groups jsonb, reading_progress jsonb);
CREATE TABLE learn_meta       (key text PRIMARY KEY, paused boolean);
```
The 3 empty collections (`concept_prereq`, `processed_documents`, `propositions`) get no table.

## 9. `platform/db.py` — the Arango-hub replacement (design)

Same shape/ContextVar wiring as today's `platform/arango.py`, so `main.py`'s middleware is unchanged:

```python
from contextlib import contextmanager
from contextvars import ContextVar
from psycopg_pool import ConnectionPool
import os, re

_pool = ConnectionPool(os.environ["POSTGRES_DSN"], min_size=1, max_size=8)
_REQUEST_SCHEMA: ContextVar[str | None] = ContextVar("request_schema", default=None)
_NAME = re.compile(r"^[a-zA-Z0-9_-]+$")

def set_request_db_name(name: str | None) -> None:      # called by X-User-Db middleware, unchanged
    _REQUEST_SCHEMA.set(name if name and _NAME.match(name) else None)

@contextmanager
def db():
    schema = _REQUEST_SCHEMA.get() or os.environ.get("PG_SCHEMA") or "learnhub"
    with _pool.connection() as conn:
        conn.execute(f'SET search_path TO "{schema}", public')   # tenancy, no per-query filter
        yield conn
```
Domain modules move their inline AQL into small repository functions that do `with db() as c: c.execute(sql, params)`.
Because `search_path` is set per request, ported SQL stays **table-name-only** (mirrors collection-name-only AQL).

## 10. Data copy (phase 4) — one-off, verified

`tools/arango_to_pg.py` (keyless, run once at cutover):
- For each table in §2: read all docs from the Arango collection, map `_key`→`key` and camelCase→snake_case
  per the DDL, `json.dumps` the JSONB fields, pass embedding lists straight to `vector(384)` columns.
- Insert via `COPY`/`executemany`; **assert Postgres count == Arango count** per table before proceeding.
- Idempotent: truncate the target schema first (or upsert on `key`) so re-runs are safe.
- Copy `learnhub_auth.users` → `auth.users` (set `schema_name` = the tenant schema, e.g. `learnhub`).

---
## Open questions before any code
1. **Confirm the 6 decisions in §1** — especially **#3 retire Qdrant** and **#4 schema-per-user**.
2. ~~Embedding dimension~~ — **resolved: 384** (§4).
3. OK to run a **`postgres` service alongside Arango** during the transition (extra RAM until decommission)?
4. Naming: keep the single tenant schema as **`learnhub`** (matches today's DB name), or name it after the
   username (`mooteo`)? (Affects `auth.users.schema_name`.)
