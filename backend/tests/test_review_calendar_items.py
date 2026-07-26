"""Review-calendar item lists (TASK-25) — the agenda's data contract.

The calendar used to carry counts only, so the /study grid could say "3" and nothing
else; the agenda needs to say WHAT is due. These pin the naming fallback chain and the
cap-with-a-flag rule (counts stay exact; the item list never silently truncates).
"""

from __future__ import annotations

from app.supplemental.study.calendar import _add, _bucket, _item_name, _shape_items


def test_item_name_prefers_heading_then_concept_then_section():
    assert _item_name({"heading": "2 The Nature of Complexity"}) == "2 The Nature of Complexity"
    assert _item_name({"heading": "  ", "conceptName": "Design alternatives"}) == "Design alternatives"
    assert _item_name({"heading": None, "conceptName": None, "sectionKey": "toc:11"}) == "toc:11"
    assert _item_name({}) == "Review item"  # legacy row with nothing at all


def test_bucket_collects_items_alongside_counts():
    b = _bucket()
    _add(b, "docA", "Course A", "concept", {"key": "c1", "name": "Modules", "type": "concept"})
    _add(b, "docA", "Course A", "skeleton", {"key": "s1", "name": "Ch 2", "type": "skeleton"})
    _add(b, "docB", "Course B", "concept", {"key": "c2", "name": "Joins", "type": "concept"})

    shaped = _shape_items(b)
    assert shaped["total"] == 3
    assert [i["name"] for i in shaped["items"]] == ["Modules", "Ch 2", "Joins"]
    assert shaped["itemsTruncated"] == 0
    # counts per course/type survive unchanged
    by_doc = {c["doc"]: c for c in shaped["courses"]}
    assert by_doc["docA"]["count"] == 2 and by_doc["docA"]["byType"] == {"concept": 1, "skeleton": 1}


def test_item_list_caps_but_totals_stay_exact():
    """A huge day sends a slice + how many it left out — never a silent truncation."""
    b = _bucket()
    for i in range(120):
        _add(b, "docA", "Course A", "concept", {"key": f"c{i}", "name": f"Concept {i}", "type": "concept"})

    shaped = _shape_items(b)
    assert shaped["total"] == 120  # the number the calendar square shows
    assert len(shaped["items"]) == 50
    assert shaped["itemsTruncated"] == 70


def test_add_without_item_still_counts():
    b = _bucket()
    _add(b, "docA", "Course A", "concept")
    assert _shape_items(b) == {
        "total": 1,
        "courses": [{"doc": "docA", "title": "Course A", "count": 1, "byType": {"concept": 1}}],
        "items": [],
        "itemsTruncated": 1,
    }
