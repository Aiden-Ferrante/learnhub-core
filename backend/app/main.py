"""Learn Hub backend: concept-grounded study over ingested textbooks.

Composition root only — the FastAPI app, the tenancy middleware, and `/health` + the landing
page. Every API surface lives in a router under `app/api/` (mounted via `all_routers`); every
algorithm lives in a domain package. If you're adding a route here, it belongs in a router.
"""

import os

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from app.api import all_routers
from app.conductor import install as install_job_runners
from app.gateways import set_request_db_name

app = FastAPI(title="Learn Hub", version="0.2.0")

# Assembly: connect the jobs ledger to its runners, then mount every router.
install_job_runners()
for _router in all_routers:
    app.include_router(_router)


@app.middleware("http")
async def user_db_middleware(request: Request, call_next):
    # Multi-tenancy: the Next.js proxy forwards the session user's Postgres
    # schema in X-User-Db. Invalid/absent values fall back to the env default.
    set_request_db_name(request.headers.get("x-user-db"))
    return await call_next(request)


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/", response_class=HTMLResponse)
def landing() -> str:
    shared = os.environ.get("SHARED_DIR", "/shared")
    pg_dsn = os.environ.get("POSTGRES_DSN", "")
    # Show host/dbname only — never echo the password into an HTML page.
    pg_summary = " ".join(
        p for p in pg_dsn.split() if p.split("=", 1)[0] in ("host", "port", "dbname")
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Learn Hub backend</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }}
    code {{ background: #eee; padding: 0.15rem 0.4rem; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>Learn Hub backend</h1>
  <p>This is the API service; the app lives in the Next.js frontend. See <code>/health</code>.</p>
  <p>Shared volume: <code>{shared}</code></p>
  <p>Postgres: <code>{pg_summary}</code></p>
</body>
</html>"""
