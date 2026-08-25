#!/usr/bin/env python3
"""Does every extracted concept's source_sentence appear in its own section?

Thin CLI over `app.process.extraction.grounding`, which owns the classification and is
exercised in CI by `backend/tests/test_grounding_pg.py` against a seeded corpus containing
one of every verdict — including an invented quote, so the check can actually fail.

**This script is deliberately NOT a CI step.** CI's Postgres is seeded from the schema and
holds no concepts, and an empty corpus is absent information rather than a pass (it exits
non-zero to say so). The check that belongs in CI is the test; the check that belongs here
is the one you run against a real library.

Usage:
  python scripts/check_grounding.py                  # the whole library
  python scripts/check_grounding.py --doc <source>   # one book
  python scripts/check_grounding.py --json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

for _cand in (os.path.join(os.path.dirname(__file__), "..", "backend"), "/app", "."):
    if os.path.isdir(os.path.join(_cand, "app")):
        sys.path.insert(0, _cand)
        break

from app.process.extraction import classify_grounding, summarize_grounding  # noqa: E402
from app.process.extraction.grounding import GATE_FAILURES, VERDICTS        # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default=os.environ.get(
        "POSTGRES_DSN",
        "host=localhost port=5432 user=learnhub password=learnhub_local dbname=learnhub"))
    ap.add_argument("--schema", default=os.environ.get("LEARN_DB_SCHEMA", "learnhub"))
    ap.add_argument("--doc", help="limit to one source id")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    import psycopg
    from psycopg.rows import dict_row

    where = "WHERE c.doc_id = %(d)s" if a.doc else ""
    with psycopg.connect(a.dsn, row_factory=dict_row) as conn:
        conn.execute(f"SET search_path TO {a.schema}")
        rows = conn.execute(f"""
            SELECT c.doc_id, c.section_key, c.name, c.source,
                   coalesce(string_agg(r.markdown, ' ' ORDER BY r."order"), '') AS md
            FROM ext_concepts c
            LEFT JOIN raw_content r ON r.doc_id = c.doc_id AND r.section_key = c.section_key
            {where}
            GROUP BY c.key, c.doc_id, c.section_key, c.name, c.source
        """, {"d": a.doc} if a.doc else {}).fetchall()
        books = {r["doc_id"]: r["md"] for r in conn.execute(
            'SELECT doc_id, string_agg(markdown, \' \' ORDER BY "order") AS md '
            "FROM raw_content GROUP BY doc_id").fetchall()}

    verdicts, offenders = [], []
    for r in rows:
        v = classify_grounding(r["source"], r["md"], books.get(r["doc_id"], ""))
        verdicts.append(v)
        if v in GATE_FAILURES:
            offenders.append({"doc": r["doc_id"], "section": r["section_key"],
                              "name": r["name"], "verdict": v, "source": r["source"]})
    s = summarize_grounding(verdicts)

    if a.json:
        print(json.dumps({**s, "offenders": offenders}, indent=1))
        return 0 if s["ok"] else 1

    n = s["examined"]
    print(f"{n} concepts checked\n")
    for k in VERDICTS:
        if k in s["counts"]:
            print(f"  {k:16} {s['counts'][k]:5}  ({s['counts'][k]/n:5.1%})")
    if n:
        print(f"\n  traces to its own section: {s['traced']}/{n} ({s['traced']/n:.1%})")
    if not n:
        print("\nno concepts examined — that is not a pass, it is no information", file=sys.stderr)
    for o in offenders[:10]:
        print(f"  ! {o['verdict']:10} {o['name']}  [{o['section']}]", file=sys.stderr)
    return 0 if s["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
