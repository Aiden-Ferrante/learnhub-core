"""Tests for block→outline assignment (pure, no ArangoDB).

Regression data mirrors "A Philosophy of Software Design, 2nd Ed.": extracted headings
keep their section numbers, chapter headings carry subtitles the bookmarks lack, the
font drops fi/ff ligature glyphs ("Complexity dened"), and the book's own contents
pages repeat chapter titles verbatim on early pages.
"""

from app.process.content.outline import assign_blocks_to_outline, build_outline_from_bookmarks

RAW_BOOKMARKS = [
    {"level": 1, "title": "Contents", "page": 4},
    {"level": 1, "title": "Preface", "page": 10},
    {"level": 1, "title": "1. Introduction", "page": 14},
    {"level": 2, "title": "1.1 How to use this book", "page": 17},
    {"level": 1, "title": "2. The Nature of Complexity", "page": 19},
    {"level": 2, "title": "2.1 Complexity defined", "page": 19},
    {"level": 2, "title": "2.2 Symptoms of complexity", "page": 21},
    {"level": 1, "title": "5. Information Hiding (and Leakage)", "page": 44},
    {"level": 2, "title": "5.1 Information hiding", "page": 44},
    {"level": 2, "title": "5.2 Information leakage", "page": 45},
]

BLOCKS = [
    (0, "Contents", 4),
    # Contents-page lines rendered as headings: same numbers/titles, wrong pages.
    (1, "5  Information Hiding (and Leakage)", 5),
    (2, "Preface", 10),
    (3, "Chapter 1 Introduction (It's All About Complexity)", 14),
    (4, "1.1  How to use this book", 17),
    (5, "Chapter 2 The Nature of Complexity", 19),
    (6, "2.1  Complexity dened", 19),  # ligature dropped: "defined"
    (7, "2.2  Symptoms of complexity", 21),
    (8, "Chapter 5", 44),
    (9, "Information Hiding (and Leakage)", 44),
    (10, "5.1  Information hiding", 44),
    (11, "Red Flag: Temporal Decomposition", 45),  # no TOC entry → folds into current
    (12, "5.2  Information leakage", 45),
]


def test_numbered_headings_map_to_their_own_sections():
    outline = build_outline_from_bookmarks(RAW_BOOKMARKS)
    bmap = assign_blocks_to_outline(outline, BLOCKS)
    assert bmap[3] == "toc:1"  # subtitle on the heading, number still wins
    assert bmap[4] == "toc:1.1"
    assert bmap[6] == "toc:2.1"  # ligature-mangled title, number wins
    assert bmap[7] == "toc:2.2"
    assert bmap[10] == "toc:5.1"
    assert bmap[12] == "toc:5.2"


def test_contents_page_lines_do_not_hijack_the_pointer():
    outline = build_outline_from_bookmarks(RAW_BOOKMARKS)
    bmap = assign_blocks_to_outline(outline, BLOCKS)
    # The contents-page "5 Information Hiding" line (page 5 vs bookmark page 44) must not
    # advance the pointer past chapters 1-4; it folds into the contents section instead.
    assert bmap[1] == "toc:contents"
    assert bmap[2] == "toc:preface"


def test_unlisted_subheadings_fold_into_current_section():
    outline = build_outline_from_bookmarks(RAW_BOOKMARKS)
    bmap = assign_blocks_to_outline(outline, BLOCKS)
    assert bmap[9] == "toc:5"  # chapter title line
    assert bmap[11] == "toc:5.1"  # "Red Flag" box folds into the section it sits in


def test_ligature_collapse_matches_titles_without_numbers():
    outline = build_outline_from_bookmarks(
        [{"level": 1, "title": "Defining the field", "page": 3}]
    )
    bmap = assign_blocks_to_outline(outline, [(0, "Dening the eld", 3)])
    assert bmap[0] == "toc:defining-the-field"


def test_legacy_two_tuple_blocks_still_work():
    outline = build_outline_from_bookmarks(RAW_BOOKMARKS)
    bmap = assign_blocks_to_outline(outline, [(0, "Preface"), (1, "2.1 Complexity defined")])
    assert bmap[0] == "toc:preface"
    assert bmap[1] == "toc:2.1"
