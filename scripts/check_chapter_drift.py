#!/usr/bin/env python3
"""Drift check: /api/chapters must equal the toc-tree's top level for every ready doc.

The Process build list and the course page's syllabus tree render from these two
endpoints; TASK-18 unified them on one derivation. This script proves it live —
run it against a running learn backend (default http://127.0.0.1:8010) after any
change to the outline/chapters pipeline:

    python3 scripts/check_chapter_drift.py

Exit 0 = every ready document's chapter list matches the tree top level exactly
(keys, titles, order). Exit 1 = drift, with a per-doc diff printed.
"""

from __future__ import annotations

import json
import sys
from urllib.request import urlopen

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8010"


def get(path: str) -> dict:
    with urlopen(f"{BASE}{path}", timeout=30) as r:
        return json.load(r)


def main() -> int:
    docs = get("/api/documents").get("documents") or []
    ready = [d for d in docs if d.get("sectionCount")]  # converted → has an outline to compare
    if not ready:
        print("no converted documents to check")
        return 0

    drift = False
    for d in ready:
        key = d.get("docId")
        title = (d.get("title") or key or "?")[:50]
        chapters = get(f"/api/chapters?doc={key}").get("chapters") or []
        tree = get(f"/api/toc-tree?doc={key}").get("tree") or []
        tops = [
            (n["sectionKey"], n.get("title") or n.get("label"), n.get("label") or "")
            for n in tree
            if n.get("isSection") and n.get("sectionKey")
        ]
        units = [(c["key"], c["title"], c.get("label") or "") for c in chapters]
        if units == tops:
            print(f"  OK   {title} — {len(units)} chapters")
        else:
            drift = True
            print(f"  DRIFT {title} — chapters={len(units)} tree-tops={len(tops)}")
            for u in units:
                if u not in tops:
                    print(f"        only in /api/chapters: {u}")
            for t in tops:
                if t not in units:
                    print(f"        only in toc-tree:      {t}")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
