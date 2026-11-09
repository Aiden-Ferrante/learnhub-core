# Contributing

- **Tests:** `python -m pytest backend/tests -q`. Postgres integration tests run only with
  `LEARN_PG_TESTS=1` and a reachable database (see [docs/testing.md](docs/testing.md)).
- **Import rules:** every package's `__init__.py` is the only thing other packages may
  import. Run `python scripts/check_hubs.py` and `node frontend/scripts/check-hubs.mjs`
  before you push; CI fails on any violation.
- **File index:** after adding, moving or deleting files, run `python scripts/gen_map.py`
  so [MAP.md](MAP.md) stays current.
- **Docker:** a source change reaches the running app only after
  `docker compose -f deploy/compose/docker-compose.yml build <service> && ... up -d <service>`.
- **Careful:** `DELETE /api/document` cannot be undone. Read its deletion impact first.
- Decisions go in [docs/adr/](docs/adr/); changes go in [CHANGELOG.md](CHANGELOG.md).
