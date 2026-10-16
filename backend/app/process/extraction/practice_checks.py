"""Authoring-time QUALITY STAGES for practice items (v0.23.0) — objectives first, critique →
revise, the answerability gate, and the recall-in-disguise check.

The regexes in practice.py screen an item's FORM (furniture, deixis, no task). These stages
screen its SUBSTANCE: a worked solution that does not survive a second attempt, a prompt
the passage cannot answer, a "problem" that is a definition restated. All four are
generation-time — practice.py's pipeline calls them before anything is written, and the
graded loop (study/reviews.py, study/exams.py) never imports this module.

Every stage takes and returns plain item dicts ``{kind, prompt, answer, rubric,
difficulty}``. A stage whose model call fails never fakes a pass: the caller is told, and
the receipt counts it.

Sources for the techniques (survey 2026-10-16): objectives-first from DeepLearning.AI's
Quiz Generator V3; critique → revise from the ASEE 2026 agentic-MCQ evaluation (most of
the gain in the first two passes); round-trip answering from Alberti et al. 2019 and its
LLM successors.
"""

from __future__ import annotations

import json
from typing import Any

from app.gateways import (
    AnswerVerdictSet,
    AttemptSet,
    ObjectiveSet,
    ProblemSet,
    RecallVerdictSet,
    RetrieveSet,
    ollama_structured_completion,
)

MAX_OBJECTIVES_PER_LEVEL = 3
MAX_REVISE_PASSES = 2

# ── 1. objectives first ──────────────────────────────────────────────────────

OBJECTIVES_SYSTEM = (
    "You read one section of a textbook and list what it TEACHES — the learning "
    "objectives a careful instructor would test. Ground every objective ONLY in the "
    "section's text.\n\n"
    "Tag each objective with a level:\n"
    "- recall: the learner states, defines, distinguishes, or names a consequence.\n"
    "- produce: the learner derives, computes, applies a rule to a new case, constructs an "
    "example or counterexample, or decides whether a claim holds and justifies it.\n\n"
    "Only tag an objective 'produce' if the section gives the learner enough to actually "
    "do the work. A section that only describes or narrates has no produce objectives.\n"
    "Name the SKILL, never its answer: write 'Define bias at a point', not 'Define bias as "
    "the distance between the truth and the average prediction' — an item is written "
    "from each objective, and an objective that states its answer becomes an item that "
    "gives it away.\n"
    f"List at most {MAX_OBJECTIVES_PER_LEVEL} of each level, each one sentence, distinct "
    "from the others. If the section is front matter or teaches nothing, return an EMPTY "
    "list — refusing is a correct answer."
)


def objectives(heading: str, passage: str, concept_lines: str, model: str | None) -> list[dict[str, str]]:
    """The section's objectives, each ``{text, level}``. Raises on a failed call: without
    objectives there is nothing to steer authoring with, same as a failed authoring call."""
    user = f"Section: {heading}\n\n<section_text>\n{passage}\n</section_text>"
    if concept_lines:
        user += f"\n\n<key_concepts>\n{concept_lines}\n</key_concepts>"
    obj, err = ollama_structured_completion(
        [{"role": "system", "content": OBJECTIVES_SYSTEM}, {"role": "user", "content": user}],
        ObjectiveSet, temperature=0.2, model=model,
    )
    if err or obj is None:
        raise RuntimeError(f"objectives failed: {err}")
    out: list[dict[str, str]] = []
    per_level: dict[str, int] = {}
    seen: set[str] = set()
    for o in obj.get("objectives") or []:
        text = (o.get("text") or "").strip()
        level = o.get("level")
        if not text or level not in ("recall", "produce") or text.lower() in seen:
            continue
        if per_level.get(level, 0) >= MAX_OBJECTIVES_PER_LEVEL:
            continue
        per_level[level] = per_level.get(level, 0) + 1
        seen.add(text.lower())
        out.append({"text": text, "level": level})
    return out


def objectives_block(objs: list[dict[str, str]]) -> str:
    """Objectives as the authoring prompt's steering block: one item per objective."""
    lines = "\n".join(f"{i + 1}. {o['text']}" for i, o in enumerate(objs))
    return (
        f"\n\n<objectives>\n{lines}\n</objectives>\n"
        "Write exactly one item per objective above, in order, each testing that objective "
        "and no other."
    )


# ── 2. critique → revise ─────────────────────────────────────────────────────

