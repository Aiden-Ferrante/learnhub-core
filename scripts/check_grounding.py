#!/usr/bin/env python3
"""Does every extracted concept's source_sentence actually appear in its own section?

The extraction gate (`LEARN_REQUIRE_SOURCE`, concepts_extract.py) checks that a concept
carries a source_sentence. It does **not** check that the sentence is real — a model that
invents a plausible-sounding quote passes it. That is the same shape as every other bug this
codebase has fixed: a value that looks right and is never checked against the thing it
claims to describe.

This script does the checking, offline, against the live database. It classifies every
concept rather than returning a pass/fail count, because the interesting answer is not "how
many failed" but "in what way":

  verbatim      the quote appears in the section, normalized
  partial       at least one full sentence of a multi-sentence quote appears
  near-verbatim a long contiguous run survives, but the string does not match — this is
                ENCODING damage (LaTeX \\text{} arriving as "ext", unicode arriving as byte
                escapes), not a grounding failure
  paraphrase    every word is present but the run is short — the model rewrote rather than copied
  invented      neither: the quote is not in the section in any recognisable form
  elsewhere     the quote is real but lives in a DIFFERENT section — an attribution bug

Usage:  python scripts/check_grounding.py [--dsn ...] [--doc <source_id>] [--json]
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
import unicodedata

_WORD = re.compile(r"[^a-z0-9]+")


def norm(s: str | None) -> str:
    """Fold to comparable text: NFKD, smart quotes, dashes, then alphanumerics only.

    Deliberately lossy. The question is whether the model copied the sentence, not whether
    the markdown round-tripped byte-for-byte — that is Conversion's problem, and conflating
    the two is what made this measurement hard to read the first time.
    """
    s = unicodedata.normalize("NFKD", s or "")
    for a, b in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"'),
                 ("—", " "), ("–", " "), ("−", "-")):
        s = s.replace(a, b)
    return " ".join(_WORD.sub(" ", s.lower()).split())


def classify(src: str, section_md: str, book_md: str) -> str:
    n_src, n_md = norm(src), norm(section_md)
    if not n_src:
        return "ungated"          # empty source that reached the table anyway
    if not n_md:
        return "no-section-text"
    if n_src in n_md:
        return "verbatim"
    parts = [norm(p) for p in re.split(r"(?<=[.!?])\s+", src) if len(norm(p).split()) >= 4]
    if parts and any(p in n_md for p in parts):
        return "partial"
    words = n_src.split()
    probe = " ".join(words[:40])
    if probe and probe in norm(book_md):
        return "elsewhere"
    md_words = n_md.split()
    run = max((b.size for b in difflib.SequenceMatcher(None, words, md_words, autojunk=False)
               .get_matching_blocks()), default=0)
    if run >= max(5, len(words) // 3):
        return "near-verbatim"
    present = sum(1 for w in set(words) if w in n_md) / len(set(words))
    return "paraphrase" if present >= 0.60 else "invented"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default=os.environ.get(
        "POSTGRES_DSN", "host=localhost port=5432 user=learnhub password=learnhub_local dbname=learnhub"))
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
            "SELECT doc_id, string_agg(markdown, ' ' ORDER BY \"order\") AS md "
            "FROM raw_content GROUP BY doc_id").fetchall()}

    counts: dict[str, int] = {}
    offenders: list[dict] = []
    for r in rows:
        verdict = classify(r["source"], r["md"], books.get(r["doc_id"], ""))
        counts[verdict] = counts.get(verdict, 0) + 1
        if verdict in ("invented", "elsewhere", "ungated"):
            offenders.append({"doc": r["doc_id"], "section": r["section_key"],
                              "name": r["name"], "verdict": verdict, "source": r["source"]})

    total = len(rows) or 1
    if a.json:
        print(json.dumps({"total": len(rows), "counts": counts, "offenders": offenders}, indent=1))
    else:
        print(f"{len(rows)} concepts checked\n")
        for k in ("verbatim", "partial", "near-verbatim", "paraphrase",
                  "elsewhere", "invented", "ungated", "no-section-text"):
            if k in counts:
                print(f"  {k:16} {counts[k]:5}  ({counts[k]/total:5.1%})")
        print()
        grounded = sum(counts.get(k, 0) for k in
                       ("verbatim", "partial", "near-verbatim", "paraphrase"))
        print(f"  traces to its own section: {grounded}/{len(rows)} ({grounded/total:.1%})")

    # Exit non-zero only on the verdicts that mean the gate FAILED — encoding damage is a
    # Conversion finding and must not turn this check red.
    bad = counts.get("invented", 0) + counts.get("elsewhere", 0) + counts.get("ungated", 0)
    if bad:
        print(f"\n{bad} concept(s) do not trace to their section", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
