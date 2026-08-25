# Testing

## Two tiers

**Unit (default).** Pure functions — schedulers, clustering, markdown/outline algebra, card
shapers. No DB, no network. Fast, run everywhere:

```
cd backend && .venv/bin/python -m pytest -q
```

**Integration (`@pytest.mark.integration`).** Real-Postgres round-trips. Skipped unless
`LEARN_PG_TESTS=1` is set, so the default run stays DB-free. They connect via the normal
`app.gateways.db` pool (default DSN → `localhost:5432`), so a reachable Postgres with the
`learnhub` schema is required — the running compose stack works:

```
cd backend && LEARN_PG_TESTS=1 .venv/bin/python -m pytest -m integration -q
```

Integration tests write under a dedicated `pgtest-` doc id and wipe themselves before and
after (fixture in `tests/test_review_roundtrip_pg.py`), so they're safe against the live dev DB.

## Why the integration tier exists

Every unit test fixtures or avoids the DB, so a live psycopg3 quirk — a NULL param that
server-side binding couldn't type inside a `CASE WHEN` — 500'd *every* review re-grade while
89 green unit tests said nothing (commit d4541df). The integration tests walk the exact path
that regressed (seed a due review → queue serves it → grade → **re-grade the same row**) and
catch that whole class: server-side binding, and drift between `deploy/postgres/init/01-schema.sql`
and the code's SQL.

## The grounding check

`app/process/extraction/grounding.py` answers one question: does a concept's
`source_sentence` actually appear in the section it claims to come from? The extraction gate
only checks the field is non-empty, so an invented quote passes it — this is the check that
does not.

It lives in two places on purpose:

- **CI** — `tests/test_grounding_pg.py` seeds a corpus containing one of every verdict,
  including an invented quote, and asserts the check catches it. A check that cannot fail is
  worth nothing, so CI proves it can.
- **A real library** — `scripts/check_grounding.py`, run against your own database. This is
  the one that tells you something new; the CI test only guards the checker.

The script is deliberately **not** a CI step. CI's Postgres is seeded from the schema and
holds no concepts, so running it there would be green forever. It treats an empty corpus as
absent information and exits non-zero, the same rule the study surfaces follow.

## CI

`.github/workflows/backend-tests.yml` runs both tiers on backend/schema changes: a
`pgvector/pgvector:pg16` service seeded from `01-schema.sql`, then `pytest -q` with
`LEARN_PG_TESTS=1`. The hub contracts + MAP check run separately in `code-map.yml`.
