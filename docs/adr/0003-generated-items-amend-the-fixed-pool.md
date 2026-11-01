# 0003: Generated items amend the fixed pool

2026-11-01. Corrects `docs/practice-items-spec.md`, whose text stays as written.

## Context

The practice spec says: fixed pool plus regenerate, no generate-on-demand, and no LLM in the
graded loop. The midterm artifacts showed what that costs. Fresh numbers on every sitting were
one of the reasons they were used and the app was not, and a fixed item can only be unseen once.

## Decision

Exam packs add `gen` items: a stored spec with parameters, a stem, a Python snippet whose output
is the answer, and buggy snippets as distractors. Instances are computed when a paper is drawn.

"No LLM in the graded loop" still holds. A model writes the spec once at build time, and it must
pass a seed harness and a judge. Drawing and marking run no model.

`ext_practice`, the practice session and the old exam mode are unchanged. Packs have their own
tables and may be retired without touching them.

## Consequences

- Model-written code runs in the app container, at build time and when papers are drawn.
  `process/packs/sandbox.py` holds it to an AST gate, `python -I -S` with an empty environment,
  a reduced builtins table and CPU, memory, file and process limits. That is containment for
  our own model's output, not a boundary for hostile input.
- The human accepted fresh numbers. The form of it, specs plus a subprocess, was the agent's call
  and is open to review at acceptance.
- The sandboxed widget host was not built. Nothing in scope needs a bespoke per-course tool yet.
