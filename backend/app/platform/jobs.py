"""The processing ledger + queue — every LLM/GPU generation pass is a persistent job here.

Grew out of the chapter build queue ("build this chapter" = extraction + deep overlay);
now the ONE registry for all artifact kinds, so generation is never a black box: what ran,
what's running, what's queued, how long it took, and why it failed all live in the
``chapter_builds`` collection and survive restarts (a restart re-queues "running" rows).

This module is pure mechanics: ledger CRUD, the single daemon worker, and a runner
registry. It knows nothing about the domains — each kind's runner (and the "latest
document" resolver) is registered at startup by the composition root (``pipeline/registry.py``),
so domains can enqueue jobs without the queue importing them back.

A single daemon worker drains the queue one job at a time — the GPU is compute-bound, so
concurrent jobs would only time-slice it. ``notBefore`` (epoch seconds, optional) is the
whole scheduling model: "build tonight" is just a job with a future timestamp.
(Audiobooks keep their own checkpointed job system in media/audiobook.py — hour-long TTS
runs need resumability, not just a ledger row; coverage reports them separately.)
"""

from __future__ import annotations

import hashlib
import threading
import time
from typing import Any, Callable

from app.platform.arango import connect_arango

BUILDS = "chapter_builds"
META = "learn_meta"

KINDS = ("build", "extract", "deep", "quizzes", "guides", "skeleton", "orient")

_worker_lock = threading.Lock()
_worker_started = False

# Registered by pipeline/registry.py at startup: kind -> runner(db, job, ctx) -> receipt | None,
# plus the "no doc id given" resolver. The queue never imports domain modules.
_RUNNERS: dict[str, Callable[[Any, dict[str, Any], "JobCtx"], dict[str, Any] | None]] = {}
_doc_resolver: Callable[[], str | None] | None = None


def register_runner(kind: str, fn: Callable[[Any, dict[str, Any], "JobCtx"], dict[str, Any] | None]) -> None:
    _RUNNERS[kind] = fn


def set_doc_resolver(fn: Callable[[], str | None]) -> None:
    global _doc_resolver
    _doc_resolver = fn


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
    return _doc_resolver() if _doc_resolver else None


def _update_job(db, key: str, patch: dict[str, Any]) -> None:
    try:
        db.collection(BUILDS).update({"_key": key, **patch})
    except Exception:  # noqa: BLE001 — progress writes are best-effort
        pass


class JobCtx:
    """What a runner may do to its own ledger row: report progress (throttled),
    honor cancellation, and patch extra fields (e.g. extraction outcomes)."""

    def __init__(self, db, key: str, kind: str) -> None:
        self._db = db
        self._key = key
        self.phase = kind
        self._last_write = 0.0

    def check_cancel(self) -> None:
        _check_cancel(self._db, self._key)

    def patch(self, fields: dict[str, Any]) -> None:
        _update_job(self._db, self._key, fields)

    def progress(self, done: int, total: int, current: str | None = None) -> None:
        now = time.time()
        if now - self._last_write < 5 and done < total:
            return
        self._last_write = now
        self.check_cancel()
        self.patch({"phase": self.phase, "done": done, "total": total})


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


def _dispatch(db, job: dict[str, Any]) -> None:
    """Run one job via its registered runner, bracketing it with honest ledger writes.
    A runner returns a receipt dict (persisted on the row), ``{"error": ...}`` for a
    failure, or None for kinds whose results live elsewhere (build writes its own
    fields via ctx.patch)."""
    key, kind = job["_key"], job.get("kind") or "build"
    runner = _RUNNERS.get(kind)
    if runner is None:
        _update_job(db, key, {"status": "error", "finishedAt": int(time.time()),
                              "error": f"unknown kind {kind!r}"})
        return
    _update_job(db, key, {"status": "running", "startedAt": int(time.time()), "error": None})
    try:
        receipt = runner(db, job, JobCtx(db, key, kind))
        if isinstance(receipt, dict) and receipt.get("error"):
            _update_job(db, key, {"status": "error", "finishedAt": int(time.time()),
                                  "error": str(receipt["error"])})
            return
        patch: dict[str, Any] = {"status": "done", "finishedAt": int(time.time()), "phase": None}
        if isinstance(receipt, dict):
            patch["receipt"] = receipt
        _update_job(db, key, patch)
    except JobCancelled:
        _update_job(db, key, {"status": "canceled", "finishedAt": int(time.time()),
                              "phase": None, "cancelRequested": None})
    except Exception as exc:  # noqa: BLE001
        _update_job(db, key, {"status": "error", "finishedAt": int(time.time()), "error": str(exc)})
