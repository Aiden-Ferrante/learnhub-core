"""Tests for page-primary provenance math (pure, no ArangoDB)."""

from app.content.arango_content import (
    SectionBlock,
    build_page_blocks,
    headings_starting_on_page,
    match_section_start_pages,
    page_section_paths,
    section_page_ranges,
)


def _sec(order, key, heading, level):
    return SectionBlock(
        section_key=key, heading=heading, level=level, number_key=None, order=order, markdown=""
    )


# toc:1 (p1) > {1.1 (p1), 1.2 (p3)}, then toc:2 (p5)
SECTIONS = [
    _sec(0, "toc:1", "1 Introduction", 1),
    _sec(1, "toc:1.1", "1.1 Probability", 2),
    _sec(2, "toc:1.2", "1.2 Graphs", 2),
    _sec(3, "toc:2", "2 Inference", 1),
]
HEADING_PAGES = [
    ("1 Introduction", 1),
    ("1.1 Probability", 1),
    ("1.2 Graphs", 3),
    ("2 Inference", 5),
]


def test_match_section_start_pages():
    assert match_section_start_pages(SECTIONS, HEADING_PAGES) == {0: 1, 1: 1, 2: 3, 3: 5}


def test_section_page_ranges_end_is_next_start_or_total():
    r = section_page_ranges(SECTIONS, HEADING_PAGES, total_pages=8)
    assert r[0] == (1, 1)  # toc:1 → next heading (1.1) also p1
    assert r[1] == (1, 3)  # 1.1 → next heading 1.2 on p3
    assert r[2] == (3, 5)
    assert r[3] == (5, 8)  # last → total
    starts = [r[o][0] for o in sorted(r)]
    assert starts == sorted(starts)  # monotonic non-decreasing


def test_page_section_paths_open_trail():
    paths = page_section_paths(SECTIONS, HEADING_PAGES, total_pages=6)
    assert paths[1] == ["toc:1", "toc:1.1"]
    assert paths[2] == ["toc:1", "toc:1.1"]  # still inside 1.1
    assert paths[3] == ["toc:1", "toc:1.2"]  # 1.2 replaces 1.1 (same level)
    assert paths[4] == ["toc:1", "toc:1.2"]
    assert paths[5] == ["toc:2"]  # chapter 2 (level 1) pops everything
    assert paths[6] == ["toc:2"]


def test_build_page_blocks_tags_pages():
    pages = [(n, f"page {n} text") for n in range(1, 7)]
    blocks = build_page_blocks(pages, SECTIONS, HEADING_PAGES, total_pages=6)
    assert [b.page_no for b in blocks] == [1, 2, 3, 4, 5, 6]
    assert blocks[0].section_path == ["toc:1", "toc:1.1"]
    assert blocks[0].markdown == "page 1 text"
    assert blocks[4].section_path == ["toc:2"]
    # headings that *start* on a page
    assert [h["sectionKey"] for h in blocks[0].headings] == ["toc:1", "toc:1.1"]
    assert [h["sectionKey"] for h in blocks[2].headings] == ["toc:1.2"]
    assert blocks[3].headings == []  # nothing starts on page 4


def test_section_path_uses_numeric_trail_not_slug_headings():
    # Theorems/definitions (slug keys) appear between numbered sections; they must NOT
    # become the breadcrumb — the page stays addressed by its numbered section.
    secs = [
        _sec(0, "toc:1", "1 Introduction", 1),
        _sec(1, "toc:1.2", "1.2 Graphs", 2),
        _sec(2, "toc:definition-1-2-3", "Definition 1.2.3 (d-separation)", 2),
        _sec(3, "toc:theorem-1-2-5", "Theorem 1.2.5", 2),
        _sec(4, "toc:1.3", "1.3 Causal Models", 2),
    ]
    hps = [
        ("1 Introduction", 1),
        ("1.2 Graphs", 5),
        ("Definition 1.2.3 (d-separation)", 6),
        ("Theorem 1.2.5", 7),
        ("1.3 Causal Models", 9),
    ]
    paths = page_section_paths(secs, hps, total_pages=10)
    assert paths[1] == ["toc:1"]
    assert paths[5] == ["toc:1", "toc:1.2"]
    assert paths[6] == ["toc:1", "toc:1.2"]  # definition doesn't change the breadcrumb
    assert paths[7] == ["toc:1", "toc:1.2"]  # nor theorem
    assert paths[9] == ["toc:1", "toc:1.3"]  # next numbered section advances it


def test_headings_starting_on_page():
    by_page = headings_starting_on_page(SECTIONS, HEADING_PAGES)
    assert {h["sectionKey"] for h in by_page[1]} == {"toc:1", "toc:1.1"}
    assert {h["sectionKey"] for h in by_page[3]} == {"toc:1.2"}
    assert {h["sectionKey"] for h in by_page[5]} == {"toc:2"}


def test_duplicate_headings_advance_pointer():
    secs = [_sec(0, "toc:preface", "Preface", 1), _sec(1, "toc:preface", "Preface", 1)]
    hps = [("Preface", 2), ("Preface", 7)]
    # the second 'Preface' must take page 7, not page 2 again
    assert match_section_start_pages(secs, hps) == {0: 2, 1: 7}


def test_markerless_input_yields_null_pages():
    # No heading_pages (old doc / pymupdf gave nothing) → no page data, gracefully.
    assert all(v == (None, None) for v in section_page_ranges(SECTIONS, [], 8).values())
    assert all(p == [] for p in page_section_paths(SECTIONS, [], 4).values())
    blocks = build_page_blocks([(1, "x"), (2, "y")], SECTIONS, [], total_pages=2)
    assert all(b.section_path == [] for b in blocks)


def test_unmatched_section_inherits_previous_page():
    # A heading missing from heading_pages inherits the prior section's page.
    hps = [("1 Introduction", 1), ("1.2 Graphs", 3), ("2 Inference", 5)]  # 1.1 missing
    r = section_page_ranges(SECTIONS, hps, total_pages=8)
    assert r[1][0] == 1  # toc:1.1 inherits page 1 from toc:1
