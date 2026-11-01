-- v0.24.0 Exam packs. Apply by hand on the stack you mean to change:
--   docker exec -i <postgres> psql -U learnhub -d learnhub \
--     -c "SET search_path TO learnhub, public" -f - < this file
-- (mirror of the tables appended to init/01-schema.sql; keep both in one commit)

-- A pack: chapters picked from one textbook, built once, sat many times.
CREATE TABLE exam_packs (
  key         text PRIMARY KEY,
  doc_id      text NOT NULL,                 -- the version picked from
  title       text NOT NULL,
  config      jsonb NOT NULL,                -- {format:{count,minutes,choices,writtenShare,closedBook}, scopeNotes}
  exam_date   date,
  status      text NOT NULL DEFAULT 'building',  -- building | ready | failed
  receipt     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON exam_packs (doc_id, created_at DESC);

-- One chapter of a pack. Opens as soon as its own build finishes.
CREATE TABLE pack_units (
  key         text PRIMARY KEY,
  pack_key    text NOT NULL REFERENCES exam_packs(key) ON DELETE CASCADE,
  section_key text NOT NULL,                 -- the chapter's scope key
  title       text NOT NULL,
  "order"     int NOT NULL,
  status      text NOT NULL DEFAULT 'queued',  -- queued | building | ready | failed
  chunk       jsonb,                         -- {points:[{text,sectionKey}], source:book_summary|sections}
  receipt     jsonb,
  progress    jsonb NOT NULL DEFAULT '{}');  -- {chunk:true, steps:true, test:{good,total}}
CREATE INDEX ON pack_units (pack_key, "order");

-- A learn or exam item. role decides where it may appear; an exam reads role='exam' only.
CREATE TABLE pack_items (
  key         text PRIMARY KEY,
  pack_key    text NOT NULL REFERENCES exam_packs(key) ON DELETE CASCADE,
  unit_key    text NOT NULL REFERENCES pack_units(key) ON DELETE CASCADE,
  skill       text NOT NULL,
  skill_label text NOT NULL,
  weight      real NOT NULL DEFAULT 1,
  role        text NOT NULL CHECK (role IN ('learn', 'exam')),
  origin      text NOT NULL CHECK (origin IN ('book_problem', 'variant', 'generated')),
  qtype       text NOT NULL CHECK (qtype IN ('gen', 'mcq', 'written', 'worked')),
  section_key text NOT NULL,                 -- the citation; every item has one
  evidence    text NOT NULL,                 -- quoted from that section, checked at build
  payload     jsonb NOT NULL,
  -- A book problem is never exam material, whatever a future caller does.
  CHECK (origin <> 'book_problem' OR role = 'learn'));
CREATE INDEX ON pack_items (pack_key, role);

-- A frozen paper: the instances themselves, so nothing shifts under a sitting.
CREATE TABLE pack_sittings (
  key         text PRIMARY KEY,
  pack_key    text NOT NULL REFERENCES exam_packs(key) ON DELETE CASCADE,
  questions   jsonb NOT NULL,
  answers     jsonb NOT NULL DEFAULT '{}',
  minutes     int,
  short_by    int NOT NULL DEFAULT 0,        -- questions the pool could not supply unseen
  status      text NOT NULL DEFAULT 'open',  -- open | finished
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz);
CREATE INDEX ON pack_sittings (pack_key, started_at DESC);

-- What this pack has shown, so an exam only uses instances you have not seen.
CREATE TABLE pack_seen (
  pack_key    text NOT NULL REFERENCES exam_packs(key) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  PRIMARY KEY (pack_key, fingerprint));

-- A saved format per course.
CREATE TABLE pack_presets (
  doc_id  text NOT NULL,
  name    text NOT NULL,
  format  jsonb NOT NULL,
  PRIMARY KEY (doc_id, name));
