-- v0.19.0 Practice items — the one item pool (docs/practice-items-spec.md).
-- Apply by hand:  docker compose exec -T postgres psql -U learnhub -d learnhub < this file
-- (mirror of the CREATE TABLE appended to init/01-schema.sql — keep both in one commit)

-- Practice items belong to the BOOK (doc_id = sources.key) like ext_concepts, so every
-- version inherits them through its blocks; reads go through concept_filter().
-- kind = HOW THE ANSWER IS CHECKED, not the subject:
--   retrieve | problem  self-graded against the revealed worked solution
--   mcq                 choice-checked      payload {"choices":[...],"answerIndex":0}
--   order               sequence-checked    payload {"steps":[...]}  (stored in correct order)
--   code                executed vs tests   payload {"language","starter","tests":[...],"timeoutMs"}
-- payload carries only what that kind's player reads; prompt/answer/rubric are shared.
-- edited_at IS NULL = generated + untouched = the regenerable set: a regenerate deletes
-- and rewrites only these rows, so hand polish is permanent.
CREATE TABLE ext_practice (
  key          text PRIMARY KEY,                -- uuid, never derived from content
  doc_id       text NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
  structure_id text REFERENCES raw_structure(id) ON DELETE CASCADE,
  section_key  text,
  kind         text NOT NULL,
  prompt       text,
  answer       text,                            -- the worked solution, markdown
  rubric       text,
  payload      jsonb,
  "order"      int,
  created_at   timestamptz,
  edited_at    timestamptz);
CREATE INDEX ON ext_practice (doc_id, section_key);
