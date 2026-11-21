-- C5 (v0.18.0): give interrupted jobs an attempt count, so retries can be capped and backed off.
--
-- `requeue_interrupted()` marks every job a restart left `running` back to `queued`. With no
-- attempt count that is an unbounded loop: a job that crashes the worker is requeued, crashes
-- it again, and is requeued again, forever — and because the worker is single-threaded, every
-- other job sits behind it. `not_before` already exists and `next_job` already honours it, so
-- the backoff needs no new machinery; only somewhere to count.
--
-- Idempotent.

BEGIN;

ALTER TABLE chapter_builds ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

COMMENT ON COLUMN chapter_builds.attempts IS
  'Times this job has been handed to a runner. Incremented by requeue_interrupted() on '
  'recovery, not by next_job() — a job that runs and fails cleanly is settled as error and '
  'never requeued, so counting claims would cap the wrong thing.';

COMMIT;
