"""The grounding check, end to end against a real Postgres.

Why this is an integration test and not a unit test: the check's whole job is to compare
what the extractor STORED against what the converter stored, across a join. A unit test over
hand-built strings proves the classifier's arithmetic and nothing about whether the query
pairs a concept with its own section — which is the half that would silently make the check
pass over an empty result set.

The seeded corpus deliberately contains one of every verdict that matters, including an
invented quote. If a future change stops detecting that row, this test fails — which is the
point. A check that cannot fail is the thing this cycle exists to remove.
"""

from __future__ import annotations

import pytest

from app.gateways import db
from app.process.extraction import classify_grounding, summarize_grounding

pytestmark = pytest.mark.integration

DOC = "pgtest-grounding"
SECTION = "toc:pgtest-g"

SECTION_TEXT = (
    "A linear map is determined by where it sends a basis. "
    "Add two linear maps pointwise and you get a linear map. "
    "The kernel is the set of vectors sent to zero."
)

# (name, stored source_sentence, expected verdict)
CASES = [
    ("copied",      "The kernel is the set of vectors sent to zero.",            "verbatim"),
    ("two-sentence", "The kernel is the set of vectors sent to zero. And more.", "partial"),
    ("rewritten",   "linear you two Add and maps a get pointwise map",           "paraphrase"),
    ("made up",     "Every compact operator on a Hilbert space is diagonalisable.", "invented"),
    ("empty",       "",                                                          "ungated"),
]


@pytest.fixture()
def seeded():
    with db() as conn:
        conn.execute("DELETE FROM ext_concepts WHERE doc_id = %(d)s", {"d": DOC})
        conn.execute("DELETE FROM raw_content WHERE doc_id = %(d)s", {"d": DOC})
        conn.execute("DELETE FROM sources WHERE key = %(d)s", {"d": DOC})
        conn.execute("INSERT INTO sources (key) VALUES (%(d)s) ON CONFLICT DO NOTHING", {"d": DOC})
        conn.execute(
            "INSERT INTO raw_content (key, doc_id, section_key, markdown, \"order\") "
            "VALUES (%(k)s, %(d)s, %(s)s, %(m)s, 0)",
            {"k": f"{DOC}-block", "d": DOC, "s": SECTION, "m": SECTION_TEXT})
        for i, (name, source, _) in enumerate(CASES):
            conn.execute(
                "INSERT INTO ext_concepts (key, doc_id, section_key, name, kind, signal, source, \"order\") "
                "VALUES (%(k)s, %(d)s, %(s)s, %(n)s, 'definition', 'x', %(src)s, %(o)s)",
                {"k": f"{DOC}-{i}", "d": DOC, "s": SECTION, "n": name, "src": source, "o": i})
    yield
    with db() as conn:
        conn.execute("DELETE FROM sources WHERE key = %(d)s", {"d": DOC})   # cascades


def _fetch() -> list[dict]:
    with db() as conn:
        return conn.execute("""
            SELECT c.name, c.source,
                   coalesce(string_agg(r.markdown, ' ' ORDER BY r."order"), '') AS md
            FROM ext_concepts c
            LEFT JOIN raw_content r ON r.doc_id = c.doc_id AND r.section_key = c.section_key
            WHERE c.doc_id = %(d)s
            GROUP BY c.key, c.name, c.source
        """, {"d": DOC}).fetchall()


def test_every_verdict_is_reached_through_the_real_join(seeded):
    got = {r["name"]: classify_grounding(r["source"], r["md"]) for r in _fetch()}
    assert got == {name: verdict for name, _, verdict in CASES}


def test_an_invented_quote_makes_the_check_fail(seeded):
    """The assertion the whole check exists for."""
    s = summarize_grounding([classify_grounding(r["source"], r["md"]) for r in _fetch()])
    assert s["failures"] == 2          # the invented one and the empty one
    assert s["ok"] is False


def test_a_clean_corpus_passes(seeded):
    with db() as conn:
        conn.execute("DELETE FROM ext_concepts WHERE key IN (%(a)s, %(b)s)",
                     {"a": f"{DOC}-3", "b": f"{DOC}-4"})
    s = summarize_grounding([classify_grounding(r["source"], r["md"]) for r in _fetch()])
    assert s["examined"] == 3 and s["failures"] == 0 and s["ok"] is True


def test_an_empty_corpus_is_not_a_pass():
    """Absent information must not read as success — the rule v0.15.0 established for the
    study surfaces, applied to the check itself. Without this, wiring the script into CI
    against a database with no concepts would go green forever while proving nothing."""
    s = summarize_grounding([])
    assert s["examined"] == 0 and s["ok"] is False
