"""Per-document lifecycle state, derived from data we already store (no new store).

Linear states: ``missing → converted → extracted`` (extracted ≡ studyable). Enrichment
(deep / skeleton / guides / quizzes / audiobook) rides on top as a per-chapter coverage
overlay — see overview/coverage. The conductor reads this to observe transitions, and
(Stage 4) to drive auto-chaining ``converted → extract``.

State is a pure read: a ``documents`` row means converted; any ``concepts`` for the doc
means extracted. Nothing here writes.
"""

from __future__ import annotations

import os
from typing import Any

from app.content.documents import fetch_latest_document
from app.platform.arango import connect_arango
from app.platform.jobs import enqueue_build


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


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


def document_state(doc_id: str | None = None) -> dict[str, Any]:
    """The document's lifecycle state, derived from stored data.

    Returns ``{docId, state, studyable, concepts}`` where ``state`` is one of
    ``missing`` (no document row), ``converted`` (content persisted, no concepts yet),
    or ``extracted`` (concepts exist — studyable)."""
    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"docId": None, "state": "missing", "studyable": False, "concepts": 0}
    converted = db.has_collection("documents") and db.collection("documents").get(doc_id) is not None
    if not converted:
        return {"docId": doc_id, "state": "missing", "studyable": False, "concepts": 0}
    concepts = 0
    if db.has_collection("concepts"):
        concepts = db.aql.execute(
            "RETURN LENGTH(FOR c IN concepts FILTER c.docId == @d RETURN 1)",
            bind_vars={"d": doc_id},
        ).next()
    state = "extracted" if concepts > 0 else "converted"
    return {
        "docId": doc_id,
        "state": state,
        "studyable": state == "extracted",
        "concepts": concepts,
    }
