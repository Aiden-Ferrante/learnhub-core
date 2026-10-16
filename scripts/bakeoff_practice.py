#!/usr/bin/env python3
"""BAKE-OFF (v0.23.0): which local model authors the best practice items for this app?

Runs one chapter through the full authoring pipeline (practice.author_section_items —
objectives, author, revise, answerability gate, recall check) with one model, and writes
everything to JSON. It writes NOTHING to the database. Leaderboards disagree and measure
other tasks; this measures ours, on our books, with our own checks as one of the judges.
The other judge is a human reading the sample.

    # one run per model (unattended; minutes to an hour each)
    python scripts/bakeoff_practice.py run --doc <id> --scope toc:4 --model gpt-oss:120b
    # then the comparison table + a fixed random sample per model for the human read
    python scripts/bakeoff_practice.py compare out/bakeoff-*.json --sample 10

Env: POSTGRES_DSN (host-published Postgres), OLLAMA_BASE_URL, optional --schema tenant.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time

for _cand in (os.path.join(os.path.dirname(__file__), "..", "backend"), "/app", "."):
    if os.path.isdir(os.path.join(_cand, "app")):
        sys.path.insert(0, _cand)
        break

from app.gateways.db import set_request_db_name  # noqa: E402
from app.process.content import load_section_blocks, resolve_doc_id, source_id_of  # noqa: E402
from app.process.extraction import practice  # noqa: E402


def run(args: argparse.Namespace) -> None:
    set_request_db_name(args.schema)
    doc = resolve_doc_id(args.doc)
    src = source_id_of(doc)
    sections = load_section_blocks(doc, scope=args.scope, coalesce=True)
    if args.limit:
        sections = sections[: args.limit]
    out_path = args.out or f"out/bakeoff-{args.model.replace(':', '_').replace('/', '_')}.json"
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    totals = practice.empty_receipt()
    rows = []
    t0 = time.time()
    for n, s in enumerate(sections, 1):
        concept_lines = practice._section_concept_lines(src, s.source_section_key)
        t = time.time()
        try:
            items, receipt, failed = practice.author_section_items(
                s.heading, s.markdown, concept_lines, list(practice.DEFAULT_KINDS), args.model
            )
            error = None
        except Exception as exc:  # noqa: BLE001 — a section that errors is a result too
            items, receipt, failed, error = [], practice.empty_receipt(), [], str(exc)
        secs = round(time.time() - t, 1)
        for k, v in receipt.items():
            totals[k] += v
        rows.append({"sectionKey": s.source_section_key, "heading": s.heading, "secs": secs,
                     "receipt": receipt, "items": items, "failed": failed, "error": error})
        print(f"[{n}/{len(sections)}] {s.heading[:50]:50} {secs:7.1f}s  {receipt}"
              + (f"  ERROR {error}" if error else ""), flush=True)
        # Written every section so a crashed or interrupted run still leaves evidence.
        with open(out_path, "w") as fh:
            json.dump({"model": args.model, "doc": doc, "scope": args.scope,
                       "wallSecs": round(time.time() - t0, 1), "totals": totals,
                       "errors": sum(1 for r in rows if r["error"]), "sections": rows},
                      fh, ensure_ascii=False, indent=1)
    print(f"\n{args.model}: {totals}  wall {time.time() - t0:.0f}s → {out_path}")


def compare(args: argparse.Namespace) -> None:
    runs = [json.load(open(p)) for p in args.files]
    print("| model | kept | problem · retrieve | dropped | failedCheck | relabeled | refused "
          "| unchecked | errors | wall |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in runs:
        t = r["totals"]
        kinds = [i["kind"] for s in r["sections"] for i in s["items"]]
        print(f"| `{r['model']}` | {t['authored']} | {kinds.count('problem')} · "
              f"{kinds.count('retrieve')} | {t['dropped']} | {t['failedCheck']} | "
              f"{t['relabeled']} | {t['refused']} | {t['unchecked']} | {r['errors']} | "
              f"{r['wallSecs'] / 60:.0f} min |")
    for r in runs:
        pool = [(s["heading"], i) for s in r["sections"] for i in s["items"]]
        random.Random(args.seed).shuffle(pool)
        print(f"\n## {r['model']} — {min(args.sample, len(pool))} sampled items\n")
        for heading, i in pool[: args.sample]:
            tag = f"{i['kind']}, d{i.get('difficulty') or '—'}"
            if i.get("relabel"):
                tag += ", relabeled"
            print(f"**[{tag}] {heading}**\n\n> {i['prompt']}\n\n{i['answer']}\n")
        fails = [(s["heading"], f) for s in r["sections"] for f in s["failed"]]
        if fails:
            print(f"### {r['model']} — rejects, gate and screen ({len(fails)})\n")
            for heading, f in fails:
                c = f["check"]
                print(f"- **{c['verdict']}** ({heading}): {f['prompt'][:160]} — _{c['reason']}_")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--doc", required=True)
    r.add_argument("--scope", required=True)
    r.add_argument("--model", required=True)
    r.add_argument("--schema", default=None, help="tenant schema (X-User-Db)")
    r.add_argument("--limit", type=int, default=0, help="first N sections only")
    r.add_argument("--out", default=None)
    c = sub.add_parser("compare")
    c.add_argument("files", nargs="+")
    c.add_argument("--sample", type=int, default=10)
    c.add_argument("--seed", type=int, default=23)
    args = ap.parse_args()
    (run if args.cmd == "run" else compare)(args)


if __name__ == "__main__":
    main()
