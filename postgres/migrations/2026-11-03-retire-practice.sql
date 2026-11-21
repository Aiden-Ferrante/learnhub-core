-- v0.25.1 Retire practice. The old practice session and exam mode left the UI in v0.25.0;
-- this removes their data and tables. Irreversible: back up first (pg_dump the two tables).
-- Apply by hand on the stack you mean to change:
--   docker exec -i <postgres> psql -U learnhub -d learnhub \
--     -c "SET search_path TO learnhub, public" -f - < this file
-- (mirror of the tables removed from init/01-schema.sql; keep both in one commit)
--
-- Pack rows are NOT touched: pack-* reviews stay, and pack Learn grades still log study
-- event kind 'practice'. Only rows keyed to practice items (prac-*) or practice jobs go.
SET search_path TO learnhub, public;
BEGIN;
DELETE FROM study_events    WHERE concept_key LIKE 'prac-%';
DELETE FROM concept_reviews WHERE item_type = 'practice' OR key LIKE 'prac-%';
DELETE FROM chapter_builds  WHERE kind = 'practice';
DROP TABLE exam_sessions;
DROP TABLE ext_practice;
COMMIT;
