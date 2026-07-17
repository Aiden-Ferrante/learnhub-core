"""The queue worker — the one daemon that drains the jobs ledger.

A single worker runs one job at a time — the GPU is compute-bound, so concurrent jobs
would only time-slice it. Each job kind's runner is registered here at startup by
``conductor/registry.py`` (install → ensure_worker); the ledger itself (rows,
enqueue/cancel/list) lives in ``gateways/ledger`` and knows nothing about running.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable

from app.gateways import JobCancelled, check_cancel, next_job, queue_paused, requeue_interrupted, update_job

_worker_lock = threading.Lock()
_worker_started = False

# kind -> runner(job, ctx) -> receipt | None. Registered by conductor/registry.py.
_RUNNERS: dict[str, Callable[[dict[str, Any], "JobCtx"], dict[str, Any] | None]] = {}


def register_runner(kind: str, fn: Callable[[dict[str, Any], "JobCtx"], dict[str, Any] | None]) -> None:
    _RUNNERS[kind] = fn


class JobCtx:
    """What a runner may do to its own ledger row: report progress (throttled),
    honor cancellation, and patch extra fields (e.g. extraction outcomes)."""

    def __init__(self, key: str, kind: str) -> None:
        self._key = key
        self.phase = kind
        self._last_write = 0.0

    def check_cancel(self) -> None:
        check_cancel(self._key)

    def patch(self, fields: dict[str, Any]) -> None:
        update_job(self._key, fields)

    def progress(self, done: int, total: int, current: str | None = None) -> None:
        now = time.time()
        if now - self._last_write < 5 and done < total:
            return
        self._last_write = now
        self.check_cancel()
        self.patch({"phase": self.phase, "done": done, "total": total})


def ensure_worker() -> None:
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True
    threading.Thread(target=_worker_loop, daemon=True, name="jobs-worker").start()


def _worker_loop() -> None:
    requeue_interrupted()
    while True:
        try:
            if queue_paused():
                time.sleep(10)
                continue
            job = next_job()
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
        update_job(key, {"status": "error", "finishedAt": int(time.time()),
                         "error": f"unknown kind {kind!r}"})
        return
    update_job(key, {"status": "running", "startedAt": int(time.time()), "error": None})
    try:
        receipt = runner(job, JobCtx(key, kind))
        if isinstance(receipt, dict) and receipt.get("error"):
            update_job(key, {"status": "error", "finishedAt": int(time.time()),
                             "error": str(receipt["error"])})
            return
        patch: dict[str, Any] = {"status": "done", "finishedAt": int(time.time()), "phase": None}
        if isinstance(receipt, dict):
            patch["receipt"] = receipt
        update_job(key, patch)
    except JobCancelled:
        update_job(key, {"status": "canceled", "finishedAt": int(time.time()),
                         "phase": None, "cancelRequested": None})
    except Exception as exc:  # noqa: BLE001
        update_job(key, {"status": "error", "finishedAt": int(time.time()), "error": str(exc)})
