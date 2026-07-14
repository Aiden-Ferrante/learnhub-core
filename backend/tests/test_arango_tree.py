"""Tests for pure TOC-tree assembly (no ArangoDB)."""

from app.content.arango_tree import (
    _chapter_titles,
    _is_bare_chapter_number,
    apply_section_titles,
    build_nested_tree,
    enrich_tree_with_section_mentions,
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


def _edges(*pairs):
    return [{"parentName": p, "childName": c} for p, c in pairs]


def test_build_nested_tree_sorts_numerically():
    # toc:1.2 must come before toc:1.10 (numeric, not lexicographic).
    forest = build_nested_tree(
        _edges(("toc:1", "toc:1.10"), ("toc:1", "toc:1.2"))
    )
    assert len(forest) == 1
    child_ids = [c.id for c in forest[0].children]
    assert child_ids == ["toc:1.2", "toc:1.10"]


def test_enrich_attaches_section_mention_entities():
    # Regression: enrich_tree_with_section_mentions used to define its inner
    # visitor but never call it, so entity leaves were silently dropped.
    forest = build_nested_tree(_edges(("toc:1", "toc:1.1")))
    enrich_tree_with_section_mentions(forest, {"toc:1.1": ["Entropy", "Gradient"]})

    leaf = forest[0].children[0]
    assert [c.label for c in leaf.children] == ["Entropy", "Gradient"]
    assert all(not c.id.startswith("toc:") for c in leaf.children)


def test_apply_section_titles_sets_heading_on_sections_only():
    forest = build_nested_tree(_edges(("toc:1", "toc:1.1")))
    apply_section_titles(forest, {"toc:1": "Introduction"})
    assert forest[0].title == "Introduction"
    assert forest[0].children[0].title is None
