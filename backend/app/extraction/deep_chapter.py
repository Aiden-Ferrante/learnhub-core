"""Deep Chapter — pre-generated overlay for the reading-first chapter surface.

Two non-destructive, idempotent artifacts layered on the existing pipeline:

- ``deep_chapter_briefing`` (collection): a chapter briefing ASSEMBLED from the
  already-cached artifacts (orient objectives/watch-fors + skeleton essences +
  key concepts) — no new LLM pass of its own, cached per (doc, scope).
- ``concepts.deepExplanation`` (field): a 1-2 paragraph expansion of each
  concept's one-line ``signal``, grounded in its verbatim ``source`` passage.
  Only concepts missing the field are generated, so re-processing never
  duplicates work.

The pass runs eagerly at document-processing time (hooked at the end of
``extract_concepts_document``) and can be backfilled for already-processed
documents via POST /api/deep-chapter/prepare. The GET assembler never calls
the LLM — it serves whatever is cached, so opening a chapter is always fast.
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
from typing import Any

from app.content.arango_content import fetch_latest_document, fetch_section_content
from app.content.arango_tree import connect_arango
from app.platform.llm import _ollama_model, ollama_chat_completion

BRIEFING = "deep_chapter_briefing"
CONCEPTS = "concepts"

# One backfill per (doc, scope) at a time — same guard pattern as concept_quiz_llm.
_inflight: set[str] = set()
_inflight_lock = threading.Lock()


def _deep_model() -> str:
    return (
        os.environ.get("LEARN_DEEP_MODEL")
        or os.environ.get("LEARN_AUGMENT_MODEL")
        or _ollama_model()
    )


def _bkey(doc_id: str, scope: str | None) -> str:
    return hashlib.sha256(f"{doc_id}|{scope or 'ALL'}".encode()).hexdigest()[:16]


def ensure_deep_collections(db) -> None:
    if not db.has_collection(BRIEFING):
        col = db.create_collection(BRIEFING)
        col.add_persistent_index(fields=["docId"])


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


def _scope_section_keys(doc_id: str, scope: str) -> list[str]:
    content = fetch_section_content(scope, doc_id)
    return sorted({b.get("sectionKey") for b in content.get("blocks", []) if b.get("sectionKey")})


# --------------------------------------------------------------------------- #
# Per-concept deep explanations
# --------------------------------------------------------------------------- #

DEEP_SYSTEM = (
    "You expand a textbook concept into a short deep explanation for a learner who just met "
    "it in the text. You are given the concept's name, kind, a one-line signal, the verbatim "
    "source passage, and sometimes prerequisite concept names. Write 1-2 short paragraphs of "
    "plain prose that: state what the concept is in the learner's own terms, unpack how it "
    "works or why it holds, and say when or why it matters. If prerequisites are given, "
    "connect to them in one sentence. Ground every claim in the source passage — never invent "
    "facts, numbers, or scope beyond it. No headings, no bullet points, no 'the author' or "
    "'this section' — output only the explanation prose."
)


def _explain_one(concept: dict[str, Any], model: str | None = None) -> str | None:
    prereqs = ", ".join(concept.get("prereqNames") or [])
    user = (
        f"Concept: {concept.get('name')}\n"
        f"Kind: {concept.get('kind')}\n"
        f"Signal: {concept.get('signal')}\n"
        + (f"Prerequisites: {prereqs}\n" if prereqs else "")
        + f"Source passage:\n{(concept.get('source') or '').strip()}"
    )
    for _ in range(2):
        text, _err = ollama_chat_completion(
            [{"role": "system", "content": DEEP_SYSTEM}, {"role": "user", "content": user}],
            temperature=0.3,
            model=model or _deep_model(),
        )
        if text and len(text.strip()) > 80:
            return text.strip()
    return None


def generate_deep_explanations(
    db, doc_id: str, section_keys: list[str], model: str | None = None
) -> dict[str, Any]:
    """Fill ``deepExplanation`` for every in-scope concept still missing one.

    Sequential on purpose: a single GPU-resident model is compute-bound, so
    concurrent requests only time-slice the GPU (same reasoning as the quiz
    authoring pass)."""
    if not section_keys:
        return {"explainedNow": 0, "explainFailed": 0}
    rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks "
            "AND (c.deepExplanation == null OR c.deepExplanation == '') "
            "SORT c.sectionKey, c.order "
            "RETURN {key: c._key, name: c.name, kind: c.kind, signal: c.signal, "
            "source: c.source, prereqNames: c.prereqNames}",
            bind_vars={"d": doc_id, "ks": section_keys},
        )
    )
    col = db.collection(CONCEPTS)
    done = failed = 0
    for r in rows:
        text = _explain_one(r, model)
        if text:
            col.update({"_key": r["key"], "deepExplanation": text, "deepExplainedAt": int(time.time())})
            done += 1
        else:
            failed += 1
    return {"explainedNow": done, "explainFailed": failed}


# --------------------------------------------------------------------------- #
# Briefing — assembled, never LLM-fused
# --------------------------------------------------------------------------- #

def build_briefing(db, doc_id: str, scope: str | None, allow_generate: bool = False) -> dict | None:
    """Assemble the chapter briefing from the cached orient/skeleton/concepts.

    ``allow_generate=True`` (the prepare/processing path) lets orient/skeleton
    generate-and-cache on a miss; the GET path passes False so opening a
    chapter never waits on a model. Returns None when nothing is cached yet.
    """
    from app.extraction.skeleton import (
        ORIENT,
        SKELETONS,
        _attach_depths,
        _key as skel_key,
        ensure_path_collections,
        fetch_orient,
        fetch_skeleton,
    )

    ensure_path_collections(db)
    if allow_generate:
        orient = fetch_orient(doc_id, scope)
        skeleton = fetch_skeleton(doc_id, scope)
        sections = skeleton.get("sections") or []
    else:
        orient = db.collection(ORIENT).get(skel_key(doc_id, scope)) or {}
        cached = db.collection(SKELETONS).get(skel_key(doc_id, scope)) or {}
        sections = _attach_depths(db, doc_id, cached.get("sections") or [])

    objectives = orient.get("objectives") or []
    watch_for = orient.get("watchFor") or []
    if not (objectives or watch_for or sections):
        return None

    key_concepts: list[dict[str, Any]] = []
    concept_count = 0
    if scope:
        from app.extraction.concepts_extract import fetch_section_concepts

        rows = fetch_section_concepts(scope, doc_id).get("concepts", [])
        concept_count = len(rows)
        key_concepts = [
            {"name": c.get("name"), "kind": c.get("kind"), "signal": c.get("signal")}
            for c in rows[:10]
        ]

    briefing = {
        "docId": doc_id,
        "scope": scope,
        "objectives": objectives,
        "watchFor": watch_for,
        "sections": sections,
        "keyConcepts": key_concepts,
        "conceptCount": concept_count,
        "createdAt": int(time.time()),
    }
    ensure_deep_collections(db)
    db.collection(BRIEFING).insert({"_key": _bkey(doc_id, scope), **briefing}, overwrite=True)
    return briefing


# --------------------------------------------------------------------------- #
# Orchestrator (eager post-extraction pass) + backfill + status + assembler
# --------------------------------------------------------------------------- #

def generate_deep_chapter_artifacts(
    db, doc_id: str, scope: str | None, section_keys: list[str], model: str | None = None
) -> dict[str, Any]:
    """The eager pass: briefing + per-section recap cache warm + deep explanations.

    Every stage is error-isolated; a failure in one never blocks the others."""
    out: dict[str, Any] = {"docId": doc_id, "scope": scope}
    try:
        out["briefing"] = bool(build_briefing(db, doc_id, scope, allow_generate=True))
    except Exception as exc:  # noqa: BLE001
        out["briefingError"] = str(exc)

    # Warm the per-section recap/objectives cache (rendered as section dividers).
    from app.extraction.augment import section_augment

    warmed = 0
    for sk in section_keys or []:
        try:
            res = section_augment(doc_id, sk)
            if not res.get("cached") and (res.get("objectives") or res.get("recap")):
                warmed += 1
        except Exception:  # noqa: BLE001
            pass
    out["augmentsWarmed"] = warmed

    try:
        out.update(generate_deep_explanations(db, doc_id, section_keys or [], model=model))
    except Exception as exc:  # noqa: BLE001
        out["explainError"] = str(exc)
    return out


def deep_status(db, doc_id: str, scope: str | None, section_keys: list[str]) -> dict[str, Any]:
    """Readiness of the overlay for a scope: explanation coverage + briefing presence."""
    total = explained = 0
    if section_keys:
        total = db.aql.execute(
            "RETURN LENGTH(FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks RETURN 1)",
            bind_vars={"d": doc_id, "ks": section_keys},
        ).next()
        explained = db.aql.execute(
            "RETURN LENGTH(FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks "
            "AND c.deepExplanation != null AND c.deepExplanation != '' RETURN 1)",
            bind_vars={"d": doc_id, "ks": section_keys},
        ).next()
    with _inflight_lock:
        running = f"{doc_id}|{scope or 'ALL'}" in _inflight
    ensure_deep_collections(db)
    has_briefing = db.collection(BRIEFING).get(_bkey(doc_id, scope)) is not None
    return {
        "totalConcepts": total,
        "explained": explained,
        "running": running,
        "briefing": has_briefing,
    }


def fetch_deep_chapter(doc_id: str | None, scope: str) -> dict[str, Any]:
    """One-call assembler for the Deep Chapter surface: briefing + full chapter
    markdown + concepts (with deep explanations) + cached section recaps.

    Reads caches only — never calls the LLM — so it is always fast; ``status``
    tells the client whether a prepare pass would enrich it."""
    try:
        db = connect_arango()
        doc_id = _resolve_doc_id(doc_id)
        if not doc_id:
            return {"error": "no document found"}

        # include_figures: the chapter's captioned figures woven into the prose per section.
        content = fetch_section_content(scope, doc_id, include_figures=True)
        blocks = content.get("blocks", [])
        section_keys = sorted({b.get("sectionKey") for b in blocks if b.get("sectionKey")})

        from app.extraction.concepts_extract import fetch_section_concepts

        sec = fetch_section_concepts(scope, doc_id)
        concepts = sec.get("concepts", [])
        # Attach deepExplanation (fetch_section_concepts' projection omits it).
        keys = [c.get("conceptKey") for c in concepts if c.get("conceptKey")]
        deep_by_key: dict[str, str] = {}
        if keys:
            for r in db.aql.execute(
                "FOR c IN concepts FILTER c._key IN @ks AND c.deepExplanation != null "
                "RETURN {key: c._key, deep: c.deepExplanation}",
                bind_vars={"ks": keys},
            ):
                deep_by_key[r["key"]] = r["deep"]
        for c in concepts:
            c["deepExplanation"] = deep_by_key.get(c.get("conceptKey") or "")

        ensure_deep_collections(db)
        briefing = db.collection(BRIEFING).get(_bkey(doc_id, scope))
        if briefing:
            briefing = {k: v for k, v in briefing.items() if not k.startswith("_")}
        else:
            briefing = build_briefing(db, doc_id, scope, allow_generate=False)

        augments: dict[str, dict[str, Any]] = {}
        if section_keys and db.has_collection("section_augment"):
            for r in db.aql.execute(
                "FOR a IN section_augment FILTER a.docId == @d AND a.sectionKey IN @ks "
                "RETURN {sk: a.sectionKey, objectives: a.objectives, recap: a.recap}",
                bind_vars={"d": doc_id, "ks": section_keys},
            ):
                augments[r["sk"]] = {
                    "objectives": r.get("objectives") or [],
                    "recap": r.get("recap") or "",
                }

        return {
            "docId": doc_id,
            "scope": scope,
            "briefing": briefing,
            "markdown": content.get("markdown", ""),
            "blocks": blocks,
            "concepts": concepts,
            "sections": sec.get("sections", []),
            "augments": augments,
            "pageStart": content.get("pageStart"),
            "pageEnd": content.get("pageEnd"),
            "status": deep_status(db, doc_id, scope, list(section_keys)),
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def _prepare_worker(doc_id: str, scope: str, sig: str) -> None:
    try:
        db = connect_arango()
        generate_deep_chapter_artifacts(db, doc_id, scope, _scope_section_keys(doc_id, scope))
    except Exception:  # noqa: BLE001 — best-effort backfill
        pass
    finally:
        with _inflight_lock:
            _inflight.discard(sig)


def prepare_deep_chapter(doc_id: str | None, scope: str) -> dict[str, Any]:
    """Fire-and-forget backfill of the overlay for an already-processed scope."""
    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    sig = f"{doc_id}|{scope or 'ALL'}"
    with _inflight_lock:
        started = sig not in _inflight
        if started:
            _inflight.add(sig)
    if started:
        threading.Thread(target=_prepare_worker, args=(doc_id, scope, sig), daemon=True).start()
    status = deep_status(db, doc_id, scope, _scope_section_keys(doc_id, scope))
    return {"docId": doc_id, "scope": scope, "started": started, **status, "running": True}
