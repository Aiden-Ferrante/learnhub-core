"""Exam sittings — the pure assembly and scoring logic.

The DB-touching paths (create/answer/finish/grade) are exercised live against a real
course; what is unit-tested here is the part with real branching: how a paper is drawn
from the pool, and how a score reports what it does and does not know.
"""

from app.supplemental.study.exams import _score, _stratify


def _pool(spec):
    """spec: {chapter: {section: n_items}} → the tagged pool rows _stratify consumes."""
    out = []
    for chapter, sections in spec.items():
        for section, n in sections.items():
            for i in range(n):
                out.append({"key": f"{section}-{i}", "sectionKey": section, "chapter": chapter})
    return out


def test_stratify_takes_per_chapter_from_each_chapter():
    pool = _pool({"toc:1": {"toc:1.1": 10}, "toc:2": {"toc:2.1": 10}})
    picked = _stratify(pool, 3)
    assert len(picked) == 6
    assert sum(1 for k in picked if k.startswith("toc:1.1")) == 3
    assert sum(1 for k in picked if k.startswith("toc:2.1")) == 3


def test_stratify_spreads_across_sections_so_one_long_section_cannot_crowd_out_the_rest():
    # A section with 20 items must not eat a 4-item paper while two others contribute none.
    pool = _pool({"toc:1": {"toc:1.1": 20, "toc:1.2": 3, "toc:1.3": 3}})
    picked = _stratify(pool, 4)
    sections = {k.rsplit("-", 1)[0] for k in picked}
    assert len(picked) == 4
    assert sections == {"toc:1.1", "toc:1.2", "toc:1.3"} or len(sections) >= 3


def test_stratify_takes_what_exists_when_a_chapter_is_short():
    pool = _pool({"toc:1": {"toc:1.1": 2}})
    assert len(_stratify(pool, 5)) == 2


def test_stratify_of_an_empty_pool_is_empty():
    assert _stratify([], 5) == []


def test_score_counts_three_and_four_as_answered_well():
    graded = [{"selfGrade": g} for g in (1, 2, 3, 4)]
    assert _score(graded) == {"graded": 4, "good": 2, "fraction": 0.5}


def test_score_of_nothing_graded_is_unknown_not_zero():
    # The honesty rule the whole measurement layer follows: an absent measurement is
    # never rendered as a bad one.
    assert _score([]) == {"graded": 0, "good": 0, "fraction": None}
