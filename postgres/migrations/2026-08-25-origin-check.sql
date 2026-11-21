-- B7 (v0.17.0): constrain raw_documents.origin at the database.
--
-- `origin` decides which version cannot be deleted and which one the main-version fallback
-- picks. Held only by application convention, one typo ('Default', 'defualt') makes a book's
-- canonical version deletable and leaves the fallback with no candidate — and the first
-- visible symptom is a book losing every concept anchored to its tree.
--
-- Idempotent, and it repairs before it constrains: a row that has already drifted is folded
-- to the value its data implies rather than blocking the migration.

BEGIN;

UPDATE raw_documents SET origin = 'default' WHERE lower(btrim(origin)) = 'default';
UPDATE raw_documents SET origin = 'custom'  WHERE lower(btrim(origin)) = 'custom';
-- Anything still unrecognised is a user's cut by elimination: a book has exactly one
-- TOC-derived version, and it is the one named 'default'.
UPDATE raw_documents SET origin = 'custom' WHERE origin NOT IN ('default', 'custom');

ALTER TABLE raw_documents DROP CONSTRAINT IF EXISTS raw_documents_origin_check;
ALTER TABLE raw_documents
  ADD CONSTRAINT raw_documents_origin_check CHECK (origin IN ('default', 'custom'));

COMMIT;
