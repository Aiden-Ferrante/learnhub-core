"""Checks a question must pass before a learner sees it: a program's real output stands as its
answer, and a stem asks about the subject, not about the book it came from.

Book problems often print no answer, but many of them are "what does this program print?",
and the sandbox can answer that. What it prints, or the exception it raises, becomes the
key. A snippet that cannot run as printed (blanks to fill, ``input()``, a flattened layout)
stays self-marked: a guessed key is worse than none.
"""

from __future__ import annotations

import ast
import builtins
import re

from app.process.packs.sandbox import run_snippets

_FENCE = re.compile(r"^```[\w-]*\s*$", re.M)
_NOT_RUNNABLE = re.compile(r"\?\?\?|_{3,}|\binput\s*\(|#\s*write your code", re.I)

# The book's furniture rather than its subject: "according to the textbook", "as shown in
# Table 2-1". The 2026-08 spikes found these in ~23% of questions; v0.24.0 still shipped ~100.
_FURNITURE = re.compile(
    r"\b(?:according to|as (?:stated|described|shown|explained|defined|noted|given) in) (?:the |this )?"
    r"(?:textbook|text|book|author|course|chapter|section|passage|reading|lesson|material)\b"
    r"|\b(?:fits?|matches?|follows?|per|from|by|in line with|consistent with) the "
    r"(?:textbook|book|author|chapter|passage|reading|lesson)\b"
    r"|\bthe (?:textbook|book|author|passage|chapter)(?:'s)? (?:says|said|states|claims|describes|"
    r"mentions|calls|recommends|explains|defines|uses|shows|gives|lists|warns)\b"
    r"|\b(?:does|did|do|would|will) the (?:textbook|book|author|text|passage|chapter)\b"
    r"|\btextbook\b|\bthe authors?\b"
    r"|\b(?:table|figure|fig\.|listing) \d+(?:[-.]\d+)*\b",
    re.I,
)


def furniture(text: str) -> str | None:
    """The phrase that points at the book instead of the subject, or None."""
    m = _FURNITURE.search(text or "")
    return m.group(0) if m else None


def snippet_of(stem: str, code: str = "") -> str | None:
    """The runnable program in a problem: its ``code`` field, else the block after the
    question line. None unless it parses and has something to print."""
    src = (code or "").strip()
    if not src:
        parts = re.split(r"\n\s*\n", stem or "", maxsplit=1)
        if len(parts) < 2:
            return None
        src = _FENCE.sub("", parts[1]).strip()
    if not src or _NOT_RUNNABLE.search(src) or "![" in src:
        return None
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    if free_names(tree):
        return None  # leans on code printed elsewhere in the book; its NameError is not the answer
    if "print" in src:
        return src
    # No print: answer as the interactive prompt would, by showing the last expression, or the
    # variable the question names when the last line assigns it.
    last = tree.body[-1] if tree.body else None
    if isinstance(last, ast.Expr):
        return src + f"\nprint(repr({ast.unparse(last.value)}))"
    if (isinstance(last, ast.Assign) and len(last.targets) == 1 and isinstance(last.targets[0], ast.Name)
            and re.search(rf"\b{re.escape(last.targets[0].id)}\b", stem or "")):
        return src + f"\nprint(repr({last.targets[0].id}))"
    return None


def free_names(tree: ast.AST) -> set[str]:
    """Names the snippet reads but never binds anywhere and Python does not provide."""
    bound, read = set(dir(builtins)), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            (read if isinstance(node.ctx, ast.Load) else bound).add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            bound.update((a.asname or a.name).split(".")[0] for a in node.names)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
    return read - bound


def outcome(result: dict) -> str | None:
    """A sandbox result as the text a learner checks against, or None when it says nothing."""
    if result.get("refused") or result.get("timeout"):
        return None
    out = (result.get("stdout") or "").rstrip()
    exc = result.get("exception")
    if exc:
        return f"{out}\nRaises {exc}".strip() if out else f"Raises {exc}"
    return out or None


def computed_answers(problems: list[tuple[str, str]]) -> list[str | None]:
    """For each (stem, code): the program's real output, or None. One sandbox child for all."""
    snippets = [snippet_of(stem, code) for stem, code in problems]
    runnable = [s for s in snippets if s]
    results = iter(run_snippets(runnable) if runnable else [])
    return [outcome(next(results)) if s else None for s in snippets]
