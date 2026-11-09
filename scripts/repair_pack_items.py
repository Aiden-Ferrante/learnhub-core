#!/usr/bin/env python3
"""Bring packs built before v0.26.0 up to its checks. Three repairs, dry-run by default:

  answers    a Learn book problem with no printed answer gets the real output of its program
             (``computedAnswer``), when the sandbox can run it as printed
  furniture  an authored item that points at the book ("according to the textbook") is
             rewritten by the author model to ask about the subject; the rewrite must keep
             every choice, the key and every {{slot}}, and must itself pass the check, or the
             item is left alone and listed
  receipts   each pack's receipt is recomputed from its chapters' stored receipts

Only UPDATEs; nothing is deleted. ``--apply`` writes. Run from backend/ with the host venv,
so ``claude:*`` models reach the CLI and the sandbox child runs as a normal user:

  cd backend && .venv/bin/python ../scripts/repair_pack_items.py [--apply] [--only answers]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from psycopg.types.json import Json  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.gateways import db  # noqa: E402
from app.gateways.llm import ollama_structured_completion  # noqa: E402
from app.process.packs.answers import computed_answers, furniture  # noqa: E402
from app.process.packs.author import _author_model, pack_totals  # noqa: E402

TEXT_FIELDS = ("stem", "choices", "answer", "explain", "rubric")
SLOT = re.compile(r"\{\{\s*\w+\s*\}\}")


class Rewrite(BaseModel):
    stem: str
    choices: List[str] = []
    answer: Optional[str] = None
    explain: Optional[str] = None
    rubric: Optional[str] = None


def body_of(payload: dict) -> dict:
    return payload["spec"] if "spec" in payload else payload


def text_of(body: dict) -> str:
    return " ".join([body.get("stem") or "", *map(str, body.get("choices") or []),
                     *(str(body.get(k) or "") for k in ("answer", "explain", "rubric") if isinstance(body.get(k), str))])


def fix_answers(apply: bool) -> None:
    with db() as conn:
        rows = conn.execute(
            "SELECT key, payload FROM learnhub.pack_items WHERE origin = 'book_problem' AND qtype = 'written' "
            "AND coalesce(payload->>'printedAnswer', '') = '' AND payload->>'computedAnswer' IS NULL").fetchall()
    got = computed_answers([(r["payload"].get("stem") or "", "") for r in rows])
    filled = [(r, a) for r, a in zip(rows, got) if a]
    print(f"answers: {len(rows)} written book problems without an answer; {len(filled)} computable")
    for r, a in filled[:6]:
        print("  ·", (r["payload"]["stem"].split("\n")[0])[:70], "→", a.replace("\n", " ⏎ ")[:60])
    if apply:
        with db() as conn:
            for r, a in filled:
                conn.execute("UPDATE learnhub.pack_items SET payload = payload || %(p)s::jsonb WHERE key = %(k)s",
                             {"p": Json({"computedAnswer": a}), "k": r["key"]})
        print(f"  wrote {len(filled)}")


def rewrite(body: dict) -> tuple[dict | None, str]:
    shown = {k: body[k] for k in TEXT_FIELDS if k in body and (k == "choices" or isinstance(body[k], str))}
    obj, err = ollama_structured_completion([
        {"role": "system", "content":
         "You edit exam questions. Rewrite the item so it asks about the subject itself and never "
         "refers to its source: no textbook, text, book, author, chapter, section, passage, figure or "
         "table. Keep the meaning, the difficulty, every choice in the same order and the same correct "
         "answer. Keep every {{name}} placeholder exactly. Change only what refers to the source. "
         "Return the same fields you were given."},
        {"role": "user", "content": json.dumps(shown, ensure_ascii=False)},
    ], Rewrite, temperature=0.1, model=_author_model(None))
    if err or obj is None:
        return None, f"model: {err}"
    new = dict(body)
    for k in shown:
        v = obj.get(k)
        if k == "choices":
            if len(v or []) != len(body["choices"]):
                return None, "choice count changed"
        elif not isinstance(v, str) or not v.strip():
            return None, f"{k} missing"
        new[k] = v
    if sorted(SLOT.findall(text_of(body))) != sorted(SLOT.findall(text_of(new))):
        return None, "placeholders changed"
    if len(new["stem"]) < 0.5 * len(body["stem"]):
        return None, "rewrite lost most of the stem"
    hit = furniture(text_of(new))
    if hit:
        return None, f"still points at the book: {hit!r}"
    return new, ""


LIMIT: int | None = None


def fix_furniture(apply: bool) -> None:
    with db() as conn:
        rows = conn.execute("SELECT key, qtype, payload FROM learnhub.pack_items "
                            "WHERE origin <> 'book_problem'").fetchall()
    flagged = [r for r in rows if furniture(text_of(body_of(r["payload"])))]
    print(f"furniture: {len(flagged)} of {len(rows)} authored items point at the book")
    done, left = 0, []
    for r in flagged[:LIMIT]:
        body = body_of(r["payload"])
        new, why = rewrite(body)
        if not new:
            left.append((r["key"], why, body.get("stem", "")[:80]))
            continue
        done += 1
        if done <= 5 or LIMIT:
            print("  before:", body["stem"].replace("\n", " ")[:400])
            print("  after: ", new["stem"].replace("\n", " ")[:400])
        if apply:
            payload = {**r["payload"], "spec": new} if "spec" in r["payload"] else {**r["payload"], **new}
            with db() as conn:
                conn.execute("UPDATE learnhub.pack_items SET payload = %(p)s WHERE key = %(k)s",
                             {"p": Json(payload), "k": r["key"]})
    print(f"  rewritten {done}; left {len(left)}" + (" (written)" if apply else " (dry run)"))
    for k, why, stem in left:
        print(f"  left {k[:8]} {why}: {stem}")


def fix_receipts(apply: bool) -> None:
    with db() as conn:
        packs = conn.execute("SELECT key, title, receipt FROM learnhub.exam_packs").fetchall()
        for p in packs:
            units = conn.execute('SELECT title, status, receipt FROM learnhub.pack_units WHERE pack_key = %(k)s',
                                 {"k": p["key"]}).fetchall()
            new = pack_totals(units)
            old = p["receipt"] or {}
            print(f"receipts: {p['title']}: kept {old.get('kept')} → {new['kept']}, "
                  f"dropped {old.get('dropped')} → {new['dropped']}, failed {len(old.get('failed') or [])} → {len(new['failed'])}")
            if apply:
                conn.execute("UPDATE learnhub.exam_packs SET receipt = %(r)s WHERE key = %(k)s",
                             {"r": Json(new), "k": p["key"]})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", choices=["answers", "furniture", "receipts"])
    ap.add_argument("--limit", type=int, help="furniture: rewrite only the first N (to read a sample)")
    a = ap.parse_args()
    global LIMIT
    LIMIT = a.limit
    for name, fn in (("answers", fix_answers), ("furniture", fix_furniture), ("receipts", fix_receipts)):
        if a.only in (None, name):
            fn(a.apply)


if __name__ == "__main__":
    main()
