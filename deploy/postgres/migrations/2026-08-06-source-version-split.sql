-- Split the book (sources) from the course version (raw_documents).
--
-- This is an IDENTITY migration: every existing document becomes a source AND its
-- own Default version, keyed identically. No row moves, no id changes, and every
-- pre-existing raw_/ext_/study row and app_documents.learn_doc_id card therefore
-- already points at the right thing.
--
--   docker exec -i compose-postgres-1 psql -U learnhub -d learnhub \
--     -v ON_ERROR_STOP=1 < deploy/postgres/migrations/2026-08-06-source-version-split.sql
--
-- Idempotent: safe to re-run.

SET search_path TO learnhub, public;

BEGIN;

-- 1. The book.
CREATE TABLE IF NOT EXISTS sources (
  key             text PRIMARY KEY,
  title           text,
  source_filename text,
  source_hash     text,
  page_count      int,
  element_count   int,
  has_page_provenance boolean,
  created_at      timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS sources_source_hash_idx ON sources (source_hash);

-- 2. One source per existing document, same key.
INSERT INTO sources (key, title, source_filename, source_hash, page_count,
                     element_count, has_page_provenance, created_at)
SELECT key, title, source_filename, source_hash, page_count,
       element_count, has_page_provenance, created_at
FROM raw_documents
ON CONFLICT (key) DO NOTHING;

-- 3. raw_documents becomes a version.
ALTER TABLE raw_documents
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS name      text NOT NULL DEFAULT 'Default',
  ADD COLUMN IF NOT EXISTS origin    text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS is_main   boolean NOT NULL DEFAULT true;

UPDATE raw_documents SET source_id = key WHERE source_id IS NULL;

ALTER TABLE raw_documents ALTER COLUMN source_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raw_documents_source_id_fkey') THEN
    ALTER TABLE raw_documents
      ADD CONSTRAINT raw_documents_source_id_fkey
      FOREIGN KEY (source_id) REFERENCES sources(key) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS raw_documents_source_id_idx ON raw_documents (source_id);
CREATE UNIQUE INDEX IF NOT EXISTS raw_documents_one_main_per_source
  ON raw_documents (source_id) WHERE is_main;

-- 4. Drop what now belongs to the source. Done last so steps 1-3 can be verified
--    against the old columns if this is run interactively.
ALTER TABLE raw_documents
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS source_filename,
  DROP COLUMN IF EXISTS source_hash,
  DROP COLUMN IF EXISTS page_count,
  DROP COLUMN IF EXISTS element_count,
  DROP COLUMN IF EXISTS has_page_provenance;

COMMIT;
