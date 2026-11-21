"""Exam packs — a textbook turned into Learn items and an exam pool.

Owns: the authoring job that builds a pack chapter by chapter and drops anything not
grounded in the book (author), generator specs that render new numbers on every seed
(gen), the sandbox that runs a generator's model-written snippets (sandbox), and the checks
a question must pass before a learner sees it: a program's real output as its answer, and no
reference to the book's furniture (answers).
Depends on: process/content, gateways.
"""

from app.process.packs.answers import computed_answers, furniture
from app.process.packs.author import build_pack, reweight_pack
from app.process.packs.gen import harness, render, render_unseen
from app.process.packs.sandbox import gate, run_snippets

__all__ = [
    "build_pack",
    "reweight_pack",
    "computed_answers",
    "furniture",
    "gate",
    "harness",
    "render",
    "render_unseen",
    "run_snippets",
]
