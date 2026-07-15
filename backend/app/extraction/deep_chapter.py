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

from app.content.documents import fetch_latest_document
from app.content.store import fetch_section_content
from psycopg.types.json import Json

from app.platform.db import db
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
    "it in the text. You are given the concept's name, kind, a one-line signal, and the "
    "verbatim source passage. Write 1-2 short paragraphs of "
    "plain prose that: state what the concept is in the learner's own terms, unpack how it "
    "works or why it holds, and say when or why it matters. Ground every claim in the source passage — never invent "
    "facts, numbers, or scope beyond it. No headings, no bullet points, no 'the author' or "
    "'this section' — output only the explanation prose."
)


def _explain_one(concept: dict[str, Any], model: str | None = None) -> str | None:
    user = (
        f"Concept: {concept.get('name')}\n"
        f"Kind: {concept.get('kind')}\n"
        f"Signal: {concept.get('signal')}\n"
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
    doc_id: str, section_keys: list[str], model: str | None = None
) -> dict[str, Any]:
    """Fill ``deepExplanation`` for every in-scope concept still missing one.

    Sequential on purpose: a single GPU-resident model is compute-bound, so
    concurrent requests only time-slice the GPU (same reasoning as the quiz
    authoring pass)."""
    if not section_keys:
        return {"explainedNow": 0, "explainFailed": 0}
    with db() as conn:
        rows = conn.execute(
            "SELECT key, name, kind, signal, source FROM concepts "
            "WHERE doc_id = %(d)s AND section_key = ANY(%(ks)s::text[]) "
            "AND (deep_explanation IS NULL OR deep_explanation = '') "
            'ORDER BY section_key, "order"',
            {"d": doc_id, "ks": section_keys},
        ).fetchall()
    done = failed = 0
    for r in rows:
        text = _explain_one(r, model)
        if text:
            with db() as conn:
                conn.execute(
                    "UPDATE concepts SET deep_explanation = %(t)s, deep_explained_at = now() WHERE key = %(k)s",
                    {"t": text, "k": r["key"]},
                )
            done += 1
        else:
            failed += 1
    return {"explainedNow": done, "explainFailed": failed}


# --------------------------------------------------------------------------- #
# Briefing — assembled, never LLM-fused
# --------------------------------------------------------------------------- #

def build_briefing(doc_id: str, scope: str | None, allow_generate: bool = False) -> dict | None:
    """Assemble the chapter briefing from the cached orient/skeleton/concepts.

    ``allow_generate=True`` (the prepare/processing path) lets orient/skeleton
    generate-and-cache on a miss; the GET path passes False so opening a
    chapter never waits on a model. Returns None when nothing is cached yet.
    """
    from app.extraction.skeleton import (
        _attach_depths,
        _key as skel_key,
        fetch_orient,
        fetch_skeleton,
    )

    if allow_generate:
        orient = fetch_orient(doc_id, scope)
        skeleton = fetch_skeleton(doc_id, scope)
        sections = skeleton.get("sections") or []
    else:
        with db() as conn:
            orient = conn.execute(
                'SELECT objectives, watch_for AS "watchFor" FROM chapter_orient WHERE key = %(k)s',
                {"k": skel_key(doc_id, scope)},
            ).fetchone() or {}
            cached = conn.execute(
                "SELECT sections FROM chapter_skeletons WHERE key = %(k)s",
                {"k": skel_key(doc_id, scope)},
            ).fetchone() or {}
        sections = _attach_depths(doc_id, cached.get("sections") or [])

    objectives = orient.get("objectives") or []
    watch_for = orient.get("watchFor") or []
    if not (objectives or watch_for or sections):
        return None

    key_concepts: list[dict[str, Any]] = []
    concept_count = 0
    if scope:
        from app.extraction.concept_store import fetch_section_concepts

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
    with db() as conn:
        conn.execute(
            "INSERT INTO deep_chapter_briefing (key, doc_id, scope, objectives, watch_for, sections, "
            "key_concepts, concept_count, created_at) VALUES "
            "(%(k)s,%(d)s,%(sc)s,%(obj)s,%(wf)s,%(sec)s,%(kc)s,%(cc)s, now()) "
            "ON CONFLICT (key) DO UPDATE SET doc_id=EXCLUDED.doc_id, scope=EXCLUDED.scope, "
            "objectives=EXCLUDED.objectives, watch_for=EXCLUDED.watch_for, sections=EXCLUDED.sections, "
            "key_concepts=EXCLUDED.key_concepts, concept_count=EXCLUDED.concept_count, created_at=EXCLUDED.created_at",
            {"k": _bkey(doc_id, scope), "d": doc_id, "sc": scope, "obj": Json(objectives),
             "wf": Json(watch_for), "sec": Json(sections), "kc": Json(key_concepts), "cc": concept_count},
        )
    return briefing


