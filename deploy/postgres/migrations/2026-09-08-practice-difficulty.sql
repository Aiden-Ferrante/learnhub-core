-- v0.23.0 Set the paper — an item carries a difficulty so a paper can be drawn by it.
-- Apply by hand:  docker compose exec -T postgres psql -U learnhub -d learnhub \
--                   -c "SET search_path TO learnhub, public" -f - < this file
-- (mirror of the column in init/01-schema.sql — keep both in one commit)

-- 1 = applies one definition or rule directly · 2 = combines several steps or two ideas ·
-- 3 = constructs, proves, or is multi-part. Rated by the model at generation, editable in
-- the Practice tab. NULL = unrated; drawn only when a paper sets no difficulty filter.
ALTER TABLE ext_practice ADD COLUMN difficulty smallint CHECK (difficulty BETWEEN 1 AND 3);
