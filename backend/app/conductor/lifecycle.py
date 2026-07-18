"""Per-document lifecycle state, derived from data we already store (no new store).

Linear states: ``missing → converted → extracted`` (extracted ≡ studyable).

Conversion and extraction are SEPARATE steps by design (2026-07-18): converting a book
gives you its structure (the TOC tree) and the reader immediately; concept extraction is
an hours-long whole-book LLM pass, so it runs on demand, per chapter, picked from the
TOC (the Process tab's per-chapter Build). Enrichment (skeleton / guides /
audiobook) is likewise on-demand. ``LEARN_AUTOCHAIN=1`` re-enables the old
convert→extract-everything chain for unattended bulk ingests.

State is a pure read: a ``raw_documents`` row means converted; any ``ext_concepts`` for
the doc means extracted. Nothing here writes.
"""

from __future__ import annotations

import os

from app.gateways import enqueue_build


def autochain_enabled() -> bool:
    """Whether a freshly-converted document auto-advances to whole-book extraction
    (``LEARN_AUTOCHAIN``, default OFF — extraction is on-demand per chapter)."""
    return os.environ.get("LEARN_AUTOCHAIN", "0") == "1"


def on_converted(doc_id: str) -> None:
    """Called by the convert runner. Default: no-op — the book is readable now, and
    concepts are built per chapter from the TOC when wanted. With auto-chain opted in,
    enqueues whole-book CORE extraction (concepts only)."""
    if doc_id and autochain_enabled():
        enqueue_build(doc_id, "", kind="extract")
