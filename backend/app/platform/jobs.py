"""The processing ledger + queue — every LLM/GPU generation pass is a persistent job here.

Grew out of the chapter build queue ("build this chapter" = extraction + deep overlay);
now the ONE registry for all artifact kinds, so generation is never a black box: what ran,
what's running, what's queued, how long it took, and why it failed all live in the
``chapter_builds`` collection and survive restarts (a restart re-queues "running" rows).

Kinds and their runners:
  - "build":    concept extraction (skipped when present) + deep overlay (briefing/explanations)
  - "quizzes":  author application questions for the scope's concepts
  - "guides":   author per-section reading guides
  - "skeleton": (re)generate the chapter skeleton essences
  - "orient":   (re)generate the chapter orientation

A single daemon worker drains the queue one job at a time — the GPU is compute-bound, so
concurrent jobs would only time-slice it. ``notBefore`` (epoch seconds, optional) is the
whole scheduling model: "build tonight" is just a job with a future timestamp.
(Audiobooks keep their own checkpointed job system in audiobook.py — hour-long TTS runs
need resumability, not just a ledger row; coverage reports them separately.)
"""

from __future__ import annotations

import asyncio
import hashlib
import threading
import time
from typing import Any

from app.content.arango_content import fetch_latest_document, fetch_section_content
from app.platform.arango import connect_arango

BUILDS = "chapter_builds"
META = "learn_meta"

KINDS = ("build", "quizzes", "guides", "skeleton", "orient")

_worker_lock = threading.Lock()
_worker_started = False


class JobCancelled(Exception):
    """Raised inside a running job when its cancelRequested flag is set —
    unwinds the runner between sections so completed work is kept."""


def ensure_builds_collection(db) -> None:
    if not db.has_collection(BUILDS):
        col = db.create_collection(BUILDS)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["status"])


def ensure_meta_collection(db) -> None:
    if not db.has_collection(META):
        db.create_collection(META)


def queue_paused(db) -> bool:
    try:
        ensure_meta_collection(db)
        row = db.collection(META).get("queue")
        return bool(row and row.get("paused"))
    except Exception:  # noqa: BLE001 — a broken flag must never stall the queue
        return False


def set_queue_paused(paused: bool) -> dict[str, Any]:
    db = connect_arango()
    ensure_meta_collection(db)
    db.collection(META).insert({"_key": "queue", "paused": bool(paused)}, overwrite=True)
    return {"paused": bool(paused)}


def _bkey(doc_id: str, scope: str, kind: str = "build") -> str:
    # "build" keeps the pre-kind key so existing rows stay addressable.
    raw = f"{doc_id}|{scope}" if kind == "build" else f"{doc_id}|{scope}|{kind}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


def _concept_count(db, doc_id: str, section_keys: list[str]) -> int:
    if not section_keys:
        return 0
    return db.aql.execute(
        "RETURN LENGTH(FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks RETURN 1)",
        bind_vars={"d": doc_id, "ks": section_keys},
    ).next()


def _update_job(db, key: str, patch: dict[str, Any]) -> None:
    try:
        db.collection(BUILDS).update({"_key": key, **patch})
    except Exception:  # noqa: BLE001 — progress writes are best-effort
        pass


# --------------------------------------------------------------------------- #
# Queue API
# --------------------------------------------------------------------------- #

def enqueue_build(doc_id: str | None, scope: str, not_before: int | None = None,
                  kind: str = "build") -> dict[str, Any]:
    """Queue a processing job. Re-queuing a queued/running job just returns it;
    re-queuing a finished one starts a fresh run (idempotent underneath)."""
    if kind not in KINDS:
        return {"error": f"unknown kind {kind!r}"}
    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    ensure_builds_collection(db)
    key = _bkey(doc_id, scope, kind)
    existing = db.collection(BUILDS).get(key)
    if existing and existing.get("status") in ("queued", "running"):
        return {k: v for k, v in existing.items() if not k.startswith("_")} | {"already": True}
    job = {
        "_key": key,
        "docId": doc_id,
        "scope": scope,
        "kind": kind,
        "status": "queued",
        "notBefore": int(not_before) if not_before else None,
        "requestedAt": int(time.time()),
        "startedAt": None,
        "finishedAt": None,
        "phase": None,
        "done": 0,
        "total": 0,
        "error": None,
    }
    db.collection(BUILDS).insert(job, overwrite=True)
    ensure_worker()
    return {k: v for k, v in job.items() if not k.startswith("_")}


