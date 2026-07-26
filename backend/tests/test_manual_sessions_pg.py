"""Real-Postgres roundtrip for manual study-time blocks (TASK-22).

Walks the whole stored-layer path against live SQL: create → appears in
fetch_sessions (merged + counted) → update → delete → gone; plus the FK cascade
(dropping the course drops its manual blocks) and CHECK-constraint rejection.
Runs only when LEARN_PG_TESTS=1 (see conftest); otherwise skipped.
"""

from __future__ import annotations

import time

import pytest

from app.gateways import db
from app.supplemental.study.manual import delete_manual_session, upsert_manual_session
from app.supplemental.study.sessions import fetch_sessions

pytestmark = pytest.mark.integration

DOC = "pgtest-manual-doc"


@pytest.fixture
def seeded_doc():
    with db() as conn:
        conn.execute(
            "INSERT INTO raw_documents (key, status) VALUES (%(d)s, 'ready') "
            "ON CONFLICT (key) DO NOTHING",
            {"d": DOC},
        )
    yield DOC
    with db() as conn:
        # manual_sessions FKs raw_documents ON DELETE CASCADE — this also proves the cascade.
        conn.execute("DELETE FROM raw_documents WHERE key = %(d)s", {"d": DOC})


def _manual_in(doc: str) -> list[dict]:
    data = fetch_sessions(doc, days=7)
    assert not data.get("error")
    return [s for s in data["sessions"] if s.get("manual")]


def test_manual_block_roundtrip(seeded_doc):
    now = time.time()
    created = upsert_manual_session(seeded_doc, now - 3600, now - 1800, note="chapter 3 on paper")
    assert created.get("ok"), created
    key = created["key"]

    found = _manual_in(seeded_doc)
    assert [s["key"] for s in found] == [key]
    assert found[0]["durationMin"] == 30.0
    assert found[0]["note"] == "chapter 3 on paper"
    total = fetch_sessions(seeded_doc, days=7)["summary"]["totalMinutes"]
    assert total >= 30.0  # the block counts toward time studied

    updated = upsert_manual_session(seeded_doc, now - 7200, now - 3600, note=None, key=key)
    assert updated.get("ok"), updated
    found = _manual_in(seeded_doc)
    assert found[0]["durationMin"] == 60.0 and found[0]["note"] is None

    assert delete_manual_session(key).get("ok")
    assert _manual_in(seeded_doc) == []
    assert delete_manual_session(key)["error"]  # second delete → not found


def test_manual_block_rejections(seeded_doc):
    now = time.time()
    assert upsert_manual_session(seeded_doc, now, now - 60)["error"]  # end before start
    assert upsert_manual_session("no-such-doc", now - 60, now)["error"]  # FK: unknown course
    assert upsert_manual_session("", now - 60, now)["error"]  # doc required


def test_course_delete_cascades_manual_blocks(seeded_doc):
    now = time.time()
    created = upsert_manual_session(seeded_doc, now - 600, now - 60)
    assert created.get("ok")
    with db() as conn:
        conn.execute("DELETE FROM raw_documents WHERE key = %(d)s", {"d": seeded_doc})
        left = conn.execute(
            "SELECT count(*) AS n FROM manual_sessions WHERE doc = %(d)s", {"d": seeded_doc}
        ).fetchone()["n"]
    assert left == 0