# --------------------------------------------------------------------------- #
# Orchestrator (eager post-extraction pass) + backfill + status + assembler
# --------------------------------------------------------------------------- #

def generate_deep_chapter_artifacts(
    doc_id: str, scope: str | None, section_keys: list[str], model: str | None = None
) -> dict[str, Any]:
    """The eager pass: briefing + per-section recap cache warm + deep explanations.

    Every stage is error-isolated; a failure in one never blocks the others."""
    out: dict[str, Any] = {"docId": doc_id, "scope": scope}
    try:
        out["briefing"] = bool(build_briefing(doc_id, scope, allow_generate=True))
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
        out.update(generate_deep_explanations(doc_id, section_keys or [], model=model))
    except Exception as exc:  # noqa: BLE001
        out["explainError"] = str(exc)
    return out


def deep_status(doc_id: str, scope: str | None, section_keys: list[str]) -> dict[str, Any]:
    """Readiness of the overlay for a scope: explanation coverage + briefing presence."""
    total = explained = 0
    with db() as conn:
        if section_keys:
            total = conn.execute(
                "SELECT count(*) AS n FROM concepts WHERE doc_id = %(d)s AND section_key = ANY(%(ks)s::text[])",
                {"d": doc_id, "ks": section_keys},
            ).fetchone()["n"]
            explained = conn.execute(
                "SELECT count(*) AS n FROM concepts WHERE doc_id = %(d)s AND section_key = ANY(%(ks)s::text[]) "
                "AND deep_explanation IS NOT NULL AND deep_explanation <> ''",
                {"d": doc_id, "ks": section_keys},
            ).fetchone()["n"]
        has_briefing = conn.execute(
            "SELECT 1 FROM deep_chapter_briefing WHERE key = %(k)s", {"k": _bkey(doc_id, scope)}
        ).fetchone() is not None
    with _inflight_lock:
        running = f"{doc_id}|{scope or 'ALL'}" in _inflight
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
        doc_id = _resolve_doc_id(doc_id)
        if not doc_id:
            return {"error": "no document found"}

        # include_figures: the chapter's captioned figures woven into the prose per section.
        content = fetch_section_content(scope, doc_id, include_figures=True)
        blocks = content.get("blocks", [])
        section_keys = sorted({b.get("sectionKey") for b in blocks if b.get("sectionKey")})

        from app.extraction.concept_store import fetch_section_concepts

        sec = fetch_section_concepts(scope, doc_id)
        concepts = sec.get("concepts", [])
        # Attach deepExplanation (fetch_section_concepts' projection omits it).
        keys = [c.get("conceptKey") for c in concepts if c.get("conceptKey")]
        deep_by_key: dict[str, str] = {}
        if keys:
            with db() as conn:
                for r in conn.execute(
                    "SELECT key, deep_explanation AS deep FROM concepts "
                    "WHERE key = ANY(%(ks)s::text[]) AND deep_explanation IS NOT NULL",
                    {"ks": keys},
                ).fetchall():
                    deep_by_key[r["key"]] = r["deep"]
        for c in concepts:
            c["deepExplanation"] = deep_by_key.get(c.get("conceptKey") or "")

        with db() as conn:
            briefing = conn.execute(
                'SELECT doc_id AS "docId", scope, objectives, watch_for AS "watchFor", sections, '
                'key_concepts AS "keyConcepts", concept_count AS "conceptCount" '
                "FROM deep_chapter_briefing WHERE key = %(k)s",
                {"k": _bkey(doc_id, scope)},
            ).fetchone()
        if not briefing:
            briefing = build_briefing(doc_id, scope, allow_generate=False)

        augments: dict[str, dict[str, Any]] = {}
        if section_keys:
            with db() as conn:
                for r in conn.execute(
                    "SELECT section_key AS sk, objectives, recap FROM section_augment "
                    "WHERE doc_id = %(d)s AND section_key = ANY(%(ks)s::text[])",
                    {"d": doc_id, "ks": section_keys},
                ).fetchall():
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
            "status": deep_status(doc_id, scope, list(section_keys)),
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def _prepare_worker(doc_id: str, scope: str, sig: str) -> None:
    try:
        generate_deep_chapter_artifacts(doc_id, scope, _scope_section_keys(doc_id, scope))
    except Exception:  # noqa: BLE001 — best-effort backfill
        pass
    finally:
        with _inflight_lock:
            _inflight.discard(sig)


def prepare_deep_chapter(doc_id: str | None, scope: str) -> dict[str, Any]:
    """Fire-and-forget backfill of the overlay for an already-processed scope."""
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
    status = deep_status(doc_id, scope, _scope_section_keys(doc_id, scope))
    return {"docId": doc_id, "scope": scope, "started": started, **status, "running": True}
