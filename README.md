# Learn Hub

Turn a textbook PDF into something you can actually study: a structured reader, an
extracted concept layer, and a spaced-repetition loop that schedules what to review next.

Runs entirely on your own machine. No API keys, no third-party inference — every LLM pass
goes to a local [Ollama](https://ollama.com) instance.

## Why

Reading a textbook and *knowing* a textbook are different activities, and most tools only
help with the first. PDF readers give you pages; flashcard apps give you a review queue but
make you author every card by hand; note apps store what you already understood.

Learn Hub closes the loop. It converts a PDF into a navigable structure (parts → chapters →
sections), runs a local LLM over a chapter to extract its concepts, and turns those into two
graded activities — **skeleton recall** (can you reconstruct the chapter's shape?) and
**concept recall** (do you know the ideas inside it?). Both feed one FSRS-scheduled review
queue, so the system decides what is due rather than asking you to.

Extraction is per-chapter and on demand: a whole-book LLM pass is hours, not seconds, and
studying chapter 2 shouldn't wait on chapter 40.

## Quickstart

Requirements: Docker with Compose, and ~8 GB free for models. An NVIDIA GPU is optional but
strongly recommended — the converter and extraction passes are much slower on CPU.

```bash
git clone https://github.com/Aiden-Ferrante/learnhub-core.git
cd learnhub-core

cp deploy/compose/.env.example deploy/compose/.env
# Fill in both values; compose fails fast if either is empty:
#   POSTGRES_PASSWORD  — database password
#   AUTH_SECRET        — session signing key, e.g. openssl rand -base64 32

./start.sh
```

Then open <http://localhost:3001>.

Pull the models the stack expects (once):

```bash
docker compose -f deploy/compose/docker-compose.yml exec ollama \
  ollama pull nemotron-3-nano:30b   # concept extraction
docker compose -f deploy/compose/docker-compose.yml exec ollama \
  ollama pull gemma4:latest         # quiz authoring + critic pass
```

`./stop.sh` stops everything **except** Ollama, which is shared with other local apps and is
managed independently.

> **First login:** Learn Hub has no self-serve signup. Accounts are rows in the `auth.users`
> table (username, bcrypt-style `password_hash`, and a tenant `schema_name`) and are inserted
> directly against Postgres. A provisioning command is a known gap — see [Status](#status).

## Ports

| Port | Service | Notes |
|---|---|---|
| `3001` | `app` — Next.js 15 UI | The only port you open in a browser |
| `8010` | `learn` — FastAPI engine | Bound to `127.0.0.1` only |
| `5432` | `postgres` | The single datastore |
| `11434` | `ollama` | **Shared** with other local apps; not owned by this stack |

## Seam

How other things talk to Learn Hub, and how its pieces talk to each other:

- **Browser → `app` (:3001).** The Next.js layer owns auth and the UI, and proxies
  `/api/learn/*` through to the backend.
- **`app` → `learn` (:8010)** over `LEARN_SERVICE_URL`, attaching an **`X-User-Db`** header.
  That header is the tenancy seam: it selects the caller's Postgres schema, so one deployment
  serves multiple users without their data mixing.
- **`learn` → Ollama** over `OLLAMA_BASE_URL`. Ollama is deliberately *not* owned by this
  stack — `stop.sh` uses `rm -sf` on the other services rather than `down`, because `down`
  would tear out the compose network and detach the still-running shared container.
- **Postgres is the one datastore.** Auth, documents, extracted concepts, and study state all
  live there; ArangoDB and Qdrant were retired.

## Layout

```
frontend/   Next.js 15 + React 19 (pnpm) — auth, UI, proxy layer
backend/    FastAPI service — a domain-partitioned modular monolith
deploy/     compose stack, service Dockerfiles, Postgres init SQL
docs/       ADRs, specs, generated code map
scripts/    repo checks (module-hub contract, chapter drift) + MAP.md generator
```

The backend's dependency rule is `gateways ← process/content ← domains ← conductor ← api`,
with every package's `__init__.py` acting as its facade — the only thing another package may
import. There are zero import cycles, and `scripts/check_hubs.py` keeps it that way.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the design and [MAP.md](MAP.md) for a
file-level index. Decisions are recorded in [docs/adr/](docs/adr/).

## Development

```bash
./start.sh --dev-frontend    # frontend only, hot reload on :3000, no Docker

# Rebuild after changing backend or frontend source:
docker compose -f deploy/compose/docker-compose.yml build learn
docker compose -f deploy/compose/docker-compose.yml up -d learn

# Backend tests:
docker run --rm \
  -v "$PWD/backend/app:/app/app" -v "$PWD/backend/tests:/app/tests" \
  compose-learn:latest sh -c "pip install -q pytest; python -m pytest tests -q"
```

Task tracking uses [Backlog.md](https://github.com/MrLesk/Backlog.md) — `backlog task list`.

## Status

Working and in daily use. Known gaps, tracked rather than hidden:

- **No account provisioning command.** Users are inserted into `auth.users` by hand.
- **`/health` returns `{"status":"ok"}`**, not the `{ok, checks, freshness}` shape the rest of
  the local fleet uses.
- **No Makefile.** The stack is driven by `start.sh` / `stop.sh`; there is no
  `make dev` / `make prod` / `make test`.

## License

See [LICENSE](LICENSE).
