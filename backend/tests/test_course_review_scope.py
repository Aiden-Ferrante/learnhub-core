"""Course-wide review scope and the counts that lead to it (v0.25.0, docs/ui-spec.md §5).

Every due badge (study-debt, the planner calendar) must count only what the course review
serves, so the badge can reach zero from /courses/[id]/review. These pin:
- the whole-course scope (omitted, blank or "course") serves every DUE concept, skeleton
  and chapter card in the doc, across chapters, and no new cards;
- a chapter scope still serves its own due cards plus its new concepts (unchanged);
- study-debt and the calendar drop practice and pack rows.

The DB is faked: each test hands the module a connection whose execute() answers by the
SQL it is given.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any

import pytest

from app.supplemental.study import calendar, reviews

NOW = time.time()
PAST = NOW - 3600
FUTURE = NOW + 86400 * 3


class _Result:
    def __init__(self, rows: list[dict[str, Any]]):
        self._rows = rows

    def fetchall(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._rows]


class _Conn:
    """Answers each query with the first canned row set whose marker is in the SQL."""

    def __init__(self, answers: list[tuple[str, list[dict[str, Any]]]]):
        self.answers = answers

    def execute(self, sql: str, params: Any = None) -> _Result:
        for marker, rows in self.answers:
            if marker in sql:
                return _Result(rows)
        return _Result([])


def _fake_db(answers):
    @contextmanager
    def db():
        yield _Conn(answers)

    return db


# ── build_review_queue ──────────────────────────────────────────────────────

CONCEPTS = [
    {"key": "c-due-ch1", "name": "A", "kind": "definition", "signal": "", "sectionKey": "toc:1.1", "docId": "book"},
    {"key": "c-due-ch2", "name": "B", "kind": "definition", "signal": "", "sectionKey": "toc:2.1", "docId": "book"},
    {"key": "c-later", "name": "C", "kind": "definition", "signal": "", "sectionKey": "toc:1.2", "docId": "book"},
    {"key": "c-new-ch1", "name": "D", "kind": "definition", "signal": "", "sectionKey": "toc:1.3", "docId": "book"},
    {"key": "c-new-ch2", "name": "E", "kind": "definition", "signal": "", "sectionKey": "toc:2.2", "docId": "book"},
]
CONCEPT_REVIEWS = [
    {"key": "c-due-ch1", "due": PAST, "state": "review"},
    {"key": "c-due-ch2", "due": PAST - 10, "state": "review"},
    {"key": "c-later", "due": FUTURE, "state": "review"},
]
TYPED = [
    {"key": "skel-1", "docId": "v1", "due": PAST, "state": "review", "itemType": "skeleton",
     "chapterScope": "toc:1", "sectionKey": "toc:1", "heading": "Ch 1", "children": []},
    {"key": "chap-2", "docId": "v1", "due": PAST, "state": "review", "itemType": "chapter",
     "chapterScope": "toc:2", "sectionKey": "toc:2", "heading": "Ch 2", "children": []},
    {"key": "skel-later", "docId": "v1", "due": FUTURE, "state": "review", "itemType": "skeleton",
     "chapterScope": "toc:2", "sectionKey": "toc:2", "heading": "Ch 2", "children": []},
]


@pytest.fixture
def queue_db(monkeypatch):
    monkeypatch.setattr(
        reviews,
        "db",
        _fake_db([
            ("FROM ext_concepts", CONCEPTS),
            ("item_type IN ('skeleton', 'chapter')", TYPED),
            ("FROM concept_reviews", CONCEPT_REVIEWS),
        ]),
    )
    monkeypatch.setattr(reviews, "concept_filter", lambda doc, *a, **k: ("TRUE", {}))
    monkeypatch.setattr(reviews, "source_id_of", lambda doc: "book")
    monkeypatch.setattr(reviews, "source_sections", lambda doc, keys: keys)
    spans = {"toc:1": {"toc:1", "toc:1.1", "toc:1.2", "toc:1.3"}}
    monkeypatch.setattr(reviews, "scope_section_keys", lambda doc, scope: spans.get(scope, {scope}))


@pytest.mark.parametrize("scope", [None, "", "course"])
def test_whole_course_scope_serves_every_due_card_and_no_new(queue_db, scope):
    out = reviews.build_review_queue("v1", scope)
    keys = [c["conceptKey"] for c in out["cards"]]
    assert set(keys) == {"c-due-ch1", "c-due-ch2", "skel-1", "chap-2"}
    assert out["counts"] == {"due": 4, "new": 0, "later": 2}
    # earliest due first
    assert keys[0] == "c-due-ch2"


def test_chapter_scope_unchanged_due_then_new(queue_db):
    out = reviews.build_review_queue("v1", "toc:1")
    keys = [c["conceptKey"] for c in out["cards"]]
    assert set(keys[:2]) == {"c-due-ch1", "skel-1"}
    assert keys[-1] == "c-new-ch1"
    assert "c-due-ch2" not in keys and "chap-2" not in keys
    assert out["counts"] == {"due": 2, "new": 1, "later": 1}


def test_course_scope_helpers():
    assert reviews.is_course_scope(None)
    assert reviews.is_course_scope("  ")
    assert reviews.is_course_scope("course")
    assert not reviews.is_course_scope("toc:1")
    for t in (None, "concept", "skeleton", "chapter"):
        assert reviews.served_by_course_review(t)
    for t in ("practice", "pack", "figure"):
        assert not reviews.served_by_course_review(t)


# ── study-debt + calendar ──────────────────────────────────────────────────

TITLES = [{"k": "book", "t": "The Book"}, {"k": "v1", "t": "The Book (v1)"}]


def test_study_debt_counts_only_served_types(monkeypatch):
    rows = [
        {"d": "book", "itemType": None, "due": 3, "soon": 1, "tracked": 10},
        {"d": "book", "itemType": "practice", "due": 7, "soon": 2, "tracked": 9},
        {"d": "book", "itemType": "pack", "due": 5, "soon": 0, "tracked": 5},
        {"d": "v1", "itemType": "skeleton", "due": 2, "soon": 0, "tracked": 2},
        {"d": "v1", "itemType": "chapter", "due": 1, "soon": 1, "tracked": 1},
        {"d": "v1", "itemType": "pack", "due": 4, "soon": 4, "tracked": 4},
        {"d": "gone", "itemType": None, "due": 9, "soon": 9, "tracked": 9},
    ]
    monkeypatch.setattr(
        calendar, "db", _fake_db([("FROM raw_documents", TITLES), ("FROM concept_reviews", rows)])
    )
    out = calendar.build_study_debt(7)
    assert out["dueNow"] == 3 + 2 + 1
    assert out["fadingSoon"] == 1 + 1
    assert out["tracked"] == 10 + 2 + 1
    by_doc = {c["doc"]: c for c in out["courses"]}
    assert by_doc["book"]["dueNow"] == 3
    assert by_doc["v1"]["dueNow"] == 3
    assert "gone" not in by_doc


def test_study_debt_reaches_zero_when_only_unserved_rows_are_due(monkeypatch):
    rows = [{"d": "book", "itemType": "practice", "due": 12, "soon": 0, "tracked": 12}]
    monkeypatch.setattr(
        calendar, "db", _fake_db([("FROM raw_documents", TITLES), ("FROM concept_reviews", rows)])
    )
    out = calendar.build_study_debt(7)
    assert out["dueNow"] == 0 and out["courses"] == []


def test_calendar_drops_practice_and_pack_rows(monkeypatch):
    rows = [
        {"docId": "book", "itemType": None, "key": "c1", "heading": None, "sectionKey": "toc:1",
         "conceptName": "Modules", "due": PAST},
        {"docId": "book", "itemType": "practice", "key": "prac-1", "heading": "P", "sectionKey": "toc:1",
         "conceptName": None, "due": PAST},
        {"docId": "v1", "itemType": "pack", "key": "pack-1", "heading": "Skill", "sectionKey": "toc:1",
         "conceptName": None, "due": PAST},
        {"docId": "v1", "itemType": "skeleton", "key": "skel-1", "heading": "Ch 1", "sectionKey": "toc:1",
         "conceptName": None, "due": FUTURE},
    ]
    monkeypatch.setattr(
        calendar, "db", _fake_db([("FROM raw_documents", TITLES), ("FROM concept_reviews", rows)])
    )
    out = calendar.build_review_calendar(60)
    assert out["dueNow"]["total"] == 1
    assert [i["key"] for i in out["dueNow"]["items"]] == ["c1"]
    assert sum(d["total"] for d in out["days"]) == 1
    assert out["tracked"] == 2
