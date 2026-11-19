#!/usr/bin/env python3
"""restructure_outlines — re-run the outline repair stages over every stored outline.

The TOC controller's ``nest`` and ``curate`` stages only run when a book is converted.
When they improve (v0.31.3: flat Module/section outlines, over-eager orphan hiding), the
books already in the library keep the old tree. Re-converting would fix it and also
destroy it: a re-convert deletes ``raw_structure`` and every concept anchored to it.

This script repairs in place instead. Per document it reads the stored outline in order,
runs ``nest_flat_sections`` then ``curate_outline`` (Part containers already demoted at
ingest stay hidden), rebuilds the rows with the same ``_structure_rows`` the converter
uses, and UPDATEs only what differs: depth, parent, kind, page end, number label, hidden
reason. Section keys, and so node ids (``doc_id::section_key``), never change; nothing is
inserted or deleted.

Modes:
  python scripts/restructure_outlines.py            # dry run: print what would change
  python scripts/restructure_outlines.py --apply    # write it
  python scripts/restructure_outlines.py --check    # the library-wide outline check:
                                                    # exit 1 if any outline would change,
                                                    # or has an N.M section at the top

Run inside the API image with the compose network (see ARCHITECTURE.md, Tests).
"""
from __future__ import annotations

import argparse
import os
import sys

for _cand in (os.path.join(os.path.dirname(__file__), "..", "backend"), "/app", "."):
    if os.path.isdir(os.path.join(_cand, "app")):
        sys.path.insert(0, _cand)
        break

from app.gateways.db import db  # noqa: E402
from app.process.content.store import _structure_rows  # noqa: E402
from app.process.content.toc_controller import (  # noqa: E402
    HIDE_PART,
    curate_outline,
    nest_flat_sections,
)

_FIELDS = ("parent_id", "kind", "number_label", "depth", "page_end", "hidden_reason")


def _docs(conn) -> list[tuple[str, str, int]]:
    rows = conn.execute(
        """
        SELECT s.doc_id AS doc_id, COALESCE(max(a.name), max(r.name), s.doc_id) AS name,
               COALESCE(max(src.page_count), 0) AS page_count
        FROM raw_structure s
        LEFT JOIN raw_documents r ON r.key = s.doc_id
        LEFT JOIN sources src ON src.key = r.source_id
        LEFT JOIN app_documents a ON a.learn_doc_id = s.doc_id
        GROUP BY s.doc_id ORDER BY 2
        """
    ).fetchall()
    return [(r["doc_id"], r["name"], r["page_count"]) if isinstance(r, dict) else tuple(r) for r in rows]


def plan_doc(conn, doc_id: str, page_count: int) -> tuple[list[dict], list[str]]:
    """(row updates, problems that remain after the repair) for one document."""
    stored = conn.execute(
        'SELECT id, section_key, number_label, title, depth, page_start, parent_id, kind, '
        'page_end, hidden_reason FROM raw_structure WHERE doc_id = %s ORDER BY "order"',
        (doc_id,),
    ).fetchall()
    cols = ("id", "section_key", "number_label", "title", "depth", "page_start",
            "parent_id", "kind", "page_end", "hidden_reason")
    stored = [dict(zip(cols, r)) if not isinstance(r, dict) else r for r in stored]
    entries = [
        {"sectionKey": r["section_key"], "numberKey": r["number_label"], "title": r["title"],
         "listDepth": r["depth"], "page": r["page_start"]}
        for r in stored
    ]
    parts = {r["section_key"]: HIDE_PART for r in stored if r["hidden_reason"] == HIDE_PART}
    entries, _ = nest_flat_sections(entries)
    hidden = {**curate_outline(entries, set(parts)), **parts}
    rows = {r["id"]: r for r in _structure_rows(doc_id, entries, page_count, hidden=hidden)}

    updates = []
    for old in stored:
        new = rows.get(old["id"])
        if new is None:
            continue
        diff = {f: new[f] for f in _FIELDS if new[f] != old[f]}
        # A page end is derived; never let a missing page count blank a stored one.
        if "page_end" in diff and new["page_end"] is None:
            diff.pop("page_end")
        if diff:
            updates.append({"id": old["id"], "title": old["title"], "old": old, "set": diff})

    problems = [
        f"top-level section {r['number_label']} {r['title']!r}"
        for r in rows.values()
        if r["depth"] == 0 and "." in (r["number_label"] or "") and not r["hidden_reason"]
    ]
    return updates, problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    failing = 0
    with db() as conn:
        for doc_id, name, page_count in _docs(conn):
            updates, problems = plan_doc(conn, doc_id, page_count)
            if not updates and not problems:
                continue
            failing += 1
            print(f"\n== {name[:70]}  ({doc_id})  {len(updates)} node(s) change")
            for u in updates:
                change = ", ".join(f"{k} {u['old'][k]!r}→{v!r}" for k, v in u["set"].items()
                                   if k != "parent_id")
                if "parent_id" in u["set"]:
                    change += (", " if change else "") + "parent changes"
                print(f"   {u['title'][:55]:55}  {change}")
            for p in problems:
                print(f"   STILL WRONG: {p}")
            if args.apply and updates:
                with conn.transaction():
                    for u in updates:
                        sets = ", ".join(f"{k} = %({k})s" for k in u["set"])
                        conn.execute(
                            f"UPDATE raw_structure SET {sets} WHERE id = %(id)s",
                            {**u["set"], "id": u["id"]},
                        )
                print("   applied")

    if args.check:
        print(f"\ncheck-outlines: {failing} document(s) {'fail' if failing else 'clean'}")
        return 1 if failing else 0
    if not args.apply:
        print(f"\ndry run: {failing} document(s) would change; --apply to write")
    return 0


if __name__ == "__main__":
    sys.exit(main())
