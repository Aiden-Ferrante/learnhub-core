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

from psycopg.types.json import Json

from app.platform.db import db

BUILDS = "chapter_builds"
META = "learn_meta"

# camelCase job field -> chapter_builds column. Everything NOT here (receipt, sectionKeys,
# extraction outcomes, …) is schemaless and lives in the ``payload`` jsonb column.
_CONTROL_COLS: dict[str, str] = {
    "docId": "doc_id", "scope": "scope", "kind": "kind", "status": "status",
    "phase": "phase", "done": "done", "total": "total", "error": "error",
    "cancelRequested": "cancel_requested", "notBefore": "not_before",
    "requestedAt": "requested_at", "startedAt": "started_at", "finishedAt": "finished_at",
}


def _row_to_job(row: dict[str, Any]) -> dict[str, Any]:
    """Flatten a chapter_builds row (control columns + payload jsonb) back into the
    camelCase, schemaless dict shape callers and the frontend expect."""
    job: dict[str, Any] = dict(row.get("payload") or {})  # schemaless fields, lowest priority
    job.update({
        "key": row.get("key"),
        "docId": row.get("doc_id"),
        "scope": row.get("scope"),
        "kind": row.get("kind") or "build",
        "status": row.get("status"),
        "phase": row.get("phase"),
        "done": row.get("done"),
        "total": row.get("total"),
        "error": row.get("error"),
        "cancelRequested": row.get("cancel_requested"),
        "notBefore": row.get("not_before"),
        "requestedAt": row.get("requested_at"),
        "startedAt": row.get("started_at"),
        "finishedAt": row.get("finished_at"),
    })
    return job

KINDS = ("convert", "build", "extract", "quizzes", "guides", "skeleton", "orient", "audiobook")

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


def queue_paused() -> bool:
    try:
        with db() as conn:
            row = conn.execute(
                f"SELECT paused FROM {META} WHERE key = 'queue'"
            ).fetchone()
        return bool(row and row.get("paused"))
    except Exception:  # noqa: BLE001 — a broken flag must never stall the queue
        return False


def set_queue_paused(paused: bool) -> dict[str, Any]:
    with db() as conn:
        conn.execute(
            f"INSERT INTO {META} (key, paused) VALUES ('queue', %(p)s) "
            "ON CONFLICT (key) DO UPDATE SET paused = EXCLUDED.paused",
            {"p": bool(paused)},
        )
    return {"paused": bool(paused)}


def _bkey(doc_id: str, scope: str, kind: str = "build") -> str:
    # "build" keeps the pre-kind key so existing rows stay addressable.
    raw = f"{doc_id}|{scope}" if kind == "build" else f"{doc_id}|{scope}|{kind}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    return _doc_resolver() if _doc_resolver else None


def _update_job(key: str, patch: dict[str, Any]) -> None:
    """Best-effort partial update. Known control fields write to their columns; anything
    else is merged into the ``payload`` jsonb (so schemaless outcomes/receipts persist)."""
    sets: list[str] = []
    params: dict[str, Any] = {"key": key}
    extra: dict[str, Any] = {}
    for k, v in patch.items():
        col = _CONTROL_COLS.get(k)
        if col:
            sets.append(f'"{col}" = %({col})s')
            params[col] = v
        else:
            extra[k] = v
    try:
        with db() as conn:
            if sets:
                conn.execute(
                    f'UPDATE {BUILDS} SET {", ".join(sets)} WHERE key = %(key)s', params
                )
            if extra:
                conn.execute(
                    f"UPDATE {BUILDS} SET payload = COALESCE(payload, '{{}}'::jsonb) "
                    "|| %(extra)s::jsonb WHERE key = %(key)s",
                    {"key": key, "extra": Json(extra)},
                )
    except Exception:  # noqa: BLE001 — progress writes are best-effort
        pass


