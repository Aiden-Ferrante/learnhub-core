"""Figures woven into section markdown — the pure rendering helper."""

from app.process.content.elements import figure_markdown


def test_figure_markdown_image_plus_caption():
    md = figure_markdown("doc1", {"order": 16, "page": 29, "caption": "Figure 1-2. Two model types."})
    lines = md.split("\n")
    assert lines[0] == "![Figure 1-2. Two model types.](/api/learn/figure?doc=doc1&n=16)"
    assert lines[1] == "*Figure 1-2. Two model types.*"


def test_figure_markdown_brackets_in_caption_cannot_break_syntax():
    md = figure_markdown("doc1", {"order": 3, "page": 5, "caption": "Figure [see 2] compares."})
    assert md.startswith("![Figure (see 2) compares.](/api/learn/figure?doc=doc1&n=3)")
    assert "*Figure [see 2] compares.*" in md  # caption line keeps the original text


def test_figure_markdown_uncaptioned_gets_page_alt_and_no_caption_line():
    md = figure_markdown("doc1", {"order": 7, "page": 12, "caption": ""})
    assert md == "![Figure (page 12)](/api/learn/figure?doc=doc1&n=7)"
