-- Learn Hub — PostgreSQL schema (ArangoDB migration).
-- Runs once on first container init. Extensions are database-wide; tenant tables
-- live in a per-user schema selected per request via SET search_path (X-User-Db).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── shared auth (was learnhub_auth.users) ───────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  username      text PRIMARY KEY,
  password_hash text NOT NULL,      -- was passwordHash, verbatim
  display_name  text,
  role          text,
  schema_name   text NOT NULL,      -- was users.dbName → the tenant schema
  created_at    timestamptz
);

-- ── default tenant schema (matches today's DB name) ─────────────────────
CREATE SCHEMA IF NOT EXISTS learnhub;
-- include public so the pgvector `vector` type (installed in public) resolves
SET search_path TO learnhub, public;

CREATE TABLE documents (
  key text PRIMARY KEY, title text, source_filename text, source_hash text,
  markdown text, outline jsonb,
  page_count int, section_count int, element_count int, char_count int,
  page_block_count int, has_page_provenance boolean, created_at timestamptz);

CREATE TABLE app_documents (
  key text PRIMARY KEY, id text, learn_doc_id text, name text, file jsonb,
  status text, upload_status text, processing_method text, original_pdf_name text,
  converted_from_pdf boolean, "order" int, size text,
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
  prereq_names jsonb, questions jsonb, quiz_questions jsonb, embedding vector(384), created_at timestamptz);
CREATE INDEX ON concepts (doc_id, section_key);
CREATE INDEX ON concepts USING hnsw (embedding vector_cosine_ops);

CREATE TABLE content_vectors (
  key text PRIMARY KEY, doc_id text NOT NULL, section_key text, heading text, text text,
  page_start int, page_end int, embedding vector(384));
CREATE INDEX ON content_vectors USING hnsw (embedding vector_cosine_ops);

CREATE TABLE concept_reviews (
  key text PRIMARY KEY DEFAULT gen_random_uuid()::text, doc_id text, section_key text, due timestamptz, ease real,
  interval double precision, reps int, lapses int, state text, last_grade int, last_review timestamptz,
  item_type text, chapter_scope text, first_review timestamptz, caption text, page int, "order" int,
  heading text, children jsonb, figure_order int);
CREATE INDEX ON concept_reviews (doc_id, due);

CREATE TABLE study_events (
  key text PRIMARY KEY DEFAULT gen_random_uuid()::text, doc text, section_key text, concept_key text,
  kind text, correct boolean, ts timestamptz,
  confidence text, triple_id text, stem text, expected text);
CREATE INDEX ON study_events (doc, ts);
CREATE INDEX ON study_events (concept_key);

CREATE TABLE chapter_builds (
  key text PRIMARY KEY DEFAULT gen_random_uuid()::text, doc_id text, scope text, phase text, status text, done int, total int,
  error text, requested_at bigint, started_at bigint, finished_at bigint, not_before bigint, kind text, payload jsonb, cancel_requested boolean);

CREATE TABLE chapter_progress    (key text PRIMARY KEY, doc_id text, scope text, stages jsonb);
CREATE TABLE chapter_orient      (key text PRIMARY KEY, doc_id text, scope text, objectives jsonb, watch_for jsonb, created_at timestamptz);
CREATE TABLE chapter_skeletons   (key text PRIMARY KEY, doc_id text, scope text, sections jsonb, created_at timestamptz);
CREATE TABLE deep_chapter_briefing (key text PRIMARY KEY, doc_id text, scope text, concept_count int,
  key_concepts jsonb, objectives jsonb, sections jsonb, watch_for jsonb, created_at timestamptz);
CREATE TABLE reading_guides   (key text PRIMARY KEY, doc_id text, section_key text, focus text, checks jsonb, created_at timestamptz);
CREATE TABLE section_augment  (key text PRIMARY KEY, doc_id text, section_key text, objectives jsonb, recap jsonb);
-- Schemaless per-user settings (course groups, reading progress, prompts, …) as one blob,
-- matching the frontend's merge-arbitrary-keys contract. The legacy typed columns are kept
-- for provenance of the migrated row; the app reads/writes only `settings`.
CREATE TABLE user_settings    (key text PRIMARY KEY, course_groups jsonb, reading_progress jsonb, settings jsonb);
CREATE TABLE learn_meta       (key text PRIMARY KEY, paused boolean);
