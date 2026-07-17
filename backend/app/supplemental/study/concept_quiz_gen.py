"""Deterministic concept MCQ — no LLM. Given a target concept and a candidate pool, build a
"which concept does this describe?" question: stem = the concept's signal, answer = its name,
distractors = sibling concept names (same section → same kind → any). Pure (no DB).
"""

from __future__ import annotations

import random
import re
from typing import Any

Concept = dict[str, Any]  # {key, name, kind, signal, source, sectionKey}


def _finalize_choices(
    correct: str, distractors: list[str], rng: random.Random
) -> tuple[list[str], int]:
    """Assemble exactly 4 unique choices (correct + up to 3 distractors), padded, shuffled."""
    choices = [correct]
    for d in distractors:
        if len(choices) >= 4:
            break
        if d and d != correct and d not in choices:
            choices.append(d)
    pad = 0
    while len(choices) < 4:
        pad += 1
        choices.append(f"(none of these · {pad})")
    rng.shuffle(choices)
    return choices, choices.index(correct)


def _name_variants(name: str) -> list[str]:
    """The concept name + simple singular/plural forms, longest first — for redaction."""
    n = (name or "").strip()
    if not n:
        return []
    out = {n}
    if n.endswith("s"):
        out.add(n[:-1])
    else:
        out.add(n + "s")
    # also fold a trailing parenthetical acronym, e.g. "Masked language model (MLM)"
    bare = re.sub(r"\s*\([^)]*\)\s*$", "", n).strip()
    if bare and bare != n:
        out.add(bare)
    return sorted({v for v in out if v}, key=len, reverse=True)


def redact_name(signal: str, name: str) -> str:
    """Blank the concept's own name out of its signal so the stem can't give the answer away.
    Turns 'Tokenization is the process of breaking text into tokens' into '___ is the process
    of breaking text into tokens' — a real recall task, not pattern-spotting the first word."""
    if not signal or not name:
        return signal
    variants = _name_variants(name)
    if not variants:
        return signal
    pat = re.compile(r"\b(" + "|".join(re.escape(v) for v in variants) + r")\b", re.IGNORECASE)
    out = pat.sub("———", signal)  # em-dash run reads as a blank
    out = re.sub(r"(———)(\s+\1)+", r"\1", out)  # collapse adjacent blanks
    return out.strip()


def _tiered_distractors(target: Concept, pool: list[Concept], rng: random.Random) -> list[str]:
    key, name, section, kind = (
        target.get("key"),
        target.get("name"),
        target.get("sectionKey"),
        target.get("kind"),
    )
    same_section = [c["name"] for c in pool if c.get("sectionKey") == section and c.get("key") != key]
    same_kind = [c["name"] for c in pool if c.get("kind") == kind and c.get("key") != key]
    others = [c["name"] for c in pool if c.get("key") != key]
    for tier in (same_section, same_kind, others):
        rng.shuffle(tier)

    out: list[str] = []
    for tier in (same_section, same_kind, others):
        for n in tier:
            if n and n != name and n not in out:
                out.append(n)
            if len(out) >= 3:
                return out
    return out


def build_concept_question(
    target: Concept,
    pool: list[Concept],
    rng: random.Random | None = None,
    distractor_names: list[str] | None = None,
) -> dict[str, Any] | None:
    """Build one MCQ for ``target``. ``distractor_names`` (if given — e.g. embedding-nearest,
    most-confusable concept names) are preferred, then topped up from the section/kind tiers.
    Returns None if the concept has no signal to quiz on."""
    rng = rng or random.Random()
    name = target.get("name")
    signal = (target.get("signal") or "").strip()
    if not name or not signal:
        return None
    distractors = [d for d in (distractor_names or []) if d and d != name]
    distractors += _tiered_distractors(target, pool, rng)
    choices, answer_index = _finalize_choices(name, distractors, rng)
    stem_signal = redact_name(signal, name)
    return {
        "stem": f"Which concept fits this description?\n\n“{stem_signal}”",
        "choices": choices,
        "answer_index": answer_index,
        "expected": name,
        "conceptKey": target.get("key"),
        "sectionKey": target.get("sectionKey"),
        "signal": signal,
        "source": target.get("source"),
    }


def public_concept_question(q: dict[str, Any]) -> dict[str, Any]:
    """Client view — answer withheld."""
    return {"stem": q["stem"], "choices": q["choices"]}