class JobCtx:
    """What a runner may do to its own ledger row: report progress (throttled),
    honor cancellation, and patch extra fields (e.g. extraction outcomes)."""

    def __init__(self, key: str, kind: str) -> None:
        self._key = key
        self.phase = kind
        self._last_write = 0.0

    def check_cancel(self) -> None:
        _check_cancel(self._key)

    def patch(self, fields: dict[str, Any]) -> None:
        _update_job(self._key, fields)

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
                  kind: str = "build", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Queue a processing job. Re-queuing a queued/running job just returns it;
    re-queuing a finished one starts a fresh run (idempotent underneath).

    ``payload`` carries kind-specific inputs onto the job row (e.g. ``sectionKeys`` /
    ``model`` / ``force`` for extraction); it never overrides the control fields."""
    if kind not in KINDS:
        return {"error": f"unknown kind {kind!r}"}
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    key = _bkey(doc_id, scope, kind)
    with db() as conn:
        existing = conn.execute(
            f"SELECT * FROM {BUILDS} WHERE key = %(k)s", {"k": key}
        ).fetchone()
        if existing and existing.get("status") in ("queued", "running"):
            return _row_to_job(existing) | {"already": True}
        row = {
            "key": key,
            "doc_id": doc_id,
            "scope": scope,
            "kind": kind,
            "status": "queued",
            "not_before": int(not_before) if not_before else None,
            "requested_at": int(time.time()),
            "started_at": None,
            "finished_at": None,
            "phase": None,
            "done": 0,
            "total": 0,
            "error": None,
            "cancel_requested": None,
            "payload": Json(payload or {}),  # extra inputs only; never clobber control fields
        }
        conn.execute(
            f"INSERT INTO {BUILDS} (key, doc_id, scope, kind, status, not_before, requested_at, "
            "started_at, finished_at, phase, done, total, error, cancel_requested, payload) "
            "VALUES (%(key)s, %(doc_id)s, %(scope)s, %(kind)s, %(status)s, %(not_before)s, "
            "%(requested_at)s, %(started_at)s, %(finished_at)s, %(phase)s, %(done)s, %(total)s, "
            "%(error)s, %(cancel_requested)s, %(payload)s) "
            "ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, kind = EXCLUDED.kind, "
            "not_before = EXCLUDED.not_before, requested_at = EXCLUDED.requested_at, "
            "started_at = NULL, finished_at = NULL, phase = NULL, done = 0, total = 0, "
            "error = NULL, cancel_requested = NULL, payload = EXCLUDED.payload",
            row,
        )
    ensure_worker()
    return _row_to_job({**row, "payload": payload or {}})


def cancel_build(doc_id: str | None, scope: str, kind: str = "build") -> dict[str, Any]:
    """Cancel a job. Queued jobs are removed outright. Running jobs get a cooperative
    cancelRequested flag — the runner checks it between sections and stops there, so
    already-completed sections are kept (no GPU work is thrown away mid-section)."""
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    key = _bkey(doc_id, scope, kind)
    with db() as conn:
        job = conn.execute(
            f"SELECT key, status FROM {BUILDS} WHERE key = %(k)s", {"k": key}
        ).fetchone()
        if not job:
            return {"cancelled": False, "reason": "no job"}
        if job.get("status") == "queued":
            conn.execute(f"DELETE FROM {BUILDS} WHERE key = %(k)s", {"k": key})
            return {"cancelled": True}
    if job.get("status") == "running":
        _update_job(key, {"cancelRequested": True})
        return {"cancelled": False, "cancelling": True}
    return {"cancelled": False, "reason": job.get("status")}


def _check_cancel(key: str) -> None:
    """Raise JobCancelled if this job's cancel flag was set. Called at section and
    phase boundaries — the coarsest granularity that never wastes finished work."""
    try:
        with db() as conn:
            row = conn.execute(
                f"SELECT cancel_requested FROM {BUILDS} WHERE key = %(k)s", {"k": key}
            ).fetchone()
    except Exception:  # noqa: BLE001 — a read hiccup must not kill the job
        return
    if row and row.get("cancel_requested"):
        raise JobCancelled()


def list_builds(doc_id: str | None, kind: str | None = "build") -> dict[str, Any]:
    """Jobs for a doc. Default keeps the original contract (chapter builds only, for the
    course-home chip); ``kind=None`` returns every kind — the ledger view."""
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    with db() as conn:
        rows = conn.execute(
            f"SELECT * FROM {BUILDS} WHERE doc_id = %(d)s "
            "AND (%(k)s::text IS NULL OR kind = %(k)s OR (%(k)s = 'build' AND kind IS NULL)) "
            "ORDER BY requested_at",
            {"d": doc_id, "k": kind},
        ).fetchall()
    return {"docId": doc_id, "builds": [_row_to_job(r) for r in rows]}


def queue_summary() -> dict[str, Any]:
    """Live queue state across ALL documents — powers the Process tab's machine strip.
    One running job max (single worker), so `running` is a row, not a list."""
    now = int(time.time())
    with db() as conn:
        rows = [
            _row_to_job(r)
            for r in conn.execute(
                f"SELECT * FROM {BUILDS} WHERE status IN ('queued', 'running')"
            ).fetchall()
        ]
    running = next((r for r in rows if r["status"] == "running"), None)
    scheduled = [r for r in rows if r["status"] == "queued" and r.get("notBefore") and r["notBefore"] > now]
    queued = [r for r in rows if r["status"] == "queued" and r not in scheduled]
    if running:
        running["kind"] = running.get("kind") or "build"
        try:
            with db() as conn:
                doc_row = conn.execute(
                    "SELECT title, outline FROM documents WHERE key = %(d)s",
                    {"d": running["docId"]},
                ).fetchone() or {}
            running["docTitle"] = doc_row.get("title")
            for e in doc_row.get("outline") or []:
                if e.get("sectionKey") == running["scope"]:
                    running["chapterTitle"] = e.get("title")
                    break
        except Exception:  # noqa: BLE001 — titles are cosmetic
            pass
    return {
        "paused": queue_paused(),
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


def _next_job() -> dict[str, Any] | None:
    now = int(time.time())
    with db() as conn:
        row = conn.execute(
            f"SELECT * FROM {BUILDS} WHERE status = 'queued' "
            "AND (not_before IS NULL OR not_before <= %(now)s) "
            "ORDER BY requested_at LIMIT 1",
            {"now": now},
        ).fetchone()
    return _row_to_job(row) if row else None


def _worker_loop() -> None:
    # Recover jobs a restart left as "running" — mark them queued so they retry.
    try:
        with db() as conn:
            conn.execute(f"UPDATE {BUILDS} SET status = 'queued' WHERE status = 'running'")
    except Exception:  # noqa: BLE001
        pass
    while True:
        try:
            if queue_paused():
                time.sleep(10)
                continue
            job = _next_job()
            if not job:
                time.sleep(20)
                continue
            _dispatch(job)
        except Exception:  # noqa: BLE001 — the worker must never die
            time.sleep(20)


def _dispatch(job: dict[str, Any]) -> None:
    """Run one job via its registered runner, bracketing it with honest ledger writes.
    A runner returns a receipt dict (persisted on the row), ``{"error": ...}`` for a
    failure, or None for kinds whose results live elsewhere (build writes its own
    fields via ctx.patch)."""
    key, kind = job["key"], job.get("kind") or "build"
    runner = _RUNNERS.get(kind)
    if runner is None:
        _update_job(key, {"status": "error", "finishedAt": int(time.time()),
                          "error": f"unknown kind {kind!r}"})
        return
    _update_job(key, {"status": "running", "startedAt": int(time.time()), "error": None})
    try:
        # ``db`` arg kept for the runner signature; ported runners use app.platform.db directly.
        receipt = runner(None, job, JobCtx(key, kind))
        if isinstance(receipt, dict) and receipt.get("error"):
            _update_job(key, {"status": "error", "finishedAt": int(time.time()),
                              "error": str(receipt["error"])})
            return
        patch: dict[str, Any] = {"status": "done", "finishedAt": int(time.time()), "phase": None}
        if isinstance(receipt, dict):
            patch["receipt"] = receipt
        _update_job(key, patch)
    except JobCancelled:
        _update_job(key, {"status": "canceled", "finishedAt": int(time.time()),
                          "phase": None, "cancelRequested": None})
    except Exception as exc:  # noqa: BLE001
        _update_job(key, {"status": "error", "finishedAt": int(time.time()), "error": str(exc)})