def cancel_build(doc_id: str | None, scope: str, kind: str = "build") -> dict[str, Any]:
    """Cancel a job. Queued jobs are removed outright. Running jobs get a cooperative
    cancelRequested flag — the runner checks it between sections and stops there, so
    already-completed sections are kept (no GPU work is thrown away mid-section)."""
    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    ensure_builds_collection(db)
    job = db.collection(BUILDS).get(_bkey(doc_id, scope, kind))
    if not job:
        return {"cancelled": False, "reason": "no job"}
    if job.get("status") == "queued":
        db.collection(BUILDS).delete(job["_key"])
        return {"cancelled": True}
    if job.get("status") == "running":
        _update_job(db, job["_key"], {"cancelRequested": True})
        return {"cancelled": False, "cancelling": True}
    return {"cancelled": False, "reason": job.get("status")}


def _check_cancel(db, key: str) -> None:
    """Raise JobCancelled if this job's cancel flag was set. Called at section and
    phase boundaries — the coarsest granularity that never wastes finished work."""
    try:
        row = db.collection(BUILDS).get(key)
    except Exception:  # noqa: BLE001 — a read hiccup must not kill the job
        return
    if row and row.get("cancelRequested"):
        raise JobCancelled()


def list_builds(doc_id: str | None, kind: str | None = "build") -> dict[str, Any]:
    """Jobs for a doc. Default keeps the original contract (chapter builds only, for the
    course-home chip); ``kind=None`` returns every kind — the ledger view."""
    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    ensure_builds_collection(db)
    rows = list(
        db.aql.execute(
            "FOR b IN @@col FILTER b.docId == @d "
            "AND (@k == null OR b.kind == @k OR (@k == 'build' AND b.kind == null)) "
            "SORT b.requestedAt RETURN UNSET(b, '_id', '_rev')",
            bind_vars={"@col": BUILDS, "d": doc_id, "k": kind},
        )
    )
    for r in rows:
        r["key"] = r.pop("_key", None)
        r.setdefault("kind", "build")  # pre-kind rows
    return {"docId": doc_id, "builds": rows}


def chapters_readiness(doc_id: str | None, scopes: list[str]) -> dict[str, Any]:
    """Readiness ladder per chapter: concept coverage + deep coverage + any build job.
    Loads the doc's section blocks ONCE and spans each scope over them."""
    from app.extraction.deep_chapter import BRIEFING, _bkey as briefing_key, ensure_deep_collections
    from app.extraction.extract import _blocks_in_scope, _section_level_fn

    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    ensure_builds_collection(db)
    ensure_deep_collections(db)

    rows = list(
        db.aql.execute(
            "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
            bind_vars={"d": doc_id},
        )
    )
    level_of = _section_level_fn(db, doc_id)
    jobs = {j["scope"]: j for j in list_builds(doc_id).get("builds", [])}

    out: dict[str, Any] = {}
    for scope in scopes:
        keys = sorted({b.get("sectionKey") for b in _blocks_in_scope(rows, scope, level_of) if b.get("sectionKey")})
        concepts = _concept_count(db, doc_id, list(keys))
        explained = 0
        if keys:
            explained = db.aql.execute(
                "RETURN LENGTH(FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks "
                "AND c.deepExplanation != null AND c.deepExplanation != '' RETURN 1)",
                bind_vars={"d": doc_id, "ks": list(keys)},
            ).next()
        briefing = db.collection(BRIEFING).get(briefing_key(doc_id, scope)) is not None
        job = jobs.get(scope)
        out[scope] = {
            "concepts": concepts,
            "explained": explained,
            "briefing": briefing,
            "build": {
                "status": job.get("status"),
                "notBefore": job.get("notBefore"),
                "phase": job.get("phase"),
                "done": job.get("done"),
                "total": job.get("total"),
                "error": job.get("error"),
            }
            if job
            else None,
        }
    return {"docId": doc_id, "chapters": out}


