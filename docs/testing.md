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

## CI

`.github/workflows/backend-tests.yml` runs both tiers on backend/schema changes: a
`pgvector/pgvector:pg16` service seeded from `01-schema.sql`, then `pytest -q` with
`LEARN_PG_TESTS=1`. The hub contracts + MAP check run separately in `code-map.yml`.
