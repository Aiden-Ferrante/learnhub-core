"""Generator specs: one skill, new numbers on every seed.

A spec holds parameters, a stem, a ``code`` snippet whose printed output IS the answer, and
``distractors``, each a buggy version of that snippet named for the mistake it encodes, so a
wrong choice says what went wrong. ``{{name}}`` substitutes a parameter; ``{{code}}`` in a
stem substitutes the rendered snippet.

Pure except for the sandbox call. No LLM runs here, which is what keeps the graded loop
keyless: the model writes the spec once and this file computes every instance.
"""

from __future__ import annotations

import hashlib
import random
import re
from typing import Any

from app.process.packs.sandbox import run_snippets

_SLOT = re.compile(r"\{\{\s*(\w+)\s*\}\}")
HARNESS_SEEDS = 25
MIN_VALID_SEEDS = 20
RESEED_TRIES = 12


def _draw(params: dict[str, Any], rng: random.Random) -> dict[str, str]:
    values: dict[str, str] = {}
    for name, p in sorted((params or {}).items()):
        if p.get("kind") == "choice":
            values[name] = str(rng.choice(p["values"]))
        else:
            values[name] = str(rng.randint(int(p["min"]), int(p["max"])))
    return values


def _fill(template: str, values: dict[str, str]) -> str:
    return _SLOT.sub(lambda m: values.get(m.group(1), m.group(0)), template or "")


def _outcome(res: dict[str, Any]) -> str | None:
    """A run as the text a learner picks. An exception is a legitimate answer in Python."""
    if res.get("refused") or res.get("timeout"):
        return None
    if res.get("exception"):
        return f"raises {res['exception']}"
    text = (res.get("stdout") or "").rstrip("\n")
    return text if text.strip() else None


def render(spec: dict[str, Any], seed: int, choices: int = 5) -> dict[str, Any] | None:
    """One instance, or None when this seed collapses (duplicate choices, a failed run)."""
    rng = random.Random(seed)
    values = _draw(spec.get("params") or {}, rng)
    code = _fill(spec["code"], values)
    bugs = [d for d in (spec.get("distractors") or []) if d.get("code")]
    step_codes = [(i, _fill(s["code"], values)) for i, s in enumerate(spec.get("steps") or [])
                  if s.get("code")]
    runs = run_snippets([code] + [_fill(d["code"], values) for d in bugs]
                        + [c for _, c in step_codes])
    key = _outcome(runs[0])
    if key is None:
        return None
    wrong: dict[str, str] = {}
    for d, res in zip(bugs, runs[1:]):
        text = _outcome(res)
        if text and text != key and text not in wrong:
            wrong[text] = str(d.get("misconception") or "")
    if len(wrong) < choices - 1:
        return None
    picked = rng.sample(sorted(wrong), choices - 1)
    options = picked + [key]
    rng.shuffle(options)
    values = {**values, "code": code}
    shown = {i: _outcome(r) for (i, _), r in zip(step_codes, runs[1 + len(bugs):])}
    steps = []
    for i, s in enumerate(spec.get("steps") or []):
        show = shown.get(i) if s.get("code") else _fill(s.get("show", ""), values)
        steps.append({"ask": _fill(s.get("ask", ""), values), "show": show or ""})
    stem = _fill(spec["stem"], values)
    return {
        "stem": stem, "choices": options, "answer": options.index(key),
        "why": {str(options.index(t)): wrong[t] for t in picked},
        "explain": _fill(spec.get("explain", ""), values), "steps": steps, "seed": seed,
        "fingerprint": hashlib.sha256((stem + "|" + key).encode()).hexdigest()[:16],
    }


def render_unseen(spec: dict[str, Any], seen: set[str], seed: int, choices: int = 5):
    """The first instance from ``seed`` onward whose fingerprint has not been shown."""
    for n in range(RESEED_TRIES):
        inst = render(spec, seed + n * 7919, choices)
        if inst and inst["fingerprint"] not in seen:
            return inst
    return None


def harness(spec: dict[str, Any], choices: int = 5) -> str | None:
    """Why this spec may not enter the pool, or None. Runs it across seeds: enough seeds must
    render, an answer must vary, and a re-run of one seed must reproduce exactly."""
    if not _SLOT.search(spec.get("code") or "") and not spec.get("params"):
        return "no parameters: not a generator"
    instances = [render(spec, s * 7919 + 1, choices) for s in range(HARNESS_SEEDS)]
    valid = [i for i in instances if i]
    if len(valid) < MIN_VALID_SEEDS:
        return f"only {len(valid)}/{HARNESS_SEEDS} seeds rendered"
    if len({i["fingerprint"] for i in valid}) < 5:
        return "fewer than 5 distinct instances"
    bad = re.compile(r"\b(NaN|None|undefined|Infinity)\b|\{\{")
    for i in valid:
        if bad.search(i["stem"]) or bad.search(i["explain"]):
            return "unrendered token in text"
    again = render(spec, 1, choices)
    if again != instances[0]:
        return "not deterministic"
    return None