def chapters_coverage(doc_id: str | None) -> dict[str, Any]:
    """The black-box killer: every chapter × every artifact kind, with its state.

    Per chapter: concept count, quiz-authoring x/y, skeleton fresh/stale/missing,
    orient/briefing presence, guide x/y, generated audiobook sources, and any
    queued/running/failed job per kind. One call answers "what state is my library in"."""
    import os

    from app.media.audiobook import audiobook_path, timeline_path
    from app.study.concept_quiz_llm import scope_question_status
    from app.extraction.deep_chapter import BRIEFING, _bkey as briefing_key, ensure_deep_collections
    from app.extraction.extract import _blocks_in_scope, _scope_keys_from_outline, _section_level_fn
    from app.extraction.reading_guide import guide_status
    from app.extraction.skeleton import (
        ORIENT,
        SKELETON_PROMPT_VERSION,
        SKELETONS,
        _key as chapter_cache_key,
        ensure_path_collections,
    )

    db = connect_arango()
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    ensure_builds_collection(db)
    ensure_deep_collections(db)
    ensure_path_collections(db)

    doc_row = db.collection("documents").get(doc_id) or {}
    top = [e for e in (doc_row.get("outline") or []) if (e.get("listDepth") or 0) == 0]
    numbered = [e for e in top if e.get("numberKey")]
    chapter_entries = [e for e in (numbered or top) if e.get("sectionKey")]

    blocks = list(
        db.aql.execute(
            "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
            bind_vars={"d": doc_id},
        )
    )
    level_of = _section_level_fn(db, doc_id)
    jobs_by = {
        (j["scope"], j.get("kind") or "build"): j
        for j in list_builds(doc_id, kind=None).get("builds", [])
    }

    def job_state(scope: str, kind: str) -> dict[str, Any] | None:
        j = jobs_by.get((scope, kind))
        if not j:
            return None
        return {k: j.get(k) for k in ("status", "notBefore", "phase", "done", "total", "error")}

    block_keys = {b.get("sectionKey") for b in blocks if b.get("sectionKey")}

    chapters: list[dict[str, Any]] = []
    for e in chapter_entries:
        scope = e["sectionKey"]
        # Outline nesting first — it bridges mixed keyspaces (numbered chapter toc:2 whose
        # sub-sections carry slug keys); reading-order span is the fallback. Same resolution
        # order as fetch_section_content, so the grid can't disagree with the reader.
        okeys = _scope_keys_from_outline(db, doc_id, scope)
        keys = sorted((okeys & block_keys) if okeys else set())
        if not keys:
            keys = sorted({b.get("sectionKey") for b in _blocks_in_scope(blocks, scope, level_of) if b.get("sectionKey")})
        skel_row = db.collection(SKELETONS).get(chapter_cache_key(doc_id, scope))
        skeleton = (
            "missing" if not (skel_row and skel_row.get("sections"))
            else ("fresh" if skel_row.get("promptVersion") == SKELETON_PROMPT_VERSION else "stale")
        )
        orient_row = db.collection(ORIENT).get(chapter_cache_key(doc_id, scope))
        quiz = scope_question_status(db, doc_id, set(keys)) if keys else {"total": 0, "authored": 0, "running": False}
        chapters.append(
            {
                "scope": scope,
                "title": e.get("title") or scope,
                "sections": len(keys),
                "concepts": _concept_count(db, doc_id, keys),
                "quizzes": {"authored": quiz["authored"], "total": quiz["total"]},
                "skeleton": skeleton,
                "orient": bool(orient_row and (orient_row.get("objectives") or orient_row.get("watchFor"))),
                "briefing": db.collection(BRIEFING).get(briefing_key(doc_id, scope)) is not None,
                "guides": {k: v for k, v in guide_status(db, doc_id, scope).items() if k != "running"},
                "audiobooks": [
                    src for src in ("text", "guided", "concepts")
                    if os.path.exists(audiobook_path(doc_id, scope, src))
                ],
                "readAlong": os.path.exists(timeline_path(doc_id, scope, "text")),
                "jobs": {k: js for k in KINDS if (js := job_state(scope, k))},
            }
        )
    return {"docId": doc_id, "chapters": chapters}


