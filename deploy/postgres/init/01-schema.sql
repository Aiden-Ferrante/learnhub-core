-- Learn Hub — PostgreSQL schema.
-- Runs once on first container init. Extensions are database-wide; tenant tables
-- live in a per-user schema selected per request via SET search_path (X-User-Db).
--
-- SECTIONS (table-name prefixes; each section is owned by one backend package):
--   sources  the uploaded book itself — the PDF and its file-level facts       (process/*)
--   raw_*    a COURSE VERSION over a source — the TOC as a tree, content, media (process/*)
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
--
-- The book/course seam: `sources` is the uploaded PDF, `raw_documents` is a course
-- VERSION over it, and deleting a source cascades through every version to the whole
-- graph. The split runs down the middle of the child tables:
--
--   the BOOK owns  raw_content · raw_elements · ext_concepts   (FK sources)
--   a VERSION owns raw_structure · ext_orient/skeleton/guides · all study state
--   version_blocks joins them: which of the book's blocks this version keeps, and where
--
-- So two versions of one book share its text and its extracted concepts while keeping
-- separate outlines and separate progress. Every read of a version's content goes
-- through the version_blocks join (see process/content/blocks.py) — a bare
-- `raw_content WHERE doc_id` is a read of the whole BOOK and ignores a version's cut.

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

-- THE BOOK. One row per uploaded PDF: the file-level facts that belong to the
-- source material itself and are true no matter how many courses are cut from it.
-- The PDF on disk lives at <SHARED_DIR>/ingest/<sources.key>/original.pdf and its
-- figures at <SHARED_DIR>/figures/<sources.key>/ — both keyed by the SOURCE, never
-- by a version.
CREATE TABLE sources (
  key             text PRIMARY KEY,
  title           text,
  source_filename text,
  source_hash     text,
  page_count      int,
  element_count   int,
  has_page_provenance boolean,
  created_at      timestamptz DEFAULT now());
CREATE INDEX ON sources (source_hash);

-- A COURSE VERSION over a source — a named path through the book. Every version
-- owns its own raw_structure tree and its own study state; the source's content
-- blocks and concepts are shared across all of them.
--
-- `key` is the learn-doc-key: the id every other table still references as doc_id,
-- which is why versioning cost no change to the ~48 doc-keyed queries. For books
-- ingested before versions existed, key == source_id (the identity backfill), so
-- every pre-existing row already points at the right version.
--
-- Born as a stub at upload alongside its source; the convert job flips status
-- converting→ready (or →error) and fills the counts. The full-document markdown is
-- NOT stored: it is reassembled from raw_content when a caller wants the whole blob.
CREATE TABLE raw_documents (
  key             text PRIMARY KEY,
  source_id       text NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Default',  -- the version's name
  -- CHECK, not convention: `origin = 'default'` is what `delete_version` refuses to
  -- delete and what the main-version fallback picks. A typo storing 'Default' or 'defualt'
  -- makes a book's canonical version deletable and leaves the fallback with nothing to
  -- choose, and the first visible symptom is a book losing every concept anchored to its
  -- tree (finding B7).
  origin          text NOT NULL DEFAULT 'default'
                    CHECK (origin IN ('default', 'custom')),  -- TOC-derived | user's cut
  is_main         boolean NOT NULL DEFAULT true,    -- the version the course card opens
  status          text NOT NULL DEFAULT 'ready',   -- converting | ready | error
  status_code     int,                             -- http status of a convert failure
  toc_route       text,                            -- TOC controller verdict: bookmarks |
                                                   -- bookmarks-pagematched | none
  section_count   int,
  char_count      int,
  created_at      timestamptz DEFAULT now(),
  last_updated    timestamptz);
CREATE INDEX ON raw_documents (source_id);
CREATE INDEX ON raw_documents (status, created_at DESC);
-- Exactly one main version per source, enforced here rather than in application code.
CREATE UNIQUE INDEX raw_documents_one_main_per_source ON raw_documents (source_id) WHERE is_main;

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

-- Content — the markdown, one block per split heading. Belongs to the BOOK: doc_id is
-- a source key, the text is stored once, and every version that keeps a block shares
-- this row. Where a block sits in a given version is version_blocks' business, not a
-- column here. `section_key` is the block's place in the book's own structure, which is
-- what concepts are extracted against.
CREATE TABLE raw_content (
  key          text PRIMARY KEY,
  doc_id       text NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
  section_key  text,
  number_key   text,
  heading      text,
  level        int,
  "order"      int,
  markdown     text,
  char_count   int,
  page_start   int,
  page_end     int,
  edited_at    timestamptz);   -- book-level edit; NULL = untouched since conversion
CREATE INDEX ON raw_content (doc_id, "order");
CREATE INDEX ON raw_content (doc_id, section_key);

-- A VERSION'S MATERIAL: which of the book's blocks this version keeps, where it places
-- them, and in what order. Distilling a book is dropping rows here, not copying markdown.
-- A Default version holds one row per block of its source, seeded at convert to
-- reproduce the book's own structure — so the default reading experience is the general
-- mechanism applied to the trivial case, not a separate code path.
-- markdown_override is copy-on-write: this course's own wording for a block it keeps.
-- NULL = read the book's text, so a later fix to the book flows through; non-NULL wins and
-- survives that fix. Editing the BOOK instead writes raw_content and reaches every version.
CREATE TABLE version_blocks (
  version_id   text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  content_key  text NOT NULL REFERENCES raw_content(key)   ON DELETE CASCADE,
  structure_id text REFERENCES raw_structure(id) ON DELETE SET NULL,  -- the section in THIS version
  "order"      int  NOT NULL,
  markdown_override text,
  edited_at    timestamptz,
  PRIMARY KEY (version_id, content_key));
CREATE INDEX ON version_blocks (version_id, "order");
CREATE INDEX ON version_blocks (structure_id);

-- Media — figures / tables / code, anchored to a structure node + page.
CREATE TABLE raw_elements (
  key           text PRIMARY KEY,
  doc_id        text NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
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

-- Concepts — many per structure node. Belong to the BOOK (doc_id is a source key):
-- they are extracted from the book's text against the book's own sections, so a custom
-- version inherits them through its blocks instead of re-running extraction. No page
-- columns: a concept inherits its section's page span from raw_structure.
CREATE TABLE ext_concepts (
  key           text PRIMARY KEY,
  doc_id        text NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
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

-- Practice items — the one item pool (docs/practice-items-spec.md). Belong to the BOOK
-- (doc_id = sources.key) like ext_concepts, so every version inherits them through its
-- blocks; reads go through concept_filter().
-- kind = HOW THE ANSWER IS CHECKED, not the subject:
--   retrieve | problem  self-graded against the revealed worked solution
--   mcq                 choice-checked      payload {"choices":[...],"answerIndex":0}
--   order               sequence-checked    payload {"steps":[...]}  (stored in correct order)
--   code                executed vs tests   payload {"language","starter","tests":[...],"timeoutMs"}
-- payload carries only what that kind's player reads; prompt/answer/rubric are shared.
-- edited_at IS NULL = generated + untouched = the regenerable set: a regenerate deletes
-- and rewrites only these rows, so hand polish is permanent. Keys are uuids, deliberately
-- not content hashes — items anchor to (doc_id, section_key) and never need rename chasing.
CREATE TABLE ext_practice (
  key          text PRIMARY KEY,
  doc_id       text NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
  structure_id text REFERENCES raw_structure(id) ON DELETE CASCADE,
  section_key  text,
  kind         text NOT NULL,
  prompt       text,
  answer       text,
  rubric       text,
  payload      jsonb,
  difficulty   smallint CHECK (difficulty BETWEEN 1 AND 3),  -- 1 direct · 2 combines · 3 constructs; NULL = unrated
  "order"      int,
  created_at   timestamptz,
  edited_at    timestamptz);
CREATE INDEX ON ext_practice (doc_id, section_key);

-- An exam SITTING. Quiz and practice stay live queries over ext_practice; an exam does not,
-- for three reasons that all need persistence: the paper must FREEZE at the start (a
-- regeneration mid-exam must not shift the questions under you), answers must survive a
-- reload, and a resit needs two stored sittings to compare.
--
-- doc_id is the VERSION sat (the study_events convention); items resolve to the book
-- through ext_practice, so a re-cut course still renders a sitting taken before the cut.
-- No FK to raw_documents: a sitting is a historical record and outlives its course.
CREATE TABLE exam_sessions (
  key         text PRIMARY KEY,
  doc_id      text NOT NULL,
  scope       text,
  config      jsonb,
  items       jsonb NOT NULL,
  answers     jsonb,
  resit_of    text REFERENCES exam_sessions(key) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'open',
  started_at  timestamptz,
  finished_at timestamptz);
CREATE INDEX ON exam_sessions (doc_id, started_at DESC);

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
  kind text, payload jsonb, cancel_requested boolean,
  -- Times this job has been handed to a runner. Incremented on RECOVERY, not on claim: a
  -- job that runs and fails cleanly is settled as error and never requeued, so counting
  -- claims would cap the wrong thing. Bounds the crash-requeue-crash loop (C5).
  attempts int NOT NULL DEFAULT 0);
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
