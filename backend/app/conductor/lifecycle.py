"""Per-document lifecycle state, derived from data we already store (no new store).

Linear states: ``missing → converted → extracted`` (extracted ≡ studyable). Enrichment
(skeleton / guides / quizzes / audiobook) rides on top, per chapter, on demand. The
conductor reads this to observe transitions and to drive auto-chaining
``converted → extract``.

State is a pure read: a ``documents`` row means converted; any ``concepts`` for the doc
means extracted. Nothing here writes.
"""

from __future__ import annotations

import os

from app.gateways import enqueue_build


def autochain_enabled() -> bool:
    """Whether a freshly-converted document auto-advances to extraction (``LEARN_AUTOCHAIN``,
    default on). Off keeps conversion and extraction as separate manual steps."""
    return os.environ.get("LEARN_AUTOCHAIN", "1") != "0"


def on_converted(doc_id: str) -> None:
    """Advance a just-converted document toward studyable by enqueuing CORE extraction
    (concepts only). Enrichment (deep / skeleton / guides / quizzes / audiobook) stays
    on-demand. No-op when auto-chaining is disabled. Called by the convert runner."""
    if doc_id and autochain_enabled():
        enqueue_build(doc_id, "", kind="extract")
