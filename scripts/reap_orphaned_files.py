#!/usr/bin/env python3
"""Find on-disk artifacts whose book no longer exists, and optionally remove them.

A book owns two directory trees — `<SHARED_DIR>/ingest/<source>/` (the original PDF and its
figures) and `<AUDIOBOOK_DIR>/<version>/` (renditions, one directory per course). Deleting a
book removes both, and has done since v0.17.0. Before that it did not reliably, so a library
can carry directories belonging to books that were deleted long ago: the dev library had
333 MB of them.

**This is a one-off sweep, not a recurring job.** If it keeps finding new orphans, the delete
path has regressed and that is the thing to fix — this script would be papering over it.

Two ownership rules, and they are not the same, which is why the two trees are walked
separately rather than with one loop:

  ingest/     keyed by SOURCE id      — one directory per book
  audiobooks/ keyed by VERSION id     — one directory per course, several per book

So an audiobook directory is an orphan when no *version* claims it, and an ingest directory
is an orphan when no *source* does. Getting that backwards would delete the audio of every
custom course in the library, which is why the check is written as two explicit queries
rather than one set of "known ids".

Dry-run by default. `--apply` removes.

Usage — the artifact trees live in a docker volume, not the repo, so this runs in the image:

  docker run --rm --network compose_default \
    -e "POSTGRES_DSN=host=postgres port=5432 user=learnhub password=learnhub_local dbname=learnhub" \
    -v $PWD/backend/app:/app/app -v $PWD/scripts:/app/scripts \
    -v compose_learnhub_core_shared:/shared \
    compose-learn:latest python /app/scripts/reap_orphaned_files.py [--apply]

The volume name is worth checking rather than copying — `docker inspect compose-learn-1
--format '{{range .Mounts}}{{.Name}}{{end}}'`. Mounting the wrong one used to make this
report a clean library; it now refuses instead.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

_UUID_ISH = 8  # shortest id we will treat as a directory name worth reasoning about


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} GB"


def _tree_size(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def _orphans(base: str, known: set[str]) -> list[tuple[str, int]]:
    """Directories under `base` whose name is not in `known`.

    Anything that is not a directory, or whose name is too short to be an id, is left alone
    and reported nowhere — this script removes things it can positively identify as orphaned,
    and a stray file in the tree is not that.
    """
    if not os.path.isdir(base):
        # Reported by the caller, never silently skipped. A mistyped --shared, or running
        # this outside the container without the volume mounted, makes every tree absent —
        # and "no orphaned directories" is then a confident wrong answer rather than a
        # finding. Absent is not empty.
        raise FileNotFoundError(base)
    out = []
    for name in sorted(os.listdir(base)):
        path = os.path.join(base, name)
        if not os.path.isdir(path) or len(name) < _UUID_ISH:
            continue
        if name not in known:
            out.append((path, _tree_size(path)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default=os.environ.get(
        "POSTGRES_DSN",
        "host=localhost port=5432 user=learnhub password=learnhub_local dbname=learnhub"))
    ap.add_argument("--schema", default=os.environ.get("LEARN_DB_SCHEMA", "learnhub"))
    ap.add_argument("--shared", default=os.environ.get("SHARED_DIR", "/shared"))
    ap.add_argument("--audio", default=os.environ.get("AUDIOBOOK_DIR"))
    ap.add_argument("--apply", action="store_true", help="remove them (default: report only)")
    a = ap.parse_args()

    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(a.dsn, row_factory=dict_row) as conn:
        conn.execute(f"SET search_path TO {a.schema}")
        sources = {r["key"] for r in conn.execute("SELECT key FROM sources").fetchall()}
        versions = {r["key"] for r in conn.execute("SELECT key FROM raw_documents").fetchall()}

    # A database that answers with nothing is the one case where every directory looks like an
    # orphan. Refuse rather than delete the library — the failure this whole arc is about is a
    # surface treating "I could not find out" as "there is nothing".
    if not sources:
        print("no sources in the database — refusing to treat every directory as an orphan",
              file=sys.stderr)
        return 2

    audio_base = a.audio or os.path.join(a.shared, "audiobooks")
    groups = [
        ("ingest", os.path.join(a.shared, "ingest"), sources, "source"),
        ("figures", os.path.join(a.shared, "figures"), sources, "source"),
        ("audiobooks", audio_base, versions, "course version"),
    ]

    total = 0
    found: list[str] = []
    missing: list[str] = []
    for label, base, known, owner in groups:
        try:
            orphans = _orphans(base, known)
        except FileNotFoundError:
            missing.append(base)
            continue
        if not orphans:
            continue
        print(f"\n{label}/  — no {owner} row for:")
        for path, size in orphans:
            print(f"  {_human(size):>9}  {os.path.basename(path)}")
            total += size
            found.append(path)

    if missing:
        print("\nnot present, so not examined:", file=sys.stderr)
        for m in missing:
            print(f"  {m}", file=sys.stderr)
        if len(missing) == len(groups):
            print("\nnone of the artifact trees exist at these paths — this is a wrong "
                  "--shared/--audio or a missing volume mount, not a clean library",
                  file=sys.stderr)
            return 2

    if not found:
        print("no orphaned directories")
        return 0

    print(f"\n{len(found)} orphaned director{'y' if len(found) == 1 else 'ies'}, "
          f"{_human(total)} total")

    if not a.apply:
        print("\ndry run — pass --apply to remove")
        return 0

    removed = 0
    for path in found:
        try:
            shutil.rmtree(path)
            removed += 1
        except OSError as e:
            print(f"  could not remove {path}: {e}", file=sys.stderr)
    print(f"\nremoved {removed} of {len(found)}")
    return 0 if removed == len(found) else 1


if __name__ == "__main__":
    raise SystemExit(main())
