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

A second pass, ``rekey``: a top-level container that carries a number but a slug key
("Module 1: …" stored as ``toc:module-1-…``) is re-keyed to ``toc:N`` with the container
prefix dropped from its title — exactly what the converter now produces for a fresh upload.
Key-based chapter logic (``chapter_key_of``, scope ancestry, pack scopes) reads ``toc:1.2``
as inside ``toc:1``; with a slug key the module owns its sections in the tree but not in
those queries. The node is copied under the new id, every reference is repointed, then the
old row goes; one transaction per document.

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
import re
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

_CONTAINER_PREFIX = re.compile(
    r"^\s*(?:module|part|unit|chapter|week|lesson|book)\s+\d+\s*[.:)\u2013\u2014-]?\s*", re.IGNORECASE
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


_KEY_TABLES = ("raw_content", "raw_elements", "ext_concepts", "ext_guides", "concept_reviews",
               "study_events", "pack_units", "pack_items")
_FK_TABLES = ("raw_elements", "ext_concepts", "ext_orient", "ext_skeleton", "ext_guides",
              "version_blocks")


def plan_rekeys(conn, doc_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT section_key, number_label, title FROM raw_structure "
        "WHERE doc_id = %s AND depth = 0 AND number_label ~ '^[0-9]+$' "
        "AND section_key !~ '^toc:[0-9]'",
        (doc_id,),
    ).fetchall()
    taken = {
        (r["section_key"] if isinstance(r, dict) else r[0])
        for r in conn.execute("SELECT section_key FROM raw_structure WHERE doc_id = %s", (doc_id,))
    }
    out = []
    for r in rows:
        sk, num, title = (r["section_key"], r["number_label"], r["title"]) if isinstance(r, dict) else r
        new = f"toc:{num}"
        if new in taken:
            continue
        clean = _CONTAINER_PREFIX.sub("", title or "").strip() or title
        out.append({"old": sk, "new": new, "title": clean, "was": title})
    return out


def _has_column(conn, table: str, column: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
        "AND table_name = %s AND column_name = %s", (table, column)).fetchone())


def apply_rekey(conn, doc_id: str, rk: dict) -> None:
    old_id, new_id = f"{doc_id}::{rk['old']}", f"{doc_id}::{rk['new']}"
    conn.execute(
        """
        INSERT INTO raw_structure (id, doc_id, parent_id, section_key, kind, number_label, title,
            depth, "order", page_start, page_end, hidden_reason)
        SELECT %(new_id)s, doc_id, parent_id, %(new)s, kind, number_label, %(title)s, depth,
            "order", page_start, page_end, hidden_reason
        FROM raw_structure WHERE id = %(old_id)s
        """,
        {"new_id": new_id, "new": rk["new"], "title": rk["title"], "old_id": old_id},
    )
    conn.execute("UPDATE raw_structure SET parent_id = %s WHERE parent_id = %s", (new_id, old_id))
    for t in _FK_TABLES:
        conn.execute(f"UPDATE {t} SET structure_id = %s WHERE structure_id = %s", (new_id, old_id))
    for t in _KEY_TABLES:
        scoped = " AND doc_id = %s" if _has_column(conn, t, "doc_id") else ""
        params = (rk["new"], rk["old"], doc_id) if scoped else (rk["new"], rk["old"])
        conn.execute(f"UPDATE {t} SET section_key = %s WHERE section_key = %s{scoped}", params)
    conn.execute("DELETE FROM raw_structure WHERE id = %s", (old_id,))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    failing = 0
    with db() as conn:
        for doc_id, name, page_count in _docs(conn):
            updates, problems = plan_doc(conn, doc_id, page_count)
            rekeys = plan_rekeys(conn, doc_id)
            if not updates and not problems and not rekeys:
                continue
            failing += 1
            print(f"\n== {name[:70]}  ({doc_id})  {len(updates)} node(s) change, "
                  f"{len(rekeys)} re-key(s)")
            for rk in rekeys:
                print(f"   re-key {rk['old']} → {rk['new']}  title {rk['was']!r} → {rk['title']!r}")
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
            if args.apply and rekeys:
                with conn.transaction():
                    for rk in rekeys:
                        apply_rekey(conn, doc_id, rk)
                print("   re-keyed")

    if args.check:
        print(f"\ncheck-outlines: {failing} document(s) {'fail' if failing else 'clean'}")
        return 1 if failing else 0
    if not args.apply:
        print(f"\ndry run: {failing} document(s) would change; --apply to write")
    return 0


if __name__ == "__main__":
    sys.exit(main())
