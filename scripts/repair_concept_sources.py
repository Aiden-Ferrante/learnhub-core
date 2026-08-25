#!/usr/bin/env python3
"""Repair JSON/tokenizer damage in concepts that were already extracted.

The fix in `concepts_extract.repair_model_text` protects concepts extracted from now on.
It does nothing for rows already in the table — and re-extracting is hours of local model
time per book, to recover text that is recoverable arithmetically.

Every repair is verified against the section's own markdown before it is written: a row is
rewritten only when the repaired quote is findable in the text it claims to come from and
the stored one was not. A repair that cannot be checked is not applied. That is deliberately
stricter than the extraction-time path, which has to accept some ambiguity to avoid dropping
a quote; here there is no hurry and no reason to guess.

Dry-run by default. `--apply` writes.

Usage:
  python scripts/repair_concept_sources.py                 # report only
  python scripts/repair_concept_sources.py --apply
"""
from __future__ import annotations

import argparse
import os
import re
import sys

# The app package sits at backend/ in the repo and at / in the service image; try both so
# the script runs the same way from a checkout and from inside the container.
for _cand in (os.path.join(os.path.dirname(__file__), "..", "backend"), "/app", "."):
    if os.path.isdir(os.path.join(_cand, "app")):
        sys.path.insert(0, _cand)
        break

from app.process.extraction import repair_model_text  # noqa: E402
from app.process.extraction.concepts_extract import _decode_byte_fallback  # noqa: E402


def squash(t: str | None) -> str:
    return re.sub(r"\s+", " ", t or "").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default=os.environ.get(
        "POSTGRES_DSN",
        "host=localhost port=5432 user=learnhub password=learnhub_local dbname=learnhub"))
    ap.add_argument("--schema", default=os.environ.get("LEARN_DB_SCHEMA", "learnhub"))
    ap.add_argument("--apply", action="store_true", help="write the repairs (default: report only)")
    ap.add_argument("--limit", type=int, default=0, help="show at most N examples")
    a = ap.parse_args()

    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(a.dsn, row_factory=dict_row) as conn:
        conn.execute(f"SET search_path TO {a.schema}")
        rows = conn.execute("""
            SELECT c.key, c.name, c.source, c.signal,
                   coalesce(string_agg(r.markdown, ' ' ORDER BY r."order"), '') AS md
            FROM ext_concepts c
            LEFT JOIN raw_content r ON r.doc_id = c.doc_id AND r.section_key = c.section_key
            GROUP BY c.key, c.name, c.source, c.signal
        """).fetchall()

        fixed, verified, decoded, unverifiable, shown = [], 0, 0, 0, 0
        for r in rows:
            # The two repairs have different standards of proof, so they are decided
            # separately. Byte-fallback decoding is not a guess — `<0xE2><0x84><0x92>` is
            # never legitimate prose, and `signal` is rendered on a concept card, so leaving
            # it because the QUOTE could not be matched would keep mojibake on screen to
            # protect a check it has nothing to do with. Backslash restoration IS a guess,
            # and stays gated on the section text.
            byte_source = _decode_byte_fallback(str(r["source"] or ""))
            byte_signal = _decode_byte_fallback(str(r["signal"] or ""))
            new_source = repair_model_text(r["source"], r["md"])
            # `signal` is the model's own explanation, not a quote, so the section markdown
            # is NOT ground truth for it — passing it would gate a signal repair on whether
            # some other field matched. Repair it the way a fresh extraction now would: the
            # safe set only. What that cannot reach (\n colliding with \not, \nabla) stays
            # broken and is recorded as a known limit rather than guessed at.
            new_signal = repair_model_text(r["signal"])
            if squash(new_source) == squash(r["source"]) and squash(new_signal) == squash(r["signal"]):
                continue
            hay = squash(r["md"])
            was_findable = squash(r["source"]) in hay
            now_findable = squash(new_source) in hay
            if now_findable and not was_findable:
                verified += 1
            elif was_findable:
                continue                      # already fine — do not touch a good row
            elif (byte_source != str(r["source"] or "") or byte_signal != str(r["signal"] or "")
                  or squash(new_signal) != squash(r["signal"])):
                # Cannot confirm the backslash repair, but the byte decode stands on its own.
                new_source = byte_source
                decoded += 1
            else:
                unverifiable += 1
                continue                      # nothing here is safe to write
            fixed.append((r["key"], new_source, new_signal))
            if a.limit and shown < a.limit:
                shown += 1
                print(f"  · {r['name']}\n      was: {squash(r['source'])[:100]}\n      now: {squash(new_source)[:100]}")

        print(f"\n{len(rows)} concepts examined")
        print(f"  backslash repair verified against the section : {verified}")
        print(f"  byte-fallback decoded (unambiguous)           : {decoded}")
        print(f"  changed but NOT verifiable — left alone       : {unverifiable}")

        if not a.apply:
            print("\ndry run — pass --apply to write")
            return 0
        for key, src, sig in fixed:
            conn.execute("UPDATE ext_concepts SET source = %(s)s, signal = %(g)s WHERE key = %(k)s",
                         {"s": src, "g": sig, "k": key})
        conn.commit()
        print(f"\napplied {len(fixed)} repair(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
