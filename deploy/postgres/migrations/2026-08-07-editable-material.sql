-- Make the material editable, two ways.
--
-- Fixing the BOOK (conversion junk, OCR damage, a broken table) updates raw_content and
-- every course cut from that book sees it. Rewriting for ONE COURSE stores an override on
-- that version's mapping row — copy-on-write, so the book and the other versions are
-- untouched and the override survives a later fix to the book underneath it.
--
-- Staleness is DERIVED, never stored: a section's concepts are stale when its material was
-- edited after they were built. Comparing edited_at to ext_concepts.created_at answers that
-- without a flag anyone has to remember to set.
--
--   docker exec -i compose-postgres-1 psql -U learnhub -d learnhub \
--     -v ON_ERROR_STOP=1 < deploy/postgres/migrations/2026-08-07-editable-material.sql
--
-- Idempotent: safe to re-run.

SET search_path TO learnhub, public;

BEGIN;

-- When the BOOK's text was last edited. NULL = untouched since conversion.
ALTER TABLE raw_content
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- One course's own wording for a block it keeps. NULL = read the book's text.
ALTER TABLE version_blocks
  ADD COLUMN IF NOT EXISTS markdown_override text,
  ADD COLUMN IF NOT EXISTS edited_at         timestamptz;

COMMIT;
