"""TOC controller — route tests + the behavior lock.

The fixture (tests/fixtures/toc_posd.json) was captured from a real pymupdf conversion
of A Philosophy of Software Design BEFORE the controller existed: its ``expected``
blobs are the OLD inline canonical/bmap/normalize logic's frozen outputs. The lock
asserts the controller reproduces them exactly — including the overlay semantics on
the fixture's naturally-unmatched blocks — which is what makes the store.py wiring
provably a zero-behavior change.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.process.content.sections import SectionBlock
from app.process.content.toc_controller import (
    QUALITY_ABSENT,
    QUALITY_CLEAN,
    ROUTE_BOOKMARKS,
    ROUTE_DERIVED_CONTENTS,
    ROUTE_DERIVED_HEADINGS,
    ROUTE_NONE,
    ROUTE_PAGEMATCHED,
    resolve_toc,
)
from app.process.content.toc_strategies import TocDeriveContext
from app.process.content.toc_strategies.from_contents_pages import derive as derive_contents
from app.process.content.toc_strategies.from_headings import derive as derive_headings

_FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "toc_posd.json").read_text())


def _blocks() -> list[SectionBlock]:
    return [
        SectionBlock(
            section_key=b["section_key"], heading=b["heading"], level=b["level"],
            number_key=b["number_key"], order=b["order"], markdown="",
            page_start=b["page_start"], page_end=b["page_end"],
        )
        for b in _FIXTURE["blocks"]
    ]


def _resolve(variant: str):
    v = _FIXTURE["variants"][variant]
    return v["expected"], resolve_toc(v["raw_outline"], _blocks(), _FIXTURE["page_count"])


def _final_keys(blocks: list[SectionBlock], block_map: dict[int, str]) -> dict[str, str]:
    """Apply the overlay the way store.py does: only where present."""
    keys = {b.order: b.section_key for b in blocks}
    for order, ck in block_map.items():
        if ck:
            keys[order] = ck
    return {str(k): v for k, v in keys.items()}


# --------------------------------------------------------------------------- #
# Table-driven routes
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "variant, route, quality",
    [
        ("bookmarks", ROUTE_BOOKMARKS, QUALITY_CLEAN),
        ("pagematched", ROUTE_PAGEMATCHED, QUALITY_CLEAN),
        # absent no longer routes to none: derive_from_headings is implemented and
        # this fixture's blocks carry usable headings — the intended new behavior.
        ("absent", ROUTE_DERIVED_HEADINGS, QUALITY_ABSENT),
    ],
)
def test_route_table(variant, route, quality):
    _, res = _resolve(variant)
    assert res.route == route
    assert res.quality == quality
    # every resolution explains itself, ending with its route
    assert res.decisions and any(d.startswith("route:") for d in res.decisions)


# --------------------------------------------------------------------------- #
# toc_strategies — from-headings (font pass + text fallback) and contents pages
# --------------------------------------------------------------------------- #

def _mk(order, heading, level=1, number_key=None, page=None):
    return SectionBlock(
        section_key=f"toc:{number_key}" if number_key else f"toc:s{order}",
        heading=heading, level=level, number_key=number_key, order=order,
        markdown="", page_start=page, page_end=page,
    )


def _ctx(blocks=(), heading_pages=(), pages=(), pdf_bytes=None, page_count=20):
    return TocDeriveContext(
        pdf_bytes=pdf_bytes, blocks=list(blocks), heading_pages=list(heading_pages),
        pages=list(pages), page_count=page_count,
    )


def test_derive_absent_route_builds_structure_from_headings():
    """No bookmarks + real headings → a derived outline (text fallback: the fixture
    context has no PDF bytes) that reconciles onto most blocks."""
    _, res = _resolve("absent")
    assert res.route == ROUTE_DERIVED_HEADINGS
    assert res.outline_entries, "derived outline must not be empty"
    assert any((e.get("listDepth") or 0) == 0 for e in res.outline_entries), \
        "shift must yield depth-0 chapter entries"
    assert len(res.block_map) >= len(_blocks()) // 2, "derived outline should reconcile onto most blocks"
    log = "\n".join(res.decisions)
    assert "derive/from-headings:" in log and "entries" in log


def test_headings_text_numbered_depth_beats_markdown_level():
    # "2" → level 1, "2.1" → level 2, even though the markdown levels disagree.
    entries = derive_headings(_ctx(
        blocks=[_mk(0, "2 Complexity", level=3, number_key="2", page=4),
                _mk(1, "2.1 Defined", level=3, number_key="2.1", page=8),
                _mk(2, "3 Working Code", level=3, number_key="3", page=16)],
        page_count=20,
    ))
    assert [e["level"] for e in entries] == [1, 2, 1]


def test_headings_text_shifts_shallowest_level_to_one():
    # A book written entirely in ##/### still gets level-1 chapters.
    entries = derive_headings(_ctx(
        blocks=[_mk(0, "Alpha", level=2, page=1), _mk(1, "Beta", level=3, page=9),
                _mk(2, "Gamma", level=2, page=17)],
        page_count=20,
    ))
    assert [e["level"] for e in entries] == [1, 2, 1]


def test_headings_text_filters_junk_and_overlong():
    entries = derive_headings(_ctx(
        blocks=[_mk(0, "Real Chapter", page=1),
                _mk(1, "https://example.com/some/link", page=2),
                _mk(2, "ISBN 9781732102217", page=3),
                _mk(3, "x" * 200, page=4),
                _mk(4, "Middle Chapter", page=9),
                _mk(5, "Another Chapter", page=17)],
        page_count=20,
    ))
    assert [e["title"] for e in entries] == ["Real Chapter", "Middle Chapter", "Another Chapter"]


def test_headings_gate_declines_with_reason():
    out = derive_headings(_ctx(blocks=[_mk(0, "Only Heading", page=1)], page_count=5))
    assert isinstance(out, str) and "need 3" in out


def test_headings_gate_declines_concentrated_entries():
    # 5 headings all on one page of a 50-page book: not a credible TOC.
    out = derive_headings(_ctx(
        blocks=[_mk(i, f"Entry {i}", page=7) for i in range(5)], page_count=50,
    ))
    assert isinstance(out, str)


def test_headings_font_pass_clusters_sizes_into_levels():
    """A tiny generated PDF: 24pt titles on pages 1 and 3, a 12pt section on page 2 —
    size clusters must map to levels [1, 2, 1]."""
    fitz = pytest.importorskip("fitz")
    doc = fitz.open()
    for text, size in [("Alpha", 24), ("Beta Section", 12), ("Gamma", 24)]:
        page = doc.new_page()
        page.insert_text((72, 100), text, fontsize=size)
    pdf = doc.tobytes()
    doc.close()
    entries = derive_headings(_ctx(
        heading_pages=[("Alpha", 1), ("Beta Section", 2), ("Gamma", 3)],
        pdf_bytes=pdf, page_count=3,
    ))
    assert isinstance(entries, list)
    assert [e["level"] for e in entries] == [1, 2, 1]
    assert [e["page"] for e in entries] == [1, 2, 3]


def test_contents_pages_parses_dot_leaders_and_levels():
    pages = [
        (1, "Some Title Page\nby An Author"),
        (2, "Contents\n1 Introduction ........ 5\n2 Complexity ........ 9\n"
            "2.1 Defined ........ 10\n3 Working Code ........ 15\n4 Modules ........ 21"),
        (3, "Preface\nActual prose starts here, nothing like an entry."),
    ]
    entries = derive_contents(_ctx(pages=pages, page_count=30))
    assert isinstance(entries, list) and len(entries) == 5
    assert [e["level"] for e in entries] == [1, 1, 2, 1, 1]
    assert [e["page"] for e in entries] == [5, 9, 10, 15, 21]


def test_contents_pages_declines_without_contents_page():
    out = derive_contents(_ctx(pages=[(1, "Just prose"), (2, "More prose")], page_count=10))
    assert isinstance(out, str) and "Contents" in out


def test_controller_falls_through_to_contents_and_stamps_its_route():
    # from-headings has nothing to work with; the printed Contents carries the day.
    pages = [
        (1, "Table of Contents\n1 One ........ 3\n2 Two ........ 9\n"
            "3 Three ........ 15\n4 Four ........ 21\n5 Five ........ 27"),
    ]
    res = resolve_toc([], [], 30, pages=pages)
    assert res.route == ROUTE_DERIVED_CONTENTS
    log = "\n".join(res.decisions)
    assert "derive/from-headings: declined" in log
    assert "derive/from-contents-pages: 5 entries" in log


def test_hopeless_input_routes_none_with_every_decline_logged():
    res = resolve_toc([], [_mk(0, "Only Heading", page=1)], 5)
    assert res.route == ROUTE_NONE
    log = "\n".join(res.decisions)
    assert "derive/from-headings: declined (" in log
    assert "derive/from-contents-pages: declined (" in log
    assert "derive/from-llm: declined (not implemented)" in log


# --------------------------------------------------------------------------- #
# Behavior lock — controller output == frozen old-inline-logic output.
# (bookmark routes only: the absent route now intentionally diverges — deriving
# structure where the old logic silently produced none.)
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("variant", ["bookmarks", "pagematched"])
def test_behavior_lock(variant):
    expected, res = _resolve(variant)
    assert res.outline_entries == expected["outline_entries"]
    assert {str(k): v for k, v in res.block_map.items()} == expected["block_map"]
    # the overlay result: final effective key per block, unmatched blocks untouched
    blocks = _blocks()
    assert _final_keys(blocks, res.block_map) == expected["final_keys"]


def test_fixture_has_unmatched_blocks():
    """The overlay-semantics guard is only real if the fixture actually contains blocks
    the reconcile did NOT match (they must keep their splitter keys)."""
    expected, res = _resolve("bookmarks")
    unmatched = [b for b in _blocks() if b.order not in res.block_map]
    assert unmatched, "fixture must contain unmatched blocks to lock overlay semantics"
    for b in unmatched:
        assert expected["final_keys"][str(b.order)] == b.section_key


# --------------------------------------------------------------------------- #
# assess signals — clean | messy scoring (messy still routes like clean)
# --------------------------------------------------------------------------- #

from app.process.content.toc_controller import (  # noqa: E402
    QUALITY_MESSY,
    assess_bookmarks,
)


def _entries(n, *, level=1, start_page=1, step=10, title=None):
    return [
        {"level": level, "title": title or f"Chapter {i + 1}", "page": start_page + i * step}
        for i in range(n)
    ]


def test_assess_real_fixture_bookmarks_are_clean():
    quality, reasons = assess_bookmarks(
        _FIXTURE["variants"]["bookmarks"]["raw_outline"], _FIXTURE["page_count"]
    )
    assert quality == QUALITY_CLEAN and reasons == []


def test_assess_entry_ratio_sparse_toc_is_messy():
    quality, reasons = assess_bookmarks(_entries(3, step=150), page_count=500)
    assert quality == QUALITY_MESSY
    assert any(r.startswith("entry-ratio") for r in reasons)


def test_assess_nonmonotonic_pages_is_messy():
    entries = _entries(10)
    entries[3]["page"], entries[7]["page"] = 90, 2  # two hard regressions
    quality, reasons = assess_bookmarks(entries, page_count=100)
    assert quality == QUALITY_MESSY
    assert any(r.startswith("monotonic-pages") for r in reasons)


def test_assess_junk_titles_is_messy():
    entries = _entries(10)
    for i in range(4):  # 40% junk > 30% threshold
        entries[i]["title"] = "https://example.com/x" if i % 2 else "9781732102217"
    quality, reasons = assess_bookmarks(entries, page_count=100)
    assert quality == QUALITY_MESSY
    assert any(r.startswith("junk-titles") for r in reasons)


def test_assess_long_flat_outline_is_messy_but_short_flat_is_clean():
    messy_q, messy_r = assess_bookmarks(_entries(35, step=5), page_count=200)
    assert messy_q == QUALITY_MESSY
    assert any(r.startswith("depth-distribution") for r in messy_r)
    clean_q, _ = assess_bookmarks(_entries(12, step=15), page_count=200)
    assert clean_q == QUALITY_CLEAN


def test_messy_routes_like_clean_and_logs_reasons():
    """A messy outline still takes the bookmarks path — the label is the diagnosis."""
    raw = _FIXTURE["variants"]["bookmarks"]["raw_outline"]
    mangled = [
        {**e, "title": ("9781732102217" if i % 2 == 0 else e["title"])}
        for i, e in enumerate(raw)
    ]  # ~50% junk titles → messy, but structure/pages intact
    res = resolve_toc(mangled, _blocks(), _FIXTURE["page_count"])
    assert res.quality == QUALITY_MESSY
    assert res.route in (ROUTE_BOOKMARKS, ROUTE_PAGEMATCHED)
    log = "\n".join(res.decisions)
    assert "assess: messy (" in log and "junk-titles" in log
