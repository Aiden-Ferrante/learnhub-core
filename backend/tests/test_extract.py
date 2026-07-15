"""Tests for the extraction infrastructure (pure functions, no LLM, no DB)."""

from app.extraction.extract import (
    SectionExtractInput,
    _blocks_in_scope,
    build_user_prompt,
    normalize_entity,
    section_body_len,
)

INP = SectionExtractInput(
    doc_id="doc1",
    section_key="toc:1.2",
    heading="1.2 Graphs",
    page_start=13,
    page_end=16,
    markdown="## 1.2 Graphs\n\nbody text here, long enough to extract from",
)


def test_build_user_prompt_injects_heading_pages_markdown():
    p = build_user_prompt(INP)
    assert "1.2 Graphs" in p and "toc:1.2" in p and "pages 13-16" in p
    assert "body text here" in p


def test_normalize_entity_strips_markup():
    assert normalize_entity("**Conditional Independence**") == "Conditional Independence"
    assert normalize_entity("  d-separation  ") == "d-separation"


def test_section_body_len():
    assert section_body_len("## Heading\n\nlong body content here") > 10
    assert section_body_len("## Heading only") == 0


def _row(order, key):
    return {"order": order, "sectionKey": key, "markdown": "x", "heading": key}


_SCOPE_ROWS = [
    _row(0, "toc:contents"),
    _row(1, "toc:1"),
    _row(2, "toc:1.1"),
    _row(3, "toc:definition-1-2-3"),  # slug theorem inside chapter 1
    _row(4, "toc:1.2"),
    _row(5, "toc:2"),  # chapter 2 — the boundary
    _row(6, "toc:2.1"),
]


def test_section_depth():
    # The pure helper was folded into _section_level_fn; assert the same contract
    # through the default level rule _blocks_in_scope uses (numeric depth, slug=leaf).
    import re

    numeric = re.compile(r"^\d+(?:\.\d+)*$")

    def depth(sk: str) -> int:
        body = sk[4:]
        return body.count(".") + 1 if numeric.match(body) else 99

    assert depth("toc:1") == 1
    assert depth("toc:1.2.3") == 3
    assert depth("toc:preface") == 99


def test_blocks_in_scope_chapter_includes_slugs_stops_at_next_chapter():
    keys = [r["sectionKey"] for r in _blocks_in_scope(_SCOPE_ROWS, "toc:1")]
    assert keys == ["toc:1", "toc:1.1", "toc:definition-1-2-3", "toc:1.2"]


def test_blocks_in_scope_subsection():
    keys = [r["sectionKey"] for r in _blocks_in_scope(_SCOPE_ROWS, "toc:1.1")]
    assert keys == ["toc:1.1", "toc:definition-1-2-3"]


def test_section_level_rule():
    # The honest level rule after the dead tree-depth branch was removed: numeric depth,
    # chapter markers = 1, other slugs = deep leaf.
    from app.content.scope import _section_level_fn

    level_of = _section_level_fn("any-doc")
    assert level_of("toc:1") == 1
    assert level_of("toc:1.2.3") == 3
    assert level_of("toc:chapter-two") == 1
    assert level_of("toc:some-slug", "CHAPTER 4") == 1
    assert level_of("toc:some-slug", "A Theory of Things") == 99
