"""The job ledger, told to admit failure (v0.18.0).

Every finding here produces a *plausible* ledger row rather than an error, which is why none
of them surfaced on their own and why a fixtured test cannot see them: they are about what
survives across statements, restarts and a poisoned transaction. Real Postgres or nothing.
"""

from __future__ import annotations

import time

import pytest

from app.gateways import db, ledger
from app.gateways.ledger import (
    MAX_ATTEMPTS,
    enqueue_build,
    next_job,
    requeue_interrupted,
    update_job,
)

pytestmark = pytest.mark.integration

DOC = "beef0000-0000-4000-8000-000000000001"


@pytest.fixture()
def doc():
    _wipe()
    with db() as conn:
        conn.execute("INSERT INTO sources (key) VALUES (%(d)s)", {"d": DOC})
        conn.execute(
            "INSERT INTO raw_documents (key, source_id, name, origin, is_main) "
            "VALUES (%(d)s, %(d)s, 'Default', 'default', true)", {"d": DOC})
    yield DOC
    _wipe()


def _wipe():
    with db() as conn:
        conn.execute("DELETE FROM sources WHERE key LIKE 'beef0000-%%'")


def _status(key: str) -> str:
    with db() as conn:
        return conn.execute(
            "SELECT status FROM chapter_builds WHERE key = %(k)s", {"k": key}
        ).fetchone()["status"]


# --------------------------------------------------------------------------- #
# C1 — the claim, and the writes that must not vanish
# --------------------------------------------------------------------------- #

def test_a_job_is_claimed_by_the_statement_that_selects_it(doc):
    """The double-run, closed at the source.

    `next_job` used to be a bare SELECT, with the worker marking the row running afterwards
    through a write that swallowed every error. Lose that write and the row stays queued for
    the next poll to hand out again — the same conversion twice, silently.
    """
    enqueue_build(DOC, "toc:1", kind="extract")
    first = next_job()
    assert first is not None
    assert _status(first["key"]) == "running", "selecting a job must also claim it"
    assert next_job() is None, "a claimed job must not be handed out again"


class _Boom:
    """A `db()` that fails the way a real one does — on use, inside the context manager."""
    def __enter__(self):
        raise RuntimeError("database unavailable")

    def __exit__(self, *_a):
        return False


def test_a_terminal_write_raises_instead_of_vanishing(doc, monkeypatch):
    """Progress is best-effort; a status is not. A dropped `done` leaves a finished job
    displayed as running forever, and a dropped `canceled` gets requeued by the next restart.

    Simulated by breaking the connection rather than by adding a test-only flag to
    `update_job` — a backdoor in production code to make a test pass is the kind of thing
    this cycle is about.
    """
    enqueue_build(DOC, "toc:1", kind="extract")
    job = next_job()
    monkeypatch.setattr(ledger, "db", lambda: _Boom())
    with pytest.raises(Exception):
        update_job(job["key"], {"status": "done", "finishedAt": 1})


def test_progress_writes_stay_best_effort(doc, monkeypatch):
    """The other half, and the reason this is a distinction rather than a blanket rule: a
    lost `phase` or `done` count must never take a job down."""
    enqueue_build(DOC, "toc:1", kind="extract")
    job = next_job()
    monkeypatch.setattr(ledger, "db", lambda: _Boom())
    update_job(job["key"], {"phase": "extract", "done": 1, "total": 9})   # must not raise
    monkeypatch.undo()
    assert _status(job["key"]) == "running"


# --------------------------------------------------------------------------- #
# C5 — interrupted jobs are capped and backed off
# --------------------------------------------------------------------------- #

def test_an_interrupted_job_is_requeued_with_a_backoff(doc):
    enqueue_build(DOC, "toc:1", kind="extract")
    job = next_job()                       # now 'running'
    requeue_interrupted()
    with db() as conn:
        row = conn.execute(
            "SELECT status, attempts, not_before FROM chapter_builds WHERE key = %(k)s",
            {"k": job["key"]},
        ).fetchone()
    assert row["status"] == "queued"
    assert row["attempts"] == 1
    assert row["not_before"] > time.time(), "a retry must not be immediately eligible"


def test_a_job_that_keeps_dying_is_abandoned_rather_than_requeued_forever(doc):
    """The worker is single-threaded, so an uncapped crash-requeue loop does not just retry
    one job — it stops every other job from ever running."""
    enqueue_build(DOC, "toc:1", kind="extract")
    key = next_job()["key"]
    with db() as conn:
        conn.execute(
            "UPDATE chapter_builds SET status = 'running', attempts = %(a)s WHERE key = %(k)s",
            {"a": MAX_ATTEMPTS, "k": key})
    requeue_interrupted()
    with db() as conn:
        row = conn.execute(
            "SELECT status, error FROM chapter_builds WHERE key = %(k)s", {"k": key}
        ).fetchone()
    assert row["status"] == "error"
    assert "abandoned" in (row["error"] or "")


def test_a_cancelled_job_is_settled_not_retried(doc):
    """Cancel-then-restart is the only way to stop work the engine cannot interrupt, and the
    restart used to requeue the very job you were killing, from the top."""
    enqueue_build(DOC, "toc:1", kind="extract")
    key = next_job()["key"]
    with db() as conn:
        conn.execute(
            "UPDATE chapter_builds SET cancel_requested = true WHERE key = %(k)s", {"k": key})
    requeue_interrupted()
    assert _status(key) == "canceled"


def test_a_backed_off_job_is_not_served_before_its_time(doc):
    """`not_before` was already honoured by the query; this pins that the backoff actually
    reaches it rather than being written to a column nothing reads."""
    enqueue_build(DOC, "toc:1", kind="extract")
    next_job()
    requeue_interrupted()
    assert next_job() is None, "a job in backoff must not be claimable yet"


def test_a_failed_recovery_does_not_kill_the_worker(monkeypatch):
    """The regression this nearly shipped with.

    `requeue_interrupted` now raises instead of passing (C1), and the worker calls it OUTSIDE
    its loop — so an uncaught raise there kills the worker thread for the life of the
    process, and the queue silently stops draining. Exactly the failure mode this cycle is
    supposed to remove, reintroduced by its own fix.
    """
    from app.conductor import worker as w

    def boom() -> None:
        raise RuntimeError("recovery failed")

    monkeypatch.setattr(w, "requeue_interrupted", boom)
    monkeypatch.setattr(w, "queue_paused", lambda: True)     # park the loop immediately

    calls: list[int] = []
    real_sleep = w.time.sleep

    def once(_n: float) -> None:
        calls.append(1)
        raise SystemExit                                      # let the loop out after one pass

    monkeypatch.setattr(w.time, "sleep", once)
    with pytest.raises(SystemExit):
        w._worker_loop()
    monkeypatch.setattr(w.time, "sleep", real_sleep)
    assert calls, "the loop must have been entered despite recovery failing"
