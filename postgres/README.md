# Postgres

The one datastore (Postgres 16, compose service `postgres`). Every part reads and writes it: the
Frontend for sign-in and per-user settings, the Learn Engine for content, concepts and study state.

- `init/01-schema.sql`: the full schema, applied only when the data volume is empty.
- `migrations/`: dated changes for an existing volume. Run by hand, one at a time, with the
  human's OK; each file's header says how. Fold every change into `init/` too.
- `tools/`: one-off data moves (e.g. the 2026 ArangoDB → Postgres import). Historical.

Planned: pgvector here for semantic search embeddings and the concept graph's links (decided
2026-11-21; not installed yet: it needs a migration).
