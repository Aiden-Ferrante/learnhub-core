"""Tests for pure TOC-tree assembly (no DB)."""

from app.process.content.toc_tree import (
    _chapter_titles,
    _is_bare_chapter_number,
    apply_section_titles,
    build_tree_from_outline,
)


def _blocks(*rows):
    return [{"key": k, "heading": h, "order": o} for o, (k, h) in enumerate(rows)]


def test_chapter_titles_pick_slug_heading_before_first_subsection():
    blocks = _blocks(
        ("toc:contents", "Contents"),
        ("toc:chapter-one", "CHAPTER ONE"),
        ("toc:introduction-to-probabilities", "Introduction to Probabilities, Graphs, and Causal Models"),
        ("toc:1.1", "1.1 INTRODUCTION TO PROBABILITY THEORY"),
        ("toc:chapter-two", "CHAPTER TWO"),
        ("toc:a-theory-of-inferred-causation", "A Theory of Inferred Causation"),
        ("toc:2.1", "2.1 INTRODUCTION"),
    )
    titles = _chapter_titles(blocks)
    # The 'CHAPTER N' label and front-matter are skipped; the real title wins.
    assert titles["toc:1"] == "Introduction to Probabilities, Graphs, and Causal Models"
    assert titles["toc:2"] == "A Theory of Inferred Causation"


def test_is_bare_chapter_number():
    assert _is_bare_chapter_number("1", 1)
    assert _is_bare_chapter_number("1.", 1)
    assert _is_bare_chapter_number(" 2 ", 2)
    assert not _is_bare_chapter_number("1.1 Intro", 1)
    assert not _is_bare_chapter_number("Introduction", 1)


def _outline(*rows):
    return [
        {"sectionKey": sk, "title": title, "numberKey": num, "listDepth": depth}
        for sk, title, num, depth in rows
    ]


def test_build_tree_from_outline_nests_by_list_depth():
    forest = build_tree_from_outline(
        _outline(
            ("toc:1", "Introduction", "1", 0),
            ("toc:1.1", "Background", "1.1", 1),
            ("toc:1.2", "Scope", "1.2", 1),
            ("toc:2", "Methods", "2", 0),
        )
    )
    assert [n.id for n in forest] == ["toc:1", "toc:2"]
    assert [c.id for c in forest[0].children] == ["toc:1.1", "toc:1.2"]
    assert forest[1].children == []


def test_build_tree_from_outline_skips_duplicates_and_non_toc():
    forest = build_tree_from_outline(
        _outline(
            ("toc:1", "Intro", "1", 0),
            ("toc:1", "Intro again", "1", 0),  # duplicate key — skipped
            (None, "No key", "", 0),  # keyless — skipped
        )
    )
    assert len(forest) == 1


def test_apply_section_titles_sets_heading_on_sections_only():
    forest = build_tree_from_outline(
        _outline(("toc:1", "", "1", 0), ("toc:1.1", "", "1.1", 1))
    )
    apply_section_titles(forest, {"toc:1": "Introduction"})
    assert forest[0].title == "Introduction"
    assert forest[0].children[0].title is None


def test_drop_orphan_parts_keeps_numbered_childless_chapters():
    """PoSD ch. 11 "Design it Twice" regression: a numbered chapter with no subsections,
    followed by a child-bearing chapter, must NOT be dropped as an orphan Part — while a
    slug-keyed childless "Part" container before a chaptered node still is."""
    from app.process.content.toc_tree import TreeNode, _drop_orphan_parts

    ch10 = TreeNode(id="toc:10", label="10", children=[TreeNode(id="toc:10.1", label="10.1")])
    ch11 = TreeNode(id="toc:11", label="11")                      # childless, numbered
    ch12 = TreeNode(id="toc:12", label="12", children=[TreeNode(id="toc:12.1", label="12.1")])
    part = TreeNode(id="toc:part-ii", label="Part II")            # childless, slug "Part"

    kept = _drop_orphan_parts([ch10, ch11, ch12])
    assert [n.id for n in kept] == ["toc:10", "toc:11", "toc:12"]

    kept = _drop_orphan_parts([part, ch12])
    assert [n.id for n in kept] == ["toc:12"]
