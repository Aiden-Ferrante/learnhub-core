"""Exam packs — a textbook turned into Learn items and an exam pool.

Owns: the authoring job that builds a pack chapter by chapter and drops anything not
grounded in the book (author), generator specs that render new numbers on every seed
(gen), and the sandbox that runs a generator's model-written snippets (sandbox).
Depends on: process/content, gateways.
"""

from app.process.packs.author import build_pack
from app.process.packs.gen import harness, render, render_unseen
from app.process.packs.sandbox import gate, run_snippets

__all__ = [
    "build_pack",
    "gate",
    "harness",
    "render",
    "render_unseen",
    "run_snippets",
]
