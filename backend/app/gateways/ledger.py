"""The jobs ledger — every LLM/GPU generation pass is a persistent row here.

Grew out of the chapter build queue ("build this chapter"); now the ONE record for all
artifact kinds, so generation is never a black box: what ran, what's running, what's
queued, how long it took, and why it failed all live in the ``chapter_builds`` table and
survive restarts.

This module is pure ledger mechanics — enqueue/cancel/list/patch rows, nothing else.
It knows nothing about the domains, and it does not RUN anything: the single daemon
worker that drains the queue lives in ``conductor/worker.py`` (started once at app
startup), which reads this ledger through the public functions below. The "latest
document" resolver is injected at startup by the composition root
(``conductor/registry.py``), so domains can enqueue jobs without the ledger importing
them back.

``notBefore`` (epoch seconds, optional) is the whole scheduling model: "build tonight"
is just a row with a future timestamp. (Audiobooks keep their own checkpointed job
system in supplemental/media/audiobook.py — hour-long TTS runs need resumability, not just a ledger
row.)
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

from psycopg.types.json import Json

from app.gateways.db import db

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

# The "no doc id given" resolver, injected at startup by conductor/registry.py —
# keeps the ledger below process/content while sharing the one resolve rule.
_doc_resolver = None


def set_doc_resolver(fn) -> None:
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
    # `build` and `extract` are the SAME work (one runner) — both keep the pre-kind key, so a
    # manual /api/extract and an autochained extract dedup to one row and legacy build rows
    # stay addressable. Every other kind gets its own namespace.
    raw = f"{doc_id}|{scope}" if kind in ("build", "extract") else f"{doc_id}|{scope}|{kind}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    return _doc_resolver() if _doc_resolver else None


def update_job(key: str, patch: dict[str, Any]) -> None:
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
        update_job(key, {"cancelRequested": True})
        return {"cancelled": False, "cancelling": True}
    return {"cancelled": False, "reason": job.get("status")}


def check_cancel(key: str) -> None:
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
    # `build` and `extract` are one kind — asking for either returns both (+ legacy NULL rows,
    # which are builds), so an autochained extract is visible to the build-filtering poller.
    kinds = None if kind is None else (["build", "extract"] if kind in ("build", "extract") else [kind])
    include_null = kinds is not None and "build" in kinds
    with db() as conn:
        rows = conn.execute(
            f"SELECT * FROM {BUILDS} WHERE doc_id = %(d)s "
            "AND (%(kinds)s::text[] IS NULL OR kind = ANY(%(kinds)s) OR (%(nul)s AND kind IS NULL)) "
            "ORDER BY requested_at",
            {"d": doc_id, "kinds": kinds, "nul": include_null},
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
# Worker-facing reads (consumed by conductor/worker.py — the one queue drainer)
# --------------------------------------------------------------------------- #

def next_job() -> dict[str, Any] | None:
    """The oldest queued row whose ``notBefore`` has passed, or None."""
    now = int(time.time())
    with db() as conn:
        row = conn.execute(
            f"SELECT * FROM {BUILDS} WHERE status = 'queued' "
            "AND (not_before IS NULL OR not_before <= %(now)s) "
            "ORDER BY requested_at LIMIT 1",
            {"now": now},
        ).fetchone()
    return _row_to_job(row) if row else None


def requeue_interrupted() -> None:
    """Recover jobs a restart left as "running" — mark them queued so they retry."""
    try:
        with db() as conn:
            conn.execute(f"UPDATE {BUILDS} SET status = 'queued' WHERE status = 'running'")
    except Exception:  # noqa: BLE001
        pass
