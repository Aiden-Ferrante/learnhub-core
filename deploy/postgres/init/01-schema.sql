-- Learn Hub — PostgreSQL schema.
-- Runs once on first container init. Extensions are database-wide; tenant tables
-- live in a per-user schema selected per request via SET search_path (X-User-Db).
--
-- SECTIONS (table-name prefixes; each section is owned by one backend package):
--   raw_*    the ingested book — identity, the TOC as a tree, content, media   (process/*)
--   ext_*    LLM-guided extraction — concepts + per-chapter artifacts           (process/extraction)
--   ext_briefing  a VIEW (derived, never stored) assembled from the ext_ parts
--   study_*/…     study state (unchanged this pass; see ARCHITECTURE.md)
--   chapter_builds / learn_meta   the job ledger + queue flag (operational)
--   app_documents / user_settings the frontend course-card + UI state (deferred)
--
-- Integrity lives in the database: every child of a document carries a NOT NULL
-- doc_id FK with ON DELETE CASCADE, so deleting the document row removes its whole
-- graph. A stub raw_documents row is created at upload (status='converting'), so a
-- job or content row always has a parent to point at.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── shared auth ─────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  username      text PRIMARY KEY,
  password_hash text NOT NULL,
  display_name  text,
  role          text,
  schema_name   text NOT NULL,      -- the tenant schema
  created_at    timestamptz
);

