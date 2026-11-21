"""derive/from-numbered-headings — outline from an explicitly numbered document (priority 0).

For documents whose headings already carry their own decimal numbering — ``# 1``,
``## 1.1``, ``### 1.1.2`` — the table of contents is not something to infer. It is
written down. This strategy reads it and does nothing else: no font clustering, no page
heuristics, no guessing at levels from ``#`` depth.

It runs ahead of ``from-headings`` because that strategy is a *recovery* pass. Its text
fallback clamps every heading to ``_MAX_LEVELS`` and promotes all of them, so a book with
five heading levels comes back as a flat tree of every sub-beat in the document — several
hundred entries where the author wrote seven chapters. That is the right answer when the
levels are guesses. It is the wrong answer when the author numbered them.

The numbering IS the contract, so the depth cut is deliberate: a heading numbered deeper
than ``_MAX_DEPTH`` is content, not structure. It still persists as a ``raw_content``
block — with a null ``structure_id``, which the schema allows precisely for blocks finer
than the TOC — and it still gets read, extracted from and studied as part of its chapter.
It simply does not become a node in the syllabus.

Unnumbered headings are skipped for the same reason: mixing them in would put a prose
sub-heading beside a chapter and there would be no way to tell which was which.
"""

from __future__ import annotations

import re

from app.process.content.toc_strategies.base import (
    DeriveOutcome,
    TocDeriveContext,
    page_sanity_gates,
)

_MIN_ENTRIES = 3
# Matches Learn Hub's own structure depth; see from_headings._MAX_LEVELS.
_MAX_DEPTH = 3
# A whole document numbered from a single root ("1", "1.1", "1.1.2", …) is one section of
# a larger work, which is exactly how a compiled book section arrives. Anything claiming
# to be numbered but offering only one top-level node is not really a numbered document.
_NUMERIC = re.compile(r"^\d+(?:\.\d+)*$")
_MAX_TITLE_CHARS = 120


def derive(ctx: TocDeriveContext) -> DeriveOutcome:
    numbered = [
        b for b in ctx.blocks
        if b.number_key and _NUMERIC.match(b.number_key) and (b.heading or "").strip()
    ]
    if len(numbered) < _MIN_ENTRIES:
        return f"only {len(numbered)} numbered headings (need {_MIN_ENTRIES})"

    entries: list[dict] = []
    for b in numbered:
        depth = b.number_key.count(".") + 1
        if depth > _MAX_DEPTH:
            continue
        title = b.heading.strip()
        if len(title) > _MAX_TITLE_CHARS:
            continue
        # The number stays ON the title. Downstream, ``build_outline_from_bookmarks``
        # splits it off itself into ``number_label`` and derives ``section_key`` from it
        # (``toc:1.1.2``). Stripping it here looks tidier and silently costs the document
        # its numbering: the key falls back to a slug, and the study surface — which
        # filters to entries that HAVE a number — comes back empty.
        entries.append({"level": depth, "title": title, "page": b.page_start or 0})

    if len(entries) < _MIN_ENTRIES:
        return (
            f"{len(numbered)} numbered headings, but only {len(entries)} within "
            f"{_MAX_DEPTH} levels"
        )

    # A numbered outline whose levels jump (1 -> 3 with no 2) is numbered by accident —
    # a list, or a price table — not by structure. Decline rather than build a tree with
    # a hole in it.
    for prev, cur in zip(entries, entries[1:]):
        if cur["level"] > prev["level"] + 1:
            return (
                f"numbering skips a level at {cur['title']!r} "
                f"(depth {prev['level']} -> {cur['level']})"
            )

    # Page gates are a no-op without page provenance, by design in base.py. They still
    # run so that a *PDF* routed here is held to the same credibility bar as any other
    # derived outline.
    reason = page_sanity_gates(entries, ctx.page_count, min_entries=_MIN_ENTRIES)
    return entries if reason is None else reason
