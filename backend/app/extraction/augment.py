"""Per-section "augmented ebook" scaffolding: LLM-generated learning objectives + a recap,
derived from the section's extracted concepts. Cached once per (doc, section) in
``section_augment``; falls back to a deterministic keyless version if the model is unavailable.
"""

from __future__ import annotations

import hashlib
import os
from typing import Any

from psycopg.types.json import Json

from app.platform.db import db
from app.extraction.concept_store import fetch_section_concepts
from app.platform.llm import _ollama_model, ollama_structured_completion
from app.platform.llm_schemas import Augment

AUGMENT = "section_augment"

_KIND_VERB = {
    "definition": "Define",
    "theorem": "State and apply",
    "principle": "Explain why",
    "result": "Recall",
    "method": "Apply",
}


def _augment_model() -> str:
    return os.environ.get("LEARN_AUGMENT_MODEL") or _ollama_model()


def _akey(doc_id: str, section_key: str) -> str:
    return hashlib.sha256(f"{doc_id}|{section_key}".encode()).hexdigest()[:16]


def _keyless(concepts: list[dict[str, Any]]) -> dict[str, Any]:
    """Deterministic fallback: objectives templated by kind, recap stitched from signals."""
    objectives = [f"{_KIND_VERB.get(c.get('kind'), 'Understand')} {c.get('name')}" for c in concepts[:5]]
    recap = " ".join((c.get("signal") or "").strip().rstrip(".") + "." for c in concepts[:4] if c.get("signal"))
    return {"objectives": objectives, "recap": recap}


def section_augment(
    doc_id: str | None, section_key: str, model: str | None = None, force: bool = False
) -> dict[str, Any]:
    sec = fetch_section_concepts(section_key, doc_id)
    concepts = sec.get("concepts", [])
    resolved_doc = sec.get("docId") or doc_id
    if not concepts or not resolved_doc:
        return {"objectives": [], "recap": "", "cached": False}

    key = _akey(resolved_doc, section_key)
    if not force:
        with db() as conn:
            existing = conn.execute(
                "SELECT objectives, recap FROM section_augment WHERE key = %(k)s", {"k": key}
            ).fetchone()
        if existing:
            return {
                "objectives": existing.get("objectives") or [],
                "recap": existing.get("recap") or "",
                "cached": True,
            }

    listing = "\n".join(
        f"- {c.get('name')} ({c.get('kind')}): {c.get('signal', '')}" for c in concepts[:12]
    )
    system = (
        "You write concise study scaffolding for a textbook section. Given the concepts the "
        "section teaches, produce 2-4 learning objectives as short imperatives a learner can do "
        "(e.g. 'Define X', 'Explain why Y'), and a 2-3 sentence plain-language recap. Use ONLY "
        "the given concepts; no preamble, no 'the learner'."
    )
    user = f"Concepts taught in this section:\n{listing}\n\nReturn objectives + recap."
    obj, err = ollama_structured_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        Augment,
        model=model or _augment_model(),
        timeout=180.0,
    )
    if err or not obj or not obj.get("objectives"):
        result = _keyless(concepts)
        result["fallback"] = True
    else:
        result = {
            "objectives": [str(o).strip() for o in obj.get("objectives", []) if str(o).strip()][:5],
            "recap": str(obj.get("recap", "")).strip(),
        }

    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO section_augment (key, doc_id, section_key, objectives, recap) "
                "VALUES (%(key)s,%(doc_id)s,%(section_key)s,%(objectives)s,%(recap)s) "
                "ON CONFLICT (key) DO UPDATE SET doc_id=EXCLUDED.doc_id, "
                "section_key=EXCLUDED.section_key, objectives=EXCLUDED.objectives, recap=EXCLUDED.recap",
                {"key": key, "doc_id": resolved_doc, "section_key": section_key,
                 "objectives": Json(result.get("objectives")), "recap": Json(result.get("recap"))},
            )
    except Exception:
        pass
    return {**result, "cached": False}
