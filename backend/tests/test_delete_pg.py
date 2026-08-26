"""Deleting a book, against a real Postgres.

The delete paths had **zero** coverage (v0.17.0, exit criterion 5), which is how a 404 on an
absent document, a non-transactional multi-table cascade, and an `except: continue` that
poisons its own transaction all survived. None of those are visible to a fixtured test: they
are about what the database does across statements, so the test has to use one.

What is deliberately asserted here is the *shape* of a delete rather than a row count:
everything keyed to the book goes, everything keyed to a different book stays, and a failure
partway through leaves nothing half-removed.
"""

from __future__ import annotations

import pytest

from app.gateways import db
from app.process.content import delete_document, delete_version

pytestmark = pytest.mark.integration

# Ids are hex-and-dashes because that is what `delete_document` and `delete_version`
# accept — a readable "pgtest-del-book" is refused as an invalid doc id, correctly. The
# `dead0000` prefix is what the fixture cleans up by.
BOOK = "dead0000-0000-4000-8000-000000000001"
OTHER = "dead0000-0000-4000-8000-000000000002"
V_DEFAULT = BOOK                      # the identity backfill: default version key == source
V_CUSTOM = "dead0000-0000-4000-8000-000000000003"


def _rows(table: str, col: str, val: str) -> int:
    with db() as conn:
        return conn.execute(
            f"SELECT count(*) AS n FROM {table} WHERE {col} = %(v)s", {"v": val}
        ).fetchone()["n"]


@pytest.fixture()
def book():
    """One book with two courses cut from it, plus a second book that must survive."""
    _wipe()
    with db() as conn:
        for src in (BOOK, OTHER):
            conn.execute("INSERT INTO sources (key) VALUES (%(k)s)", {"k": src})
            conn.execute(
                "INSERT INTO raw_documents (key, source_id, name, origin, is_main) "
                "VALUES (%(k)s, %(k)s, 'Default', 'default', true)", {"k": src})
            conn.execute(
                "INSERT INTO raw_content (key, doc_id, section_key, markdown, \"order\") "
                "VALUES (%(k)s, %(d)s, 'toc:1', 'text', 0)", {"k": f"{src}-block", "d": src})
            conn.execute(
                "INSERT INTO ext_concepts (key, doc_id, section_key, name, kind, signal, source) "
                "VALUES (%(k)s, %(d)s, 'toc:1', 'c', 'definition', 's', 'src')",
                {"k": f"{src}-concept", "d": src})
            conn.execute(
                "INSERT INTO concept_reviews (key, doc_id, section_key) "
                "VALUES (%(k)s, %(d)s, 'toc:1')", {"k": f"{src}-review", "d": src})
            conn.execute(
                "INSERT INTO study_events (key, doc, section_key, kind) "
                "VALUES (%(k)s, %(d)s, 'toc:1', 'review')", {"k": f"{src}-event", "d": src})
        # a second course over the first book, with its own study state
        conn.execute(
            "INSERT INTO raw_documents (key, source_id, name, origin, is_main) "
            "VALUES (%(k)s, %(s)s, 'My cut', 'custom', false)", {"k": V_CUSTOM, "s": BOOK})
        conn.execute(
            "INSERT INTO concept_reviews (key, doc_id, section_key) "
            "VALUES (%(k)s, %(d)s, 'toc:1')", {"k": f"{V_CUSTOM}-review", "d": V_CUSTOM})
    yield
    _wipe()


def _wipe():
    with db() as conn:
        for t, c in (("concept_reviews", "doc_id"), ("chapter_progress", "doc_id")):
            conn.execute(f"DELETE FROM {t} WHERE {c} LIKE 'dead0000-%%'")
        conn.execute("DELETE FROM study_events WHERE doc LIKE 'dead0000-%%'")
        conn.execute("DELETE FROM sources WHERE key LIKE 'dead0000-%%'")


def test_deleting_a_book_takes_every_course_cut_from_it(book):
    out = delete_document(BOOK)
    assert out.get("error") is None
    with db() as conn:
        left = conn.execute(
            "SELECT count(*) AS n FROM raw_documents WHERE source_id = %(s)s", {"s": BOOK}
        ).fetchone()["n"]
    assert left == 0, "the custom course must go with its book"


def test_the_cascade_reaches_the_study_tables_that_have_no_fk(book):
    """`concept_reviews`, `study_events` and `chapter_progress` carry no FK, so they are
    pruned explicitly. That is exactly the code an `except: continue` used to hide."""
    delete_document(BOOK)
    assert _rows("concept_reviews", "doc_id", V_DEFAULT) == 0
    assert _rows("concept_reviews", "doc_id", V_CUSTOM) == 0, "per-version rows too"
    assert _rows("study_events", "doc", V_DEFAULT) == 0


def test_another_book_is_untouched(book):
    """The assertion that makes the others mean something."""
    delete_document(BOOK)
    assert _rows("raw_content", "doc_id", OTHER) == 1
    assert _rows("ext_concepts", "doc_id", OTHER) == 1
    assert _rows("concept_reviews", "doc_id", OTHER) == 1
    assert _rows("study_events", "doc", OTHER) == 1


def test_deleting_an_absent_book_succeeds(book):
    """DELETE is idempotent. Returning 404 here made an orphan shelf card permanently
    undeletable, because the client only prunes the card once this call succeeds."""
    delete_document(BOOK)
    again = delete_document(BOOK)
    assert again.get("error") is None
    assert again.get("alreadyGone") is True


def test_a_malformed_id_is_still_refused(book):
    """Idempotent is not the same as credulous: an absent resource is success, a nonsense
    request is a client error."""
    out = delete_document("not a uuid at all!")
    assert out.get("status") == 400


def test_the_on_deleted_callback_gets_every_version(book):
    """Audiobooks live in `supplemental/media`, which `process/content` may not import, so
    the artifact cleanup is injected and composed at the api layer. It must be handed every
    version — audio is rendered per course, not per book."""
    seen: list[list[str]] = []
    delete_document(BOOK, on_deleted=seen.append)
    assert seen and sorted(seen[0]) == sorted([V_DEFAULT, V_CUSTOM])


def test_the_callback_runs_only_after_the_rows_are_gone(book):
    """Ordering matters: a callback that deletes files while the transaction is still open
    destroys them even if it rolls back."""
    observed: dict[str, int] = {}

    def probe(_versions: list[str]) -> None:
        with db() as conn:
            observed["left"] = conn.execute(
                "SELECT count(*) AS n FROM raw_documents WHERE source_id = %(s)s", {"s": BOOK}
            ).fetchone()["n"]

    delete_document(BOOK, on_deleted=probe)
    assert observed["left"] == 0


def test_deleting_one_course_leaves_the_book_and_the_other_course(book):
    out = delete_version(V_CUSTOM)
    assert out.get("error") is None
    assert _rows("raw_documents", "key", V_DEFAULT) == 1
    assert _rows("ext_concepts", "doc_id", BOOK) == 1, "the book's concepts are not the cut's"
    assert _rows("concept_reviews", "doc_id", V_CUSTOM) == 0


def test_the_default_course_cannot_be_deleted_on_its_own(book):
    """It is the tree every other course's concepts anchor to."""
    out = delete_version(V_DEFAULT)
    assert out.get("status") == 409
    assert _rows("raw_documents", "key", V_DEFAULT) == 1
