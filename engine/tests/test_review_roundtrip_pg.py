"""Real-Postgres review round-trip — the regression net the pure unit tests can't be.

Every other test fixtures the DB, so a live psycopg3 quirk (a NULL param that server-side
binding couldn't type inside ``CASE WHEN`` — commit d4541df) 500'd *every* review re-grade
while 89 green unit tests said nothing. This walks the exact path that regressed against a
real Postgres: seed a due review → queue serves it → grade → **re-grade the same row** (the
``is_new=False`` upsert with a NULL first_review). Covers a concept card and a chapter
typed item; also catches schema drift between 01-schema.sql and the code's SQL.

Runs only when LEARN_PG_TESTS=1 (see conftest); otherwise skipped.
"""

from __future__ import annotations

import time

import pytest

from app.gateways import db
from app.supplemental.study.reviews import (
    build_review_queue,
    chapter_review_key,
    grade_review,
    skeleton_review_key,
)

pytestmark = pytest.mark.integration

DOC = "pgtest-doc"
SCOPE = "toc:pgtest"
DAY = 86400.0


def _seed_concept_and_review(now: float) -> str:
    """A concept plus a PAST-due legacy-style review row (no stability — like the migrated
    rows). Returns the concept key. The existing review row forces grade_review's
    ``is_new=False`` branch — the one that regressed."""
    key = "pgtest-concept-1"
    with db() as conn:
        conn.execute(
            'INSERT INTO ext_concepts (key, doc_id, section_key, name, kind, signal, "order") '
            "VALUES (%(k)s,%(d)s,%(s)s,'Test concept','definition','The signal.',1) "
            "ON CONFLICT (key) DO NOTHING",
            {"k": key, "d": DOC, "s": SCOPE},
        )
        conn.execute(
            "INSERT INTO concept_reviews (key, doc_id, section_key, due, ease, interval, reps, "
            "lapses, state) VALUES (%(k)s,%(d)s,%(s)s, to_timestamp(%(due)s), 2.5, 6, 2, 0, 'review') "
            "ON CONFLICT (key) DO UPDATE SET due = EXCLUDED.due, state = 'review'",
            {"k": key, "d": DOC, "s": SCOPE, "due": now - DAY},
        )
    return key


def _seed_chapter_item(now: float) -> str:
    """A past-due chapter-resurface row (its own key prefix + item_type)."""
    key = chapter_review_key(DOC, SCOPE)
    with db() as conn:
        conn.execute(
            "INSERT INTO concept_reviews (key, doc_id, section_key, due, ease, interval, reps, "
            "lapses, state, item_type, chapter_scope, heading) "
            "VALUES (%(k)s,%(d)s,%(s)s, to_timestamp(%(due)s), 2.5, 2, 1, 0, 'review', "
            "'chapter', %(s)s, 'Test chapter') "
            "ON CONFLICT (key) DO UPDATE SET due = EXCLUDED.due, state = 'review'",
            {"k": key, "d": DOC, "s": SCOPE, "due": now - DAY},
        )
    return key


@pytest.fixture
def clean_pgtest_rows():
    """Remove any pgtest rows before and after — the test writes into the real learnhub
    schema, so it must leave no trace (keyed by the pgtest doc id)."""

    def _wipe() -> None:
        with db() as conn:
            conn.execute("DELETE FROM concept_reviews WHERE doc_id = %(d)s", {"d": DOC})
            conn.execute("DELETE FROM study_events WHERE doc = %(d)s", {"d": DOC})
            # ext_concepts.doc_id FKs raw_documents, which FKs sources; dropping the
            # source cascades the version and its concepts.
            conn.execute("DELETE FROM sources WHERE key = %(d)s", {"d": DOC})

    _wipe()
    with db() as conn:
        conn.execute(
            "INSERT INTO sources (key) VALUES (%(d)s) ON CONFLICT (key) DO NOTHING",
            {"d": DOC},
        )
        # A book is a source plus its Default version, keyed identically.
        conn.execute(
            "INSERT INTO raw_documents (key, source_id, status) "
            "VALUES (%(d)s, %(d)s, 'ready') ON CONFLICT (key) DO NOTHING",
            {"d": DOC},
        )
    yield
    _wipe()


def test_concept_review_regrade_round_trip(clean_pgtest_rows):
    now = time.time()
    key = _seed_concept_and_review(now)

    # 1. The seeded past-due card is served as due.
    q = build_review_queue(DOC, SCOPE)
    assert q.get("error") is None, q.get("error")
    assert q["counts"]["due"] >= 1
    assert any(c["conceptKey"] == key for c in q["cards"]), q["cards"]

    # 2. Grade it — this is the is_new=False upsert with a NULL first_review (the regression).
    payload, status = grade_review({"doc": DOC}, key, 3, now)
    assert status == 200, payload
    assert payload["due"] > now  # a Good grade schedules it into the future

    # 3. Re-grade the same row — the path that 500'd before the fix.
    payload2, status2 = grade_review({"doc": DOC}, key, 4, now + 1)
    assert status2 == 200, payload2

    # The grade appended to the mastery floor (best-effort, but should have landed).
    with db() as conn:
        n = conn.execute(
            "SELECT count(*) AS n FROM study_events WHERE doc = %(d)s AND kind = 'review'",
            {"d": DOC},
        ).fetchone()["n"]
    assert n >= 2


def test_chapter_item_regrade_round_trip(clean_pgtest_rows):
    now = time.time()
    key = _seed_chapter_item(now)

    q = build_review_queue(DOC, SCOPE)
    assert q.get("error") is None, q.get("error")
    card = next((c for c in q["cards"] if c["conceptKey"] == key), None)
    assert card is not None and card["itemType"] == "chapter", q["cards"]

    payload, status = grade_review({}, key, 3, now)
    assert status == 200, payload
    payload2, status2 = grade_review({}, key, 2, now + 1)
    assert status2 == 200, payload2

    # Chapter grades log a distinct 'resurface' study event (not 'review'/'skeleton').
    with db() as conn:
        n = conn.execute(
            "SELECT count(*) AS n FROM study_events WHERE doc = %(d)s AND kind = 'resurface'",
            {"d": DOC},
        ).fetchone()["n"]
    assert n >= 2


def test_skeleton_item_seed_then_regrade(clean_pgtest_rows):
    """First grade carries the snapshot (doc + sectionKey + children) and SEEDS the row;
    the queue re-grade addresses it by its skel- key."""
    now = time.time()
    body = {
        "skeleton": True, "doc": DOC, "sectionKey": SCOPE, "heading": "Test branch",
        "chapterScope": SCOPE,
        "children": [{"heading": "Sub A", "essence": "does A"}, {"heading": "Sub B"}],
    }
    payload, status = grade_review(body, "", 3, now)  # seed via snapshot, no key
    assert status == 200, payload
    key = skeleton_review_key(DOC, SCOPE)
    assert payload["conceptKey"] == key

    # The seeded row carries item_type + the children snapshot.
    with db() as conn:
        row = conn.execute(
            "SELECT item_type, jsonb_array_length(children) AS kids FROM concept_reviews WHERE key = %(k)s",
            {"k": key},
        ).fetchone()
    assert row["item_type"] == "skeleton" and row["kids"] == 2

    # Re-grade by key (no snapshot) — the is_new=False upsert path.
    payload2, status2 = grade_review({}, key, 2, now + 1)
    assert status2 == 200, payload2

    with db() as conn:
        n = conn.execute(
            "SELECT count(*) AS n FROM study_events WHERE doc = %(d)s AND kind = 'skeleton'",
            {"d": DOC},
        ).fetchone()["n"]
    assert n >= 2
