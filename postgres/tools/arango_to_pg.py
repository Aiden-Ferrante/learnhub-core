"""One-off ArangoDB → PostgreSQL data copy (Phase 4 of the migration).

Idempotent: truncates each target table then re-copies. Reads the live Arango
`learnhub`/`learnhub_auth` DBs and writes the `learnhub`/`auth` Postgres schemas,
auto-mapping camelCase→snake_case and driving JSONB/vector handling off the
Postgres column types. Asserts row counts match per table.

Run:  ARANGO_PW=... backend/.venv/bin/python tools/pg/arango_to_pg.py
"""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Json
from arango import ArangoClient

PG_DSN = os.environ.get("PG_DSN", "host=localhost port=5432 user=learnhub password=learnhub_local dbname=learnhub")
ARANGO_URL = os.environ.get("ARANGO_URL", "http://localhost:8529")
ARANGO_PW = os.environ["ARANGO_PW"]

# (arango_db, arango_collection, pg_schema, pg_table). 3 empty collections omitted.
TABLES = [(("learnhub", c), ("learnhub", c)) for c in [
    "documents", "app_documents", "section_content", "page_content", "elements",
    "concepts", "content_vectors", "concept_reviews", "study_events", "chapter_builds",
    "chapter_progress", "chapter_orient", "chapter_skeletons", "deep_chapter_briefing",
    "reading_guides", "section_augment", "entities", "relationships", "user_settings", "learn_meta",
]] + [(("learnhub_auth", "users"), ("auth", "users"))]

RENAME = {"_key": "key", "_from": "from_key", "_to": "to_key", "_lastUpdated": "last_updated"}
SKIP = {"_id", "_rev"}


def snake(s: str) -> str:
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()


def xf(k: str) -> str:
    return RENAME.get(k, snake(k))


def to_ts(v):
    if isinstance(v, (int, float)):
        if abs(v) > 1e11:  # epoch milliseconds (JS Date.now()) → seconds
            v = v / 1000.0
        return datetime.fromtimestamp(v, tz=timezone.utc)
    return v  # ISO string — Postgres parses it


def pg_cols(cur, schema, table):
    cur.execute(
        "SELECT column_name, data_type, udt_name FROM information_schema.columns "
        "WHERE table_schema=%s AND table_name=%s",
        (schema, table),
    )
    return {r[0]: (r[1], r[2]) for r in cur.fetchall()}


def main() -> int:
    client = ArangoClient(hosts=ARANGO_URL)
    ok_all = True
    with psycopg.connect(PG_DSN) as conn:
        cur = conn.cursor()
        for (adb_name, acoll), (pg_schema, pg_table) in TABLES:
            adb = client.db(adb_name, username="root", password=ARANGO_PW)
            cols = pg_cols(cur, pg_schema, pg_table)
            src = list(adb.collection(acoll).all())
            rows = []
            for doc in src:
                row = {}
                for k, v in doc.items():
                    if k in SKIP:
                        continue
                    ck = xf(k)
                    if ck not in cols:
                        continue
                    dtype, udt = cols[ck]
                    if v is None:
                        row[ck] = None
                    elif udt == "vector":
                        row[ck] = "[" + ",".join(map(str, v)) + "]"
                    elif dtype == "jsonb":
                        row[ck] = Json(v)
                    elif dtype.startswith("timestamp"):
                        row[ck] = to_ts(v)
                    else:
                        row[ck] = v
                # auth.users: dbName → schema_name isn't camelCase-derivable; map explicitly
                if pg_table == "users" and "schema_name" in cols and "schema_name" not in row:
                    row["schema_name"] = doc.get("dbName") or "learnhub"
                rows.append(row)

            cur.execute(f'TRUNCATE {pg_schema}."{pg_table}"')
            if rows:
                allc = sorted({c for r in rows for c in r})
                for r in rows:
                    for c in allc:
                        r.setdefault(c, None)
                collist = ",".join(f'"{c}"' for c in allc)
                ph = ",".join(f"%({c})s" for c in allc)
                cur.executemany(f'INSERT INTO {pg_schema}."{pg_table}" ({collist}) VALUES ({ph})', rows)
            conn.commit()
            pgc = cur.execute(f'SELECT count(*) FROM {pg_schema}."{pg_table}"').fetchone()[0]
            ok = pgc == len(src)
            ok_all &= ok
            print(f'  {pg_schema}.{pg_table:22} arango={len(src):5} pg={pgc:5} {"OK" if ok else "*** MISMATCH ***"}')
    print("\nALL COUNTS MATCH ✓" if ok_all else "\nCOUNT MISMATCH — investigate")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
