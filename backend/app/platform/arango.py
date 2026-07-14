"""ArangoDB connection + per-request tenancy — the ONE place a database handle comes from.

Every domain module gets its handle via ``connect_arango()``. Multi-tenancy is a
request-scoped ContextVar: middleware in main.py sets the user's database name from
the ``X-User-Db`` header; absent that, the env default applies.
"""

from __future__ import annotations

import os
import re
from contextvars import ContextVar

from arango import ArangoClient
from arango.database import StandardDatabase

# Per-request database override (multi-tenancy). Set from the X-User-Db header
# by middleware in main.py; falls back to the env default when absent.
_REQUEST_DB_NAME: ContextVar[str | None] = ContextVar("request_db_name", default=None)
_DB_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def set_request_db_name(db_name: str | None) -> None:
    if db_name and not _DB_NAME_RE.match(db_name):
        db_name = None
    _REQUEST_DB_NAME.set(db_name)


def _get_db() -> StandardDatabase:
    url = (os.environ.get("ARANGODB_URL") or "http://localhost:8529").rstrip("/")
    db_name = _REQUEST_DB_NAME.get() or os.environ.get("ARANGODB_DB") or "learnhub"
    user = os.environ.get("ARANGODB_USER") or "root"
    password = os.environ.get("ARANGODB_PASSWORD") or ""
    client = ArangoClient(hosts=url)
    return client.db(db_name, username=user, password=password)


def connect_arango() -> StandardDatabase:
    """Return database handle for other learn modules (e.g. study / AQL)."""
    return _get_db()
