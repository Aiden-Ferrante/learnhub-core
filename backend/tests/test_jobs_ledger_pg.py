"""Real-Postgres check that build/extract are one kind in the jobs ledger.

The bug this locks: an autochained upload enqueues an `extract` job, but the /api/extract
status poller filtered `list_builds(kind="build")` — so autochained extraction was invisible.
build and extract now share the dedup key and list together. Gated by LEARN_PG_TESTS=1.
"""

from __future__ import annotations

import pytest

from app.gateways import db
from app.gateways.ledger import enqueue_build, list_builds

pytestmark = pytest.mark.integration

DOC = "pgtest-jobs-doc"
SCOPE = "toc:pgtest-jobs"


@pytest.fixture
def clean_jobs():
    def _wipe():
        with db() as conn:
            conn.execute("DELETE FROM chapter_builds WHERE doc_id = %(d)s", {"d": DOC})

    _wipe()
    yield
    _wipe()


def test_autochained_extract_is_visible_to_the_build_poller(clean_jobs):
    # Autochain enqueues `extract`…
    enqueue_build(DOC, SCOPE, kind="extract")
    # …and the legacy poller filtering on `build` must still see it.
    seen = list_builds(DOC, kind="build").get("builds", [])
    assert any(b.get("scope") == SCOPE for b in seen), seen
    # Symmetric: an `extract` filter sees it too.
    seen_x = list_builds(DOC, kind="extract").get("builds", [])
    assert any(b.get("scope") == SCOPE for b in seen_x)


def test_build_and_extract_dedup_to_one_row(clean_jobs):
    enqueue_build(DOC, SCOPE, kind="build")
    enqueue_build(DOC, SCOPE, kind="extract")  # same (doc, scope) work → same row
    with db() as conn:
        n = conn.execute(
            "SELECT count(*) AS n FROM chapter_builds WHERE doc_id = %(d)s AND scope = %(s)s",
            {"d": DOC, "s": SCOPE},
        ).fetchone()["n"]
    assert n == 1