def queue_summary() -> dict[str, Any]:
    """Live queue state across ALL documents — powers the Process tab's machine strip.
    One running job max (single worker), so `running` is a row, not a list."""
    db = connect_arango()
    ensure_builds_collection(db)
    now = int(time.time())
    rows = list(
        db.aql.execute(
            "FOR b IN @@col FILTER b.status IN ['queued','running'] RETURN "
            "{status: b.status, notBefore: b.notBefore, docId: b.docId, scope: b.scope, "
            "kind: b.kind, phase: b.phase, done: b.done, total: b.total, "
            "startedAt: b.startedAt, cancelRequested: b.cancelRequested}",
            bind_vars={"@col": BUILDS},
        )
    )
    running = next((r for r in rows if r["status"] == "running"), None)
    scheduled = [r for r in rows if r["status"] == "queued" and r.get("notBefore") and r["notBefore"] > now]
    queued = [r for r in rows if r["status"] == "queued" and r not in scheduled]
    if running:
        running["kind"] = running.get("kind") or "build"
        try:
            doc_row = db.collection("documents").get(running["docId"]) or {}
            running["docTitle"] = doc_row.get("title")
            for e in doc_row.get("outline") or []:
                if e.get("sectionKey") == running["scope"]:
                    running["chapterTitle"] = e.get("title")
                    break
        except Exception:  # noqa: BLE001 — titles are cosmetic
            pass
    return {
        "paused": queue_paused(db),
        "running": running,
        "queuedCount": len(queued),
        "scheduledCount": len(scheduled),
        "nextScheduledAt": min((r["notBefore"] for r in scheduled), default=None),
    }


# --------------------------------------------------------------------------- #
# Worker
# --------------------------------------------------------------------------- #

def ensure_worker() -> None:
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True
    threading.Thread(target=_worker_loop, daemon=True, name="chapter-build-worker").start()


def _next_job(db) -> dict[str, Any] | None:
    now = int(time.time())
    rows = list(
        db.aql.execute(
            "FOR b IN @@col FILTER b.status == 'queued' AND (b.notBefore == null OR b.notBefore <= @now) "
            "SORT b.requestedAt LIMIT 1 RETURN b",
            bind_vars={"@col": BUILDS, "now": now},
        )
    )
    return rows[0] if rows else None


def _worker_loop() -> None:
    # Recover jobs a restart left as "running" — mark them queued so they retry.
    try:
        db = connect_arango()
        ensure_builds_collection(db)
        db.aql.execute(
            "FOR b IN @@col FILTER b.status == 'running' UPDATE b WITH {status: 'queued'} IN @@col",
            bind_vars={"@col": BUILDS},
        )
    except Exception:  # noqa: BLE001
        pass
    while True:
        try:
            db = connect_arango()
            ensure_builds_collection(db)
            if queue_paused(db):
                time.sleep(10)
                continue
            job = _next_job(db)
            if not job:
                time.sleep(20)
                continue
            _dispatch(db, job)
        except Exception:  # noqa: BLE001 — the worker must never die
            time.sleep(20)


def _progress_writer(db, key: str, phase: str):
    """Throttled progress callback bound to one job row."""
    last_write = 0.0

    def on_progress(done: int, total: int, current: str | None = None) -> None:
        nonlocal last_write
        now = time.time()
        if now - last_write < 5 and done < total:
            return
        last_write = now
        _check_cancel(db, key)
        _update_job(db, key, {"phase": phase, "done": done, "total": total})

    return on_progress


