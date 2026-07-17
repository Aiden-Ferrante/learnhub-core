"""Tests for view-time mastery math (coverage x accuracy x decay) and tree rollup.

Pure functions only — no ArangoDB. A fixed ``now`` makes decay deterministic.
"""

import math

from app.supplemental.study.mastery import (
    collect_sections,
    compute_leaf_mastery,
    descendant_leaves,
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


# --- compute_leaf_mastery ---

def test_no_events_is_zero():
    st = compute_leaf_mastery([], {"a", "b"}, 2, NOW, 1, 1, 14)
    assert st["mastery"] == 0.0
    assert st["attempts"] == 0
    assert st["lastSeen"] is None


def test_coverage_accuracy_decay_product():
    events = [
        {"concept_key": "a", "correct": True, "ts": NOW},
        {"concept_key": "b", "correct": True, "ts": NOW},
    ]
    st = compute_leaf_mastery(events, {"a", "b", "c", "d"}, 4, NOW, 1, 1, 14)
    assert st["coverage"] == 0.5  # 2 of 4 content triples tested
    assert st["accuracy"] == (2 + 1) / (2 + 2)  # Beta(1,1) posterior mean = 0.75
    assert st["decay"] == 1.0  # answered "now"
    assert math.isclose(st["mastery"], 0.5 * 0.75 * 1.0)


def test_accuracy_is_smoothed_not_raw():
    # one lucky correct answer must NOT read as 100% accuracy
    events = [{"concept_key": "a", "correct": True, "ts": NOW}]
    st = compute_leaf_mastery(events, {"a"}, 1, NOW, 1, 1, 14)
    assert st["accuracy"] == (1 + 1) / (1 + 2)  # 0.666...
    assert st["accuracy"] < 1.0


def test_decay_halves_around_tau():
    events = [{"concept_key": "a", "correct": True, "ts": NOW - 14 * DAY}]
    st = compute_leaf_mastery(events, {"a"}, 1, NOW, 1, 1, 14)
    assert math.isclose(st["decay"], math.exp(-1))  # dt == tau → exp(-1)


def test_tested_triples_outside_content_dont_count_coverage():
    events = [{"concept_key": "ghost", "correct": True, "ts": NOW}]
    st = compute_leaf_mastery(events, {"a", "b"}, 2, NOW, 1, 1, 14)
    assert st["coverage"] == 0.0  # 'ghost' is not a content triple
    assert st["mastery"] == 0.0


# --- tree structure helpers ---

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


# --- Retrievability from spaced-rep stability (decay ← SM-2 interval) ----------

def test_stability_tau_scales_with_interval():
    from app.supplemental.study.mastery import _stability_tau, _retention_k

    k = _retention_k()  # tau = k * interval, so retrievability = R at the due date
    # Never-reviewed unit falls back to the global default tau.
    assert _stability_tau(None, 14.0) == 14.0
    assert _stability_tau(0, 14.0) == 14.0
    # A fragile concept (short interval) decays faster than the default; a stable one slower.
    assert _stability_tau(1, 14.0) < 14.0
    assert _stability_tau(30, 14.0) > 14.0
    # tau = k * interval for reviewed units.
    assert math.isclose(_stability_tau(6, 14.0), k * 6, rel_tol=1e-9)


def test_decay_hits_retention_target_at_due_date():
    from app.supplemental.study.mastery import _stability_tau

    # By construction, retrievability exp(-interval/tau) == retention target (0.9 default)
    # when dt equals the concept's SM-2 interval.
    for interval in (1.0, 6.0, 30.0):
        tau = _stability_tau(interval, 14.0)
        assert math.isclose(math.exp(-interval / tau), 0.9, rel_tol=1e-6)
