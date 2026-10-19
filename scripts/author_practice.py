#!/usr/bin/env python3
"""Author a scope's practice items ON THE HOST, where the Claude Code login lives.

The same job the editor's Regenerate runs (practice.author_practice_sync: objectives,
author, revise, answerability gate, recall check), written to the database, but with
claude:* models, which the container cannot reach. Default: Sonnet writes, Opus judges.

    python scripts/author_practice.py --doc <id> --scope toc:7 [--regenerate]

Env: POSTGRES_DSN (host-published Postgres). LEARN_PRACTICE_MODEL /
LEARN_PRACTICE_JUDGE_MODEL override the defaults; LEARN_CLAUDE_USAGE_LOG logs tokens.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

for _cand in (os.path.join(os.path.dirname(__file__), "..", "backend"), "/app", "."):
    if os.path.isdir(os.path.join(_cand, "app")):
        sys.path.insert(0, _cand)
        break

os.environ.setdefault("LEARN_PRACTICE_MODEL", "claude:sonnet")
os.environ.setdefault("LEARN_PRACTICE_JUDGE_MODEL", "claude:opus")

from app.process.content import resolve_doc_id  # noqa: E402
from app.process.extraction import practice  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--doc", required=True)
    ap.add_argument("--scope", required=True)
    ap.add_argument("--regenerate", action="store_true", help="rewrite untouched items first")
    args = ap.parse_args()

    t0 = time.time()
    print(f"author {os.environ['LEARN_PRACTICE_MODEL']} · judge {os.environ['LEARN_PRACTICE_JUDGE_MODEL']}")
    receipt = practice.author_practice_sync(
        resolve_doc_id(args.doc), args.scope, regenerate=args.regenerate,
        on_progress=lambda *a, **k: print(".", end="", flush=True),
    )
    print(f"\n{receipt}  wall {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
