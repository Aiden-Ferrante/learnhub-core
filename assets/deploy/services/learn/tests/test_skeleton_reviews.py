"""Skeleton items in the review system — the pure helpers behind the walk→SRS wiring."""

from app.concept_study_routes import (
    SKELETON_KEY_PREFIX,
    clean_skeleton_children,
    skeleton_card,
    skeleton_review_key,
)


def test_skeleton_review_key_is_deterministic_and_prefixed():
    a = skeleton_review_key("doc1", "toc:1.2")
    assert a == skeleton_review_key("doc1", "toc:1.2")
    assert a.startswith(SKELETON_KEY_PREFIX)
    assert len(a) == len(SKELETON_KEY_PREFIX) + 16


def test_skeleton_review_key_varies_by_doc_and_section():
    base = skeleton_review_key("doc1", "toc:1.2")
    assert skeleton_review_key("doc2", "toc:1.2") != base
    assert skeleton_review_key("doc1", "toc:1.3") != base


def test_clean_skeleton_children_sanitizes_and_drops_junk():
    cleaned = clean_skeleton_children(
        [
            {"heading": " 1.1 Reliability ", "essence": " Systems keep working despite faults "},
            {"heading": "1.2 Scalability"},  # essence optional
            {"heading": "   "},  # blank heading dropped
            "not-a-dict",
            {"essence": "orphan essence"},  # no heading dropped
        ]
    )
    assert cleaned == [
        {"heading": "1.1 Reliability", "essence": "Systems keep working despite faults"},
        {"heading": "1.2 Scalability", "essence": ""},
    ]


def test_clean_skeleton_children_non_list_is_empty():
    assert clean_skeleton_children(None) == []
    assert clean_skeleton_children({"heading": "x"}) == []


def test_skeleton_card_shape_and_fallbacks():
    row = {
        "_key": "skel-abc",
        "heading": "1.2 Scalability",
        "sectionKey": "toc:1.2",
        "chapterScope": "toc:1",
        "children": [{"heading": "1.2.1 Load", "essence": "Describe load with load parameters"}],
        "state": "review",
        "due": 123.0,
        "ease": 2.5,
    }
    card = skeleton_card(row)
    assert card["itemType"] == "skeleton"
    assert card["conceptKey"] == "skel-abc"
    assert card["name"] == "1.2 Scalability"
    assert card["kind"] == "skeleton"
    assert card["children"] == row["children"]
    assert card["state"] == "review"
    assert card["due"] == 123.0
    # Scheduler internals stay off the card.
    assert "ease" not in card

    bare = skeleton_card({"_key": "skel-x", "sectionKey": "toc:2"})
    assert bare["name"] == "toc:2"  # heading falls back to the section key
    assert bare["children"] == []
    assert bare["state"] == "review"
