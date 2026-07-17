"""PostgreSQL connection + per-request tenancy — the ONE place a DB handle comes from.

Mirrors the old ``platform/arango.py`` contract so ``main.py``'s X-User-Db middleware
is unchanged: it calls ``set_request_db_name()`` per request; every domain module gets a
connection via ``db()``. Tenancy is a request-scoped ContextVar → ``SET search_path`` on
checkout, so ported SQL stays schema-unqualified (like collection-name-only AQL).

DSN comes from ``POSTGRES_DSN`` (the compose ``learn`` service sets host=postgres); the
default targets a host-published Postgres for scripts/tests.
"""
from __future__ import annotations

import os
import re
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_DSN = os.environ.get("POSTGRES_DSN") or (
    "host=localhost port=5432 user=learnhub password=learnhub_local dbname=learnhub"
)


# autocommit=True matches Arango's per-operation semantics (the ported code has no
# explicit transactions); a request that needs one can use `with conn.transaction()`.
# dict_row so ported queries read rows by column name (aliased back to the camelCase
# keys the callers expect, e.g. SELECT doc_id AS "docId").
_pool = ConnectionPool(
    _DSN, min_size=1, max_size=8, open=True,
    kwargs={"autocommit": True, "row_factory": dict_row},
)

_REQUEST_SCHEMA: ContextVar[str | None] = ContextVar("request_schema", default=None)
_NAME = re.compile(r"^[a-zA-Z0-9_-]+$")


def set_request_db_name(name: str | None) -> None:
    """Set the per-request tenant schema from the X-User-Db header (validated)."""
    _REQUEST_SCHEMA.set(name if name and _NAME.match(name) else None)


def current_schema() -> str:
    return _REQUEST_SCHEMA.get() or os.environ.get("PG_SCHEMA") or "learnhub"


@contextmanager
def db() -> Iterator[Connection]:
    """Yield a pooled connection with search_path set to the request's tenant schema."""
    schema = current_schema()
    with _pool.connection() as conn:
        conn.execute(f'SET search_path TO "{schema}", public')
        yield conn
