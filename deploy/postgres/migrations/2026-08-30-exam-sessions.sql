-- v0.20.0 Sit the exam — the one assembly that stores a row.
-- Apply by hand:  docker compose exec -T postgres psql -U learnhub -d learnhub \
--                   -c "SET search_path TO learnhub, public" -f - < this file
-- (mirror of the CREATE TABLE appended to init/01-schema.sql — keep both in one commit)

-- An exam SITTING. Quiz and practice stay live queries over ext_practice; an exam does not,
-- for three reasons that all need persistence: the paper must FREEZE at the start (a
-- regeneration mid-exam must not shift the questions under you), answers must survive a
-- reload, and a resit needs two stored sittings to compare.
--
-- doc_id is the VERSION sat (the study_events convention); items resolve to the book
-- through ext_practice, so a re-cut course still renders a sitting taken before the cut.
-- No FK to raw_documents: a sitting is a historical record and outlives its course.
CREATE TABLE exam_sessions (
  key         text PRIMARY KEY,              -- uuid
  doc_id      text NOT NULL,
  scope       text,                          -- NULL = multi-chapter; else the single chapter
  config      jsonb,                         -- {chapters:[...], kinds:[...], perChapter:n}
  items       jsonb NOT NULL,                -- ["<ext_practice.key>", ...] frozen, ordered
  answers     jsonb,                         -- {itemKey: {response, selfGrade, at}}
  resit_of    text REFERENCES exam_sessions(key) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'open',  -- open | finished | abandoned
  started_at  timestamptz,
  finished_at timestamptz);
CREATE INDEX ON exam_sessions (doc_id, started_at DESC);