def _dispatch(db, job: dict[str, Any]) -> None:
    """Run one job by kind, bracketing it with honest ledger writes."""
    key, kind = job["_key"], job.get("kind") or "build"
    if kind == "build":
        _run_build(db, job)
        return
    doc_id, scope = job["docId"], job["scope"]
    _update_job(db, key, {"status": "running", "startedAt": int(time.time()), "error": None})
    try:
        receipt: dict[str, Any]
        if kind == "quizzes":
            from app.study.concept_quiz_llm import author_scope_sync
            from app.api.concept_study_routes import _scope_section_keys

            keys = sorted(_scope_section_keys(db, doc_id, scope) or {scope})
            receipt = author_scope_sync(db, doc_id, keys, on_progress=_progress_writer(db, key, kind))
        elif kind == "guides":
            from app.extraction.reading_guide import author_guides_sync

            receipt = author_guides_sync(db, doc_id, scope, on_progress=_progress_writer(db, key, kind))
        elif kind == "skeleton":
            from app.extraction.skeleton import refresh_skeleton

            receipt = refresh_skeleton(db, doc_id, scope)
        elif kind == "orient":
            from app.extraction.skeleton import refresh_orient

            receipt = refresh_orient(db, doc_id, scope)
        else:
            _update_job(db, key, {"status": "error", "finishedAt": int(time.time()),
                                  "error": f"unknown kind {kind!r}"})
            return
        if receipt.get("error"):
            _update_job(db, key, {"status": "error", "finishedAt": int(time.time()),
                                  "error": str(receipt["error"])})
            return
        _update_job(db, key, {"status": "done", "finishedAt": int(time.time()),
                              "phase": None, "receipt": receipt})
    except JobCancelled:
        _update_job(db, key, {"status": "canceled", "finishedAt": int(time.time()),
                              "phase": None, "cancelRequested": None})
    except Exception as exc:  # noqa: BLE001
        _update_job(db, key, {"status": "error", "finishedAt": int(time.time()), "error": str(exc)})


def _run_build(db, job: dict[str, Any]) -> None:
    from app.extraction.concepts_extract import extract_concepts_document
    from app.extraction.deep_chapter import generate_deep_chapter_artifacts

    key, doc_id, scope = job["_key"], job["docId"], job["scope"]
    _update_job(db, key, {"status": "running", "startedAt": int(time.time()), "error": None})
    try:
        content = fetch_section_content(scope, doc_id)
        section_keys = sorted(
            {b.get("sectionKey") for b in content.get("blocks", []) if b.get("sectionKey")}
        )
        if not section_keys:
            _update_job(db, key, {"status": "error", "finishedAt": int(time.time()),
                                  "error": "no readable content in this scope"})
            return

        if _concept_count(db, doc_id, list(section_keys)) > 0:
            # Already extracted — go straight to the deep overlay (briefing + explanations).
            _check_cancel(db, key)
            _update_job(db, key, {"phase": "deep", "done": 0, "total": 0})
            generate_deep_chapter_artifacts(db, doc_id, scope, list(section_keys))
            _update_job(db, key, {"outcomes": None})
        else:
            # Extraction; its eager hook generates the deep overlay in the same pass.
            last_write = 0.0

            def on_progress(done: int, total: int, current: str | None) -> None:
                nonlocal last_write
                now = time.time()
                if now - last_write < 5 and done < total:
                    return
                last_write = now
                _check_cancel(db, key)
                _update_job(db, key, {"phase": "extract", "done": done, "total": total})

            res = asyncio.run(
                extract_concepts_document(doc_id=doc_id, scope=scope, on_progress=on_progress)
            )
            if res.get("error"):
                _update_job(db, key, {"status": "error", "finishedAt": int(time.time()),
                                      "error": str(res["error"])})
                return
            # Persist the per-section extraction report on the job so the Process
            # dashboard can show WHY sections produced 0 concepts (capped for sanity).
            _update_job(db, key, {
                "outcomes": (res.get("outcomes") or [])[:200],
                "concepts": res.get("concepts"),
                "prereqEdges": res.get("prereqEdges"),
            })

        _update_job(db, key, {"status": "done", "finishedAt": int(time.time()), "phase": None})
    except JobCancelled:
        _update_job(db, key, {"status": "canceled", "finishedAt": int(time.time()),
                              "phase": None, "cancelRequested": None})
    except Exception as exc:  # noqa: BLE001
        _update_job(db, key, {"status": "error", "finishedAt": int(time.time()), "error": str(exc)})
