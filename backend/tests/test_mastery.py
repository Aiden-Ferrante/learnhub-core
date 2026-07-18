"""Tests for view-time memory-state math (coverage + FSRS retention) and tree rollup.

Pure functions only — no DB. Retention values are injected directly, so the FSRS
model itself is exercised in test_srs.py; here we test the aggregation + buckets.
"""

from app.supplemental.study.mastery import (
    RETENTION_SHAKY,
    RETENTION_SOLID,
    collect_sections,
    descendant_leaves,
    retention_state,
    summarize_memory,
)

NOW = 1_000_000.0
DAY = 86_400.0


def _section(key, children=None, title=None):
    return {
        "id": key,
        "label": key,
        "title": title,
        "sectionKey": key,
        "isSection": True,
        "children": children or [],
    }


def _entity(name):
    return {"id": name, "label": name, "sectionKey": None, "isSection": False, "children": []}


# --- retention buckets + unit summary ---

def test_retention_state_buckets():
    assert retention_state(None) == "new"
    assert retention_state(RETENTION_SOLID) == "solid"
    assert retention_state(0.95) == "solid"
    assert retention_state(0.8) == "shaky"
    assert retention_state(RETENTION_SHAKY) == "shaky"
    assert retention_state(0.69) == "fading"
    assert retention_state(0.0) == "fading"


def test_summarize_memory_never_reviewed_is_new():
    m = summarize_memory(["c1", "c2"], {})
    assert m == {"total": 2, "reviewed": 0, "coverage": 0.0, "retention": None,
                 "state": "new", "fading": 0}


def test_summarize_memory_coverage_and_mean_retention():
    m = summarize_memory(["c1", "c2", "c3", "c4"], {"c1": 1.0, "c2": 0.8})
    assert m["total"] == 4 and m["reviewed"] == 2
    assert m["coverage"] == 0.5
    assert abs(m["retention"] - 0.9) < 1e-9
    assert m["state"] == "solid"  # mean sits exactly on the solid line
    assert m["fading"] == 0


def test_summarize_memory_counts_fading_items():
    m = summarize_memory(["c1", "c2", "c3"], {"c1": 0.95, "c2": 0.5, "c3": 0.65})
    assert m["fading"] == 2
    assert m["state"] == "shaky"  # mean 0.7 — on the shaky floor
    assert m["coverage"] == 1.0


def test_summarize_memory_empty_section():
    m = summarize_memory([], {"c1": 0.9})
    assert m["total"] == 0 and m["coverage"] == 0.0 and m["state"] == "new"


def test_retention_ignores_keys_outside_the_section():
    # Reviews for other sections' concepts (or skel-/chap- typed rows) never leak in.
    m = summarize_memory(["c1"], {"other": 0.1, "skel-abc": 0.2})
    assert m["reviewed"] == 0 and m["state"] == "new"


def test_collect_sections_skips_entities_and_maps_children():
    forest = [
        _section("toc:1", children=[_section("toc:1.1", children=[_entity("Bar")]), _entity("Foo")]),
        _section("toc:2"),
    ]
    labels, titles, children = collect_sections(forest)
    assert set(labels) == {"toc:1", "toc:1.1", "toc:2"}
    assert set(titles) == {"toc:1", "toc:1.1", "toc:2"}
    assert children["toc:1"] == ["toc:1.1"]  # entity 'Foo' excluded
    assert children["toc:1.1"] == []  # entity 'Bar' excluded
    assert children["toc:2"] == []


def test_descendant_leaves():
    forest = [_section("toc:1", children=[_section("toc:1.1"), _section("toc:1.2")])]
    _labels, _titles, children = collect_sections(forest)
    assert sorted(descendant_leaves("toc:1", children)) == ["toc:1.1", "toc:1.2"]
    assert descendant_leaves("toc:1.1", children) == ["toc:1.1"]  # leaf returns itself


def test_descendant_leaves_terminates_on_cycle():
    # A cyclic has_subsection chain (toc:1 -> toc:1.1 -> toc:1) must not recurse
    # forever; the repeated node is treated as a leaf so the walk terminates.
    children = {"toc:1": ["toc:1.1"], "toc:1.1": ["toc:1"]}
    assert descendant_leaves("toc:1", children) == ["toc:1"]
