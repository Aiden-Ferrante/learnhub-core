#!/usr/bin/env python3
"""Keep MAP.md honest: regenerate its auto-managed backend file tables and validate links.

The backend per-file tables (the part that drifts as you refactor Python) are generated
from the filesystem: file *list* comes from `backend/app/<pkg>/`, file *descriptions* are
preserved from the existing MAP.md. New files appear with a `(describe me)` placeholder;
deleted files drop out; your curated ordering is kept (new files append at the end).

It also link-checks the entire file: every relative markdown link and every GitHub
`/blob/main/` or `/tree/main/` target must resolve to a real path.

Usage:
  python scripts/gen_map.py           # rewrite MAP.md in place
  python scripts/gen_map.py --check   # exit 1 if MAP.md is stale or has dead links (CI/PRs)
"""

from __future__ import annotations

import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAP = ROOT / "MAP.md"

# Ordered packages + the one-line blurb shown in each section heading.
PACKAGES = [
    ("platform", "the floor (everything depends on this)"),
    ("content", "the book itself"),
    ("ingestion", "PDF in"),
    ("extraction", "LLM generation passes"),
    ("study", "learning state"),
    ("search", "embeddings + semantic search"),
    ("media", "audiobooks"),
    ("overview", "cross-domain read models"),
    ("pipeline", "the conductor — document lifecycle + job runners"),
    ("api", "thin routers + composition root"),
]

MARK_START = (
    "<!-- GEN:backend START — auto-managed by scripts/gen_map.py; "
    "edit descriptions inline, they're preserved across regens -->"
)
MARK_END = "<!-- GEN:backend END -->"
PLACEHOLDER = "_(describe me)_"

_ROW = re.compile(r"\|\s*\[`[^`]+`\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|")


def existing_descriptions(text: str) -> dict[str, str]:
    """path -> description, parsed from every `[`name`](path) | desc |` row, in file order."""
    out: dict[str, str] = {}
    for m in _ROW.finditer(text):
        out.setdefault(m.group(1), m.group(2))
    return out


def facade_summary(pkg: str) -> str | None:
    """First paragraph of the package facade's docstring — the hub's documentation
    (docs/module-hubs.md). Written once in __init__.py, surfaced here automatically."""
    init = ROOT / "backend" / "app" / pkg / "__init__.py"
    if not init.exists():
        return None
    import ast as _ast

    doc = _ast.get_docstring(_ast.parse(init.read_text()))
    if not doc:
        return None
    return " ".join(doc.split("\n\n")[0].split())


def build_backend_region(desc: dict[str, str]) -> str:
    lines: list[str] = []
    for pkg, blurb in PACKAGES:
        d = ROOT / "backend" / "app" / pkg
        on_disk = {p.name for p in d.glob("*.py") if p.name != "__init__.py"}
        prev = [rel.split("/")[-1] for rel in desc if rel.startswith(f"backend/app/{pkg}/")]
        ordered = [f for f in prev if f in on_disk]  # keep curated order
        ordered += sorted(f for f in on_disk if f not in ordered)  # append new files
        lines.append(f"### {pkg}/ — {blurb}\n")
        summary = facade_summary(pkg)
        if summary:
            lines.append(f"> {summary} — [`__init__.py`](backend/app/{pkg}/__init__.py) is the facade: import this package, not its modules.\n")
        lines.append("| File | Purpose |")
        lines.append("|---|---|")
        for f in ordered:
            rel = f"backend/app/{pkg}/{f}"
            lines.append(f"| [`{f}`]({rel}) | {desc.get(rel, PLACEHOLDER)} |")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def dead_links(text: str) -> list[str]:
    bad: list[str] = []
    for m in re.finditer(r"\]\((?!https?://|#)([^)]+)\)", text):  # relative md links
        p = m.group(1).split("#")[0]
        if p and not (ROOT / p).exists():
            bad.append(p)
    for m in re.finditer(r"/(?:blob|tree)/main/([^\"#)]+)", text):  # github targets
        if not (ROOT / m.group(1)).exists():
            bad.append("gh:" + m.group(1))
    return sorted(set(bad))


def main() -> None:
    check = "--check" in sys.argv
    text = MAP.read_text()
    if MARK_START not in text or MARK_END not in text:
        sys.exit(f"markers not found in MAP.md ({MARK_START!r} / {MARK_END!r})")
    region = build_backend_region(existing_descriptions(text))
    new = re.sub(
        re.escape(MARK_START) + r".*?" + re.escape(MARK_END),
        MARK_START + "\n\n" + region + "\n" + MARK_END,
        text,
        flags=re.S,
    )
    bad = dead_links(new)
    stale = new != text

    if check:
        problems = []
        if stale:
            problems.append("MAP.md backend tables are stale — run: python scripts/gen_map.py")
        if bad:
            problems.append("dead links:\n  " + "\n  ".join(bad))
        if problems:
            sys.exit("\n".join(problems))
        print("MAP.md is up to date and all links resolve.")
        return

    MAP.write_text(new)
    print("MAP.md " + ("regenerated (changed)." if stale else "already up to date."))
    if bad:
        sys.exit("dead links:\n  " + "\n  ".join(bad))


if __name__ == "__main__":
    main()
