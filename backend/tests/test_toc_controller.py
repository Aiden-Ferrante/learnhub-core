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
    QUALITY_PRESENT,
    ROUTE_BOOKMARKS,
    ROUTE_NONE,
    ROUTE_PAGEMATCHED,
    resolve_toc,
)

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
        ("bookmarks", ROUTE_BOOKMARKS, QUALITY_PRESENT),
        ("pagematched", ROUTE_PAGEMATCHED, QUALITY_PRESENT),
        ("absent", ROUTE_NONE, QUALITY_ABSENT),
    ],
)
def test_route_table(variant, route, quality):
    _, res = _resolve(variant)
    assert res.route == route
    assert res.quality == quality
    # every resolution explains itself, ending with its route
    assert res.decisions and any(d.startswith("route:") for d in res.decisions)


def test_absent_logs_each_derive_stub_loudly():
    _, res = _resolve("absent")
    log = "\n".join(res.decisions)
    assert "derive-from-headings not implemented" in log
    assert "derive-from-contents-page not implemented" in log
    assert res.outline_entries == [] and res.block_map == {}


# --------------------------------------------------------------------------- #
# Behavior lock — controller output == frozen old-inline-logic output
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("variant", ["bookmarks", "pagematched", "absent"])
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