-- ── default tenant schema (matches today's DB name) ─────────────────────
CREATE SCHEMA IF NOT EXISTS learnhub;
-- include public so extension types/functions (installed in public) resolve
SET search_path TO learnhub, public;

-- ═══════════════════════════════════════════════════════════════════════
-- raw_  — the ingested book (owned by process/ingestion + process/content)
-- ═══════════════════════════════════════════════════════════════════════

-- Identity + status. Born as a stub at upload (no markdown/outline — those live
-- in raw_content/raw_structure); the convert job flips status converting→ready
-- (or →error) and fills the counts. The full-document markdown is NOT stored: it
-- is reassembled from raw_content when a caller wants the whole blob.
CREATE TABLE raw_documents (
  key             text PRIMARY KEY,
  title           text,
  source_filename text,
  source_hash     text,
  status          text NOT NULL DEFAULT 'ready',   -- converting | ready | error
  status_code     int,                             -- http status of a convert failure
  toc_route       text,                            -- TOC controller verdict: bookmarks |
                                                   -- bookmarks-pagematched | none
  page_count      int,
  section_count   int,
  element_count   int,
  char_count      int,
  has_page_provenance boolean,
  created_at      timestamptz DEFAULT now(),
  last_updated    timestamptz);
CREATE INDEX ON raw_documents (source_hash);
CREATE INDEX ON raw_documents (status, created_at DESC);

-- Structure — the TOC as ONE self-referencing tree. id is deterministic
-- (doc_id || '::' || section_key) so any table holding (doc_id, section_key) can
-- point at a node without a lookup. parent_id is a plain self-reference (the tree
-- is also reconstructable from depth); page_start/page_end are the node's span —
-- pages are metadata here, there is no page_content table.
CREATE TABLE raw_structure (
  id           text PRIMARY KEY,                   -- doc_id || '::' || section_key
  doc_id       text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  parent_id    text,                               -- parent node's id (self-reference)
  section_key  text NOT NULL,                      -- 'toc:2', 'toc:2.1', …
  kind         text,                               -- chapter | section
  number_label text,                               -- '2', '2.1' (was numberKey)
  title        text,
  depth        int,                                -- 0-based (was listDepth)
  hidden_reason text,                              -- NULL = in the syllabus; else why the
                                                   -- curate stage hid it (front-back-matter
                                                   -- | orphan-part) — reader shows all nodes
  "order"      int,
  page_start   int,
  page_end     int,
  UNIQUE (doc_id, section_key));
CREATE INDEX ON raw_structure (doc_id, "order");
CREATE INDEX ON raw_structure (doc_id, parent_id);

-- Content — the markdown, one block per split heading. structure_id points at the
-- TOC node that contains the block; NULLABLE because content is finer-grained than
-- the outline (a block can fall under no bookmarked node).
CREATE TABLE raw_content (
  key          text PRIMARY KEY,
  doc_id       text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  structure_id text REFERENCES raw_structure(id) ON DELETE CASCADE,
  section_key  text,
  number_key   text,
  heading      text,
  level        int,
  "order"      int,
  markdown     text,
  char_count   int,
  page_start   int,
  page_end     int);
CREATE INDEX ON raw_content (doc_id, "order");
CREATE INDEX ON raw_content (doc_id, section_key);

-- Media — figures / tables / code, anchored to a structure node + page.
CREATE TABLE raw_elements (
  key           text PRIMARY KEY,
  doc_id        text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  structure_id  text REFERENCES raw_structure(id) ON DELETE CASCADE,
  section_key   text,
  type          text,
  "order"       int,
  page          int,
  caption       text,
  code          text,
  language      text,
  latex         text,
  image_ref     text,
  table_markdown text,
  bbox          jsonb,
  bbox_origin   text,
  table_data    jsonb);
CREATE INDEX ON raw_elements (doc_id, section_key);

-- ═══════════════════════════════════════════════════════════════════════
-- ext_  — LLM-guided extraction (owned by process/extraction)
-- ═══════════════════════════════════════════════════════════════════════

-- Concepts — many per structure node. No page columns: a concept inherits its
-- section's page span from raw_structure (joined on read where needed).
CREATE TABLE ext_concepts (
  key           text PRIMARY KEY,
  doc_id        text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  structure_id  text REFERENCES raw_structure(id) ON DELETE CASCADE,
  section_key   text,
  name          text,
  kind          text,
  signal        text,
  source        text,
  "order"       int,
  created_at    timestamptz);
CREATE INDEX ON ext_concepts (doc_id, section_key);

-- Per-chapter LLM artifacts. `scope` is a chapter's section_key; structure_id is
-- its node. Row key stays the sha256(doc|scope) hash the code already computes.
CREATE TABLE ext_orient (
  key          text PRIMARY KEY,
  doc_id       text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  structure_id text REFERENCES raw_structure(id) ON DELETE CASCADE,
  scope        text,
  objectives   jsonb,
  watch_for    jsonb,
  created_at   timestamptz);

CREATE TABLE ext_skeleton (
  key            text PRIMARY KEY,
  doc_id         text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  structure_id   text REFERENCES raw_structure(id) ON DELETE CASCADE,
  scope          text,
  sections       jsonb,
  prompt_version int,
  created_at     timestamptz);
CREATE INDEX ON ext_skeleton (doc_id, scope);

CREATE TABLE ext_guides (
  key          text PRIMARY KEY,
  doc_id       text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  structure_id text REFERENCES raw_structure(id) ON DELETE CASCADE,
  section_key  text,
  focus        text,
  checks       jsonb,
  created_at   timestamptz);
CREATE INDEX ON ext_guides (doc_id);

-- The chapter briefing — DERIVED, never stored. This view assembles the cleanly
-- relational part (objectives + watch-fors from orient, section essences from
-- skeleton) per (doc_id, scope). The concept preview (key_concepts/count) needs the
-- Python scope resolver, so guided_reading layers it on after reading this view.
CREATE VIEW ext_briefing AS
SELECT
  COALESCE(o.doc_id, s.doc_id) AS doc_id,
  COALESCE(o.scope, s.scope)   AS scope,
  o.objectives,
  o.watch_for,
  s.sections
FROM ext_orient o
FULL OUTER JOIN ext_skeleton s
  ON s.doc_id = o.doc_id AND s.scope IS NOT DISTINCT FROM o.scope;

-- ═══════════════════════════════════════════════════════════════════════
-- study_  — study state (UNCHANGED this pass; no doc FK yet — delete_document
-- still prunes these explicitly until the study layer is re-anchored)
-- ═══════════════════════════════════════════════════════════════════════

-- item_type: NULL = concept card; 'skeleton' (structure recall) and 'chapter' (resurface)
-- are the typed items. heading/children snapshot the reveal for typed rows.
CREATE TABLE concept_reviews (
  key text PRIMARY KEY DEFAULT gen_random_uuid()::text, doc_id text, section_key text, due timestamptz, ease real,
  interval double precision, reps int, lapses int, state text, last_grade int, last_review timestamptz,
  item_type text, chapter_scope text, first_review timestamptz,
  heading text, children jsonb,
  stability real, difficulty real, step int);
CREATE INDEX ON concept_reviews (doc_id, due);

-- NOTE: `doc` is the learn-doc-key (= raw_documents.key). Spelled `doc` not `doc_id`
-- for historical reasons; unchanged this pass.
-- kind: review | skeleton | resurface (graded, correct set) · read | listen | orient (passive).
CREATE TABLE study_events (
  key text PRIMARY KEY DEFAULT gen_random_uuid()::text, doc text, section_key text, concept_key text,
  kind text, correct boolean, ts timestamptz);
CREATE INDEX ON study_events (doc, ts);
CREATE INDEX ON study_events (concept_key);

-- Manual study-time blocks — the user's own corrections layer. Sessions stay a pure
-- derived view over study_events; manual blocks are stored intervals merged into that
-- view at read time (session list + time-studied totals only; heatmap/cadence stay
-- graded-only). `doc` is the learn-doc-key, like study_events.
CREATE TABLE manual_sessions (
  key text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  start_ts timestamptz NOT NULL, end_ts timestamptz NOT NULL,
  note text, created_at timestamptz DEFAULT now(),
  CHECK (end_ts > start_ts));
CREATE INDEX ON manual_sessions (doc, start_ts);

CREATE TABLE chapter_progress (key text PRIMARY KEY, doc_id text, scope text, stages jsonb);

-- ═══════════════════════════════════════════════════════════════════════
-- operational — the job ledger + queue flag. chapter_builds carries the doc FK
-- (its parent stub is created before the first convert job enqueues).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE chapter_builds (
  key text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_id text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  scope text, phase text, status text, done int, total int,
  error text, requested_at bigint, started_at bigint, finished_at bigint, not_before bigint,
  kind text, payload jsonb, cancel_requested boolean);
CREATE INDEX ON chapter_builds (doc_id);

CREATE TABLE learn_meta (key text PRIMARY KEY, paused boolean);

-- ═══════════════════════════════════════════════════════════════════════
-- frontend course-card + UI state (deferred — considered with the user layer)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE app_documents (
  key text PRIMARY KEY, id text, learn_doc_id text, name text, file jsonb,
  status text, upload_status text, processing_method text, original_pdf_name text,
  converted_from_pdf boolean, "order" int, size text,
  selected_section_keys jsonb, metadata jsonb,
  extracted_date timestamptz, last_updated timestamptz);

CREATE TABLE user_settings (key text PRIMARY KEY, course_groups jsonb, reading_progress jsonb, settings jsonb);
