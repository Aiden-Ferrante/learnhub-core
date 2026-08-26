#!/usr/bin/env python3
"""SPIKE (v0.19.0, step 2): can a local model author a PROBLEM, not just a question?

The step-1 spike ran `reading_guide` and answered half the question: retrieval-question
generation is good enough to build a pool around. Every one of its 26 outputs was a
comprehension question. Nothing has ever tested whether the same model can author the other
kind — *derive this, prove that, compute this* — which is the entire argument for Competency.

This is throwaway. It writes nothing, creates no table, and is meant to be read rather than
counted. If the output is recall wearing a problem's clothes, that is the Competency node's
falsifier firing and v0.19.0 should abort rather than ship a pool that cannot test
production.

Usage:  python scripts/spike_problem_items.py --doc <source> --section toc:1.4.2
"""
from __future__ import annotations

import argparse
import json
import os
import sys

for _cand in (os.path.join(os.path.dirname(__file__), "..", "backend"), "/app", "."):
    if os.path.isdir(os.path.join(_cand, "app")):
        sys.path.insert(0, _cand)
        break

from pydantic import BaseModel  # noqa: E402

from app.gateways.llm import ollama_structured_completion  # noqa: E402


class ProblemItem(BaseModel):
    prompt: str
    answer: str
    rubric: str


class ProblemSet(BaseModel):
    problems: list[ProblemItem]


# Written for this spike, not final. The design note says a problem item is the existing
# prompt → reveal → self-grade loop with a RICHER REVEAL, so the model has to produce a
# worked solution rather than a fact — and the rubric is what makes self-grading possible
# without an auto-checker.
#
# The negative instructions carry most of the weight. Step 1 showed the model's default
# habit is to ask about the text ("According to the text, …"), and a problem generator with
# that habit produces recall with an imperative verb glued to the front.
SYSTEM = (
    "You write PRACTICE PROBLEMS for one section of a textbook. You are given the section's "
    "heading and its full text. Ground everything ONLY in that text.\n\n"
    "A practice problem asks the learner to DO something and produce work: derive a result, "
    "apply a rule to a specific case, construct an example or counterexample, decide whether "
    "a claim holds and justify it, or carry out a procedure step by step.\n\n"
    "For each problem give:\n"
    "- prompt: the task. It must have a specific, checkable target — not 'discuss' or "
    "'explain the importance of'. Include any concrete inputs the learner needs.\n"
    "- answer: the WORKED SOLUTION, showing the steps, not just the final result. This is "
    "what the learner compares their own work against.\n"
    "- rubric: one sentence naming what a correct answer must contain, so a learner can "
    "grade themselves honestly.\n\n"
    "NEVER write a problem that can be answered by restating a definition or naming a term. "
    "NEVER ask 'according to the text' or about the section itself. If the section is purely "
    "descriptive and contains nothing that can be worked, return an EMPTY list rather than "
    "inventing a task — refusing is a correct answer.\n"
    "Write 2 or 3 problems. No markdown headers, no preamble."
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc", required=True)
    ap.add_argument("--section", required=True)
    ap.add_argument("--model", default=os.environ.get("LEARN_EXTRACT_MODEL"))
    a = ap.parse_args()

    from app.gateways import db

    with db() as conn:
        row = conn.execute(
            'SELECT string_agg(markdown, E\'\\n\\n\' ORDER BY "order") AS md, '
            "max(heading) AS heading FROM raw_content "
            "WHERE doc_id = %(d)s AND section_key = %(s)s",
            {"d": a.doc, "s": a.section},
        ).fetchone()
    if not row or not row.get("md"):
        print(f"no content for {a.section}", file=sys.stderr)
        return 1

    user = f"Section: {row.get('heading') or a.section}\n\n<section_text>\n{row['md']}\n</section_text>"
    obj, err = ollama_structured_completion(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
        ProblemSet, temperature=0.3, model=a.model,
    )
    if obj is None:
        print(f"model error: {err}", file=sys.stderr)
        return 1

    problems = obj.get("problems") or []
    print(f"=== {a.section}  {row.get('heading') or ''}")
    print(f"    source: {len(row['md'])} chars · {len(problems)} problems\n")
    if not problems:
        print("    (returned an empty list — refusal, which the prompt allows)\n")
    for i, p in enumerate(problems, 1):
        print(f"  [{i}] PROMPT: {p.get('prompt')}")
        print(f"      ANSWER: {p.get('answer')}")
        print(f"      RUBRIC: {p.get('rubric')}\n")
    print(json.dumps({"section": a.section, "count": len(problems)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