FLAW_CHECKLIST = (
    "- It references the book or its apparatus ('the text', 'this section', 'Table 2', 'step 3').\n"
    "- It points at material it does not carry ('the quoted sentence', 'the formula above') "
    "instead of including that material in full.\n"
    "- It has no specific, checkable target ('discuss', 'explain the importance of').\n"
    "- The answer is wrong, incomplete, or not supported by the section.\n"
    "- A worked solution skips steps a learner would need to check their own work.\n"
    "- The rubric would not separate a correct answer from a plausible wrong one.\n"
    "- The difficulty rating does not match the 1-3 scale.\n"
    "- Two items test the same thing.\n"
)

REVISE_SYSTEM = (
    "You are reviewing practice items another author wrote for one section of a textbook. "
    "Check every item against this list of flaws:\n"
    + FLAW_CHECKLIST
    + "\nReturn the items with every flaw FIXED, grounded only in the section's text. Keep "
    "an item unchanged if it has no flaw. Remove an item only if it cannot be fixed. Never "
    "add new items. Keep the same fields."
)


def _as_wire(kind: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    """Items back into the authoring schema's wire shape, for the reviser to read."""
    if kind == "retrieve":
        return {"questions": [
            {"q": it["prompt"], "a": it["answer"], "difficulty": it.get("difficulty")} for it in items
        ]}
    return {"problems": [
        {"prompt": it["prompt"], "answer": it["answer"], "rubric": it.get("rubric") or "",
         "difficulty": it.get("difficulty")}
        for it in items
    ]}


def revise(
    kind: str, heading: str, passage: str, items: list[dict[str, Any]], model: str | None
) -> list[dict[str, Any]] | None:
    """One critique → revise pass. Returns RAW items (``prompt/answer/rubric/difficulty``)
    for practice.py to re-filter, capped at the input count — or None when the call failed,
    so the caller keeps the unrevised items and counts them."""
    if not items:
        return []
    user = (
        f"Section: {heading}\n\n<section_text>\n{passage}\n</section_text>\n\n"
        f"<items>\n{json.dumps(_as_wire(kind, items), ensure_ascii=False, indent=1)}\n</items>"
    )
    schema = RetrieveSet if kind == "retrieve" else ProblemSet
    obj, err = ollama_structured_completion(
        [{"role": "system", "content": REVISE_SYSTEM}, {"role": "user", "content": user}],
        schema, temperature=0.2, model=model,
    )
    if err or obj is None:
        return None
    if kind == "retrieve":
        raw = [
            {"prompt": q.get("q"), "answer": q.get("a"), "rubric": None, "difficulty": q.get("difficulty")}
            for q in (obj.get("questions") or [])
        ]
    else:
        raw = list(obj.get("problems") or [])
    return raw[: len(items)]


# ── 3. the answerability gate ────────────────────────────────────────────────

ATTEMPT_SYSTEM = (
    "You are a careful student who has studied the section below. Answer each numbered "
    "question or problem using ONLY what the section supports. Show the working for "
    "problems. If the section does not give enough to answer an item, answer exactly "
    "'CANNOT ANSWER' for it. Answer every item, keeping its index."
)

COMPARE_SYSTEM = (
    "You compare a student's answer against a reference answer for each numbered item. "
    "Judge only whether they agree on what matters — the result, the claim, the key steps. "
    "Wording, order and level of detail do not matter.\n"
    "- consistent: they agree, or the student's answer is a correct alternative.\n"
    "- contradicts: they reach different results or make incompatible claims.\n"
    "- unanswerable: the student answered 'CANNOT ANSWER', or the item cannot be answered "
    "from what it states — it relies on a table, figure, dataset, number or passage it "
    "mentions but does not include.\n"
    "- gives_away: the item's own wording already contains its answer, so a learner can "
    "copy it back without knowing anything.\n"
    "Give a one-sentence reason for each. Judge every item, keeping its index."
)

def _attempt(
    heading: str, passage: str, indexed: list[tuple[int, dict[str, Any]]], model: str | None
) -> dict[int, str]:
    """The student's answers by item index — only for indices that were asked and answered
    non-empty. A failed call returns {}."""
    numbered = "\n\n".join(f"[{i}] {it['prompt']}" for i, it in indexed)
    obj, err = ollama_structured_completion(
        [
            {"role": "system", "content": ATTEMPT_SYSTEM},
            {"role": "user", "content": (
                f"Section: {heading}\n\n<section_text>\n{passage}\n</section_text>\n\n"
                f"<items>\n{numbered}\n</items>"
            )},
        ],
        AttemptSet, temperature=0.0, model=model,
    )
    if err or obj is None:
        return {}
    asked = {i for i, _ in indexed}
    out = {}
    for a in obj.get("attempts") or []:
        ans = (a.get("answer") or "").strip()
        if a.get("index") in asked and ans:
            out[a["index"]] = ans
    return out


DROP_VERDICTS = frozenset({"contradicts", "unanswerable", "gives_away"})


def answerability(
    heading: str, passage: str, items: list[dict[str, Any]], model: str | None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    """Round-trip each item: a fresh attempt from the passage (never shown the stored
    answer), then a comparison. Returns ``(kept, failed, unchecked)``. ``failed`` items
    carry ``check = {verdict, reason}`` so the bake-off can show WHY. A call that fails, or
    an item the model skipped, keeps the item and counts it unchecked — never a silent pass."""
    if not items:
        return [], [], 0
    attempts = _attempt(heading, passage, list(enumerate(items)), model)
    # A batch can come back short — gpt-oss returned an EMPTY list for three long problems
    # (bake-off trace, 2026-10-16). Each missing item gets one attempt on its own.
    for i, it in enumerate(items):
        if i not in attempts:
            attempts.update(_attempt(heading, passage, [(i, it)], model))

    pairs = "\n\n".join(
        f"[{i}] ITEM: {it['prompt']}\nREFERENCE: {it['answer']}\nSTUDENT: {attempts[i]}"
        for i, it in enumerate(items) if i in attempts
    )
    if not pairs:
        return list(items), [], len(items)
    obj, err = ollama_structured_completion(
        [{"role": "system", "content": COMPARE_SYSTEM}, {"role": "user", "content": pairs}],
        AnswerVerdictSet, temperature=0.0, model=model,
    )
    if err or obj is None:
        return list(items), [], len(items)
    verdicts = {v.get("index"): v for v in obj.get("verdicts") or []}

    kept: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unchecked = 0
    for i, it in enumerate(items):
        v = verdicts.get(i) if i in attempts else None
        if v is None:
            unchecked += 1
            kept.append(it)
        elif v.get("verdict") in DROP_VERDICTS:
            failed.append({**it, "check": {"verdict": v["verdict"], "reason": v.get("reason"),
                                           "attempt": attempts[i]}})
        else:
            kept.append(it)
    return kept, failed, unchecked


# ── 4. recall in disguise ────────────────────────────────────────────────────

RECALL_SYSTEM = (
    "You audit practice PROBLEMS. A real problem makes the learner produce work: derive, "
    "compute, apply a rule to a case, construct, or decide and justify. A problem is RECALL "
    "IN DISGUISE when its worked solution does nothing but restate one of the key concepts "
    "below — a definition, a stated property, a named fact — with no derivation, "
    "computation, construction or case analysis.\n"
    "For each numbered problem, set restates=true only if it is recall in disguise. Give a "
    "one-sentence reason. Judge every item, keeping its index."
)


def recall_in_disguise(
    items: list[dict[str, Any]], concept_lines: str, model: str | None
) -> tuple[list[dict[str, Any]], int, int]:
    """Relabel 'problem' items whose solution only restates a concept as 'retrieve' — they
    would otherwise count toward production fluency while testing recall. Returns
    ``(items, relabeled, unchecked)``. No concept lines → nothing to compare against, so
    nothing is checked (and nothing counted unchecked: there was no check to run)."""
    problems = [i for i, it in enumerate(items) if it["kind"] == "problem"]
    if not problems or not concept_lines:
        return items, 0, 0
    numbered = "\n\n".join(
        f"[{i}] PROBLEM: {items[i]['prompt']}\nSOLUTION: {items[i]['answer']}" for i in problems
    )
    obj, err = ollama_structured_completion(
        [
            {"role": "system", "content": RECALL_SYSTEM},
            {"role": "user", "content": f"<key_concepts>\n{concept_lines}\n</key_concepts>\n\n{numbered}"},
        ],
        RecallVerdictSet, temperature=0.0, model=model,
    )
    if err or obj is None:
        return items, 0, len(problems)
    verdicts = {v.get("index"): v for v in obj.get("verdicts") or []}
    out = list(items)
    relabeled = unchecked = 0
    for i in problems:
        v = verdicts.get(i)
        if v is None:
            unchecked += 1
        elif v.get("restates") is True:
            out[i] = {**items[i], "kind": "retrieve", "relabel": v.get("reason")}
            relabeled += 1
    return out, relabeled, unchecked
