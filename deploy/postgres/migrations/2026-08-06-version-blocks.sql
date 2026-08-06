-- Share a book's material across its course versions.
--
-- Step 2 of custom course versions (after the source/version split). The book's
-- markdown stops belonging to a version and starts belonging to the SOURCE; which
-- blocks a version keeps, and where it puts them, moves into `version_blocks`.
--
-- Identity seed again: every existing version gets a mapping row per block it already
-- had, at the same order and the same section, so its reading experience is unchanged.
--
--   docker exec -i compose-postgres-1 psql -U learnhub -d learnhub \
--     -v ON_ERROR_STOP=1 < deploy/postgres/migrations/2026-08-06-version-blocks.sql
--
-- Idempotent: safe to re-run.

SET search_path TO learnhub, public;

BEGIN;

-- 1. Which blocks a version keeps, and where it places them.
CREATE TABLE IF NOT EXISTS version_blocks (
  version_id   text NOT NULL REFERENCES raw_documents(key) ON DELETE CASCADE,
  content_key  text NOT NULL REFERENCES raw_content(key)   ON DELETE CASCADE,
  structure_id text REFERENCES raw_structure(id) ON DELETE SET NULL,
  "order"      int  NOT NULL,
  PRIMARY KEY (version_id, content_key));
CREATE INDEX IF NOT EXISTS version_blocks_version_order_idx ON version_blocks (version_id, "order");
CREATE INDEX IF NOT EXISTS version_blocks_structure_idx     ON version_blocks (structure_id);

-- 2. Seed each existing version with exactly the blocks it has today, in the same
--    order and the same section. Must run BEFORE raw_content.structure_id is dropped.
INSERT INTO version_blocks (version_id, content_key, structure_id, "order")
SELECT c.doc_id, c.key, c.structure_id, c."order"
FROM raw_content c
WHERE EXISTS (SELECT 1 FROM raw_documents d WHERE d.key = c.doc_id)
ON CONFLICT (version_id, content_key) DO NOTHING;

-- 3. The material now belongs to the book. The data does not move: for every book
--    ingested so far doc_id is already the source key (key == source_id), so this
--    only retargets the constraint.
ALTER TABLE raw_content  DROP CONSTRAINT IF EXISTS raw_content_doc_id_fkey;
ALTER TABLE raw_content  ADD  CONSTRAINT raw_content_doc_id_fkey
  FOREIGN KEY (doc_id) REFERENCES sources(key) ON DELETE CASCADE;

ALTER TABLE raw_elements DROP CONSTRAINT IF EXISTS raw_elements_doc_id_fkey;
ALTER TABLE raw_elements ADD  CONSTRAINT raw_elements_doc_id_fkey
  FOREIGN KEY (doc_id) REFERENCES sources(key) ON DELETE CASCADE;

-- Concepts are extracted from the book's text against the book's own sections, so a
-- version inherits them rather than re-running extraction. They belong to the source.
ALTER TABLE ext_concepts DROP CONSTRAINT IF EXISTS ext_concepts_doc_id_fkey;
ALTER TABLE ext_concepts ADD  CONSTRAINT ext_concepts_doc_id_fkey
  FOREIGN KEY (doc_id) REFERENCES sources(key) ON DELETE CASCADE;

-- 4. Placement now lives in version_blocks; a source-owned block must not carry an FK
--    into one version's tree (rebuilding that tree would have cascade-deleted the
--    book's text).
ALTER TABLE raw_content DROP COLUMN IF EXISTS structure_id;

-- raw_elements.structure_id and ext_concepts.structure_id keep their existing
-- ON DELETE CASCADE anchors into the Default version's tree. That is deliberate: it is
-- what makes a re-convert drop stale figures and concepts today, and changing it here
-- would be a silent semantic change inside a migration whose whole claim is that nothing
-- changes. Known consequence to handle when versions become deletable: deleting the
-- DEFAULT version would cascade away the source's concepts, which is one more reason the
-- Default is not deletable.

COMMIT;
