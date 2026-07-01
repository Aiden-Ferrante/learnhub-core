#!/usr/bin/env python3
"""Local critic: score extracted concepts against the extraction spec.

Reads a sample JSON (list of {name, kind, signal, source, ...}) and asks a local
Ollama model to judge each concept on the spec's dimensions. Emits a per-concept
verdict + an aggregate failure-mode tally. Fully local; no keys.
"""
import json
import sys
import urllib.request

OLLAMA = "http://localhost:11434/api/chat"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "gemma4:latest"

# Mirrors _KINDS and the CONCEPT_SYSTEM_PROMPT spec in concepts_extract.py.
CRITIC_SYSTEM = (
    "You are a strict grader auditing a concept EXTRACTED from a textbook to build a study "
    "course. You are given the extracted name, kind, signal (the distilled lesson), and source "
    "(the verbatim passage it was drawn from). Judge ONLY what is shown; do not invent context.\n\n"
    "Score these booleans (true = PASSES the requirement):\n"
    "- grounded: every claim in `signal` is supported by `source`. FALSE if the signal adds "
    "facts, numbers, or scope not present in the source.\n"
    "- anchored: `source` is a real verbatim-looking sentence from the text that actually STATES "
    "this concept (defines/asserts it). FALSE if source is empty, is a heading/fragment, or does "
    "not state the named concept.\n"
    "- kind_ok: `kind` (definition|theorem|principle|result|method) fits the concept. A named "
    "term being defined = definition; a proven/if-then statement = theorem; a general guiding "
    "rule/best-practice = principle; a specific empirical finding/outcome = result; a "
    "procedure/technique/how-to = method.\n"
    "- durable: this is a DURABLE, teachable idea you could be quizzed on across contexts. FALSE "
    "if it is a one-off fact, statistic, dollar amount, date, product/market observation, "
    "anecdote, or motivational/historical prose.\n"
    "- name_ok: `name` is a SHORT canonical term (a 1-4 word noun phrase). FALSE if it is a full "
    "sentence, a claim, or a statistic.\n"
    "- signal_clean: `signal` is self-contained — no dangling 'this/it/we/the author/the "
    "chapter', no 'section/page/figure' references, and it names the concept in full.\n\n"
    "Then set `worst` to the SINGLE most damaging failed dimension (one of grounded, anchored, "
    "kind_ok, durable, name_ok, signal_clean), or \"none\" if all pass. Give a <=15-word `why`.\n"
    "Return ONLY JSON matching the schema."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "grounded": {"type": "boolean"},
        "anchored": {"type": "boolean"},
        "kind_ok": {"type": "boolean"},
        "durable": {"type": "boolean"},
        "name_ok": {"type": "boolean"},
        "signal_clean": {"type": "boolean"},
        "worst": {
            "type": "string",
            "enum": ["grounded", "anchored", "kind_ok", "durable", "name_ok", "signal_clean", "none"],
        },
        "why": {"type": "string"},
    },
    "required": ["grounded", "anchored", "kind_ok", "durable", "name_ok", "signal_clean", "worst", "why"],
}

DIMS = ["grounded", "anchored", "kind_ok", "durable", "name_ok", "signal_clean"]


def judge(c: dict) -> dict:
    user = (
        f"name: {c.get('name')}\n"
        f"kind: {c.get('kind')}\n"
        f"signal: {c.get('signal')}\n"
        f"source: {c.get('source')}"
    )
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": CRITIC_SYSTEM},
            {"role": "user", "content": user},
        ],
        "format": SCHEMA,
        "stream": False,
        "options": {"temperature": 0.0},
    }
    req = urllib.request.Request(
        OLLAMA, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        resp = json.load(r)
    return json.loads(resp["message"]["content"])


def main() -> None:
    sample = json.load(open(sys.argv[1]))
    tally = {d: 0 for d in DIMS}
    worst_tally: dict[str, int] = {}
    clean = 0
    verdicts = []
    for i, c in enumerate(sample):
        try:
            v = judge(c)
        except Exception as e:  # noqa: BLE001
            v = {d: True for d in DIMS}
            v.update({"worst": "none", "why": f"CRITIC_ERROR: {e}"})
        fails = [d for d in DIMS if not v.get(d, True)]
        if not fails:
            clean += 1
        for d in fails:
            tally[d] += 1
        w = v.get("worst", "none")
        if w != "none":
            worst_tally[w] = worst_tally.get(w, 0) + 1
        verdicts.append({"name": c.get("name"), "kind": c.get("kind"), **v, "fails": fails})
        mark = "OK " if not fails else "FAIL"
        print(f"[{mark}] {c.get('name')!r} ({c.get('kind')}) worst={w} :: {v.get('why')}", file=sys.stderr)

    n = len(sample)
    print("\n=== FAIL COUNTS BY DIMENSION (lower=better) ===", file=sys.stderr)
    for d in sorted(tally, key=lambda k: -tally[k]):
        print(f"  {d:14s} {tally[d]:2d}/{n}", file=sys.stderr)
    print("=== WORST-DIMENSION TALLY (the dominant failure mode) ===", file=sys.stderr)
    for d, cnt in sorted(worst_tally.items(), key=lambda kv: -kv[1]):
        print(f"  {d:14s} {cnt:2d}", file=sys.stderr)
    print(f"=== CLEAN (all pass): {clean}/{n} ===", file=sys.stderr)

    out = {
        "model": MODEL,
        "n": n,
        "clean": clean,
        "fail_by_dim": tally,
        "worst_tally": worst_tally,
        "dominant": max(worst_tally, key=worst_tally.get) if worst_tally else "none",
        "verdicts": verdicts,
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
