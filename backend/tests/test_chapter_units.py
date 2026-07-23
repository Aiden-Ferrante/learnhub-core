"""chapter_units must mirror the syllabus tree's top level exactly — the drift-proof
contract behind TASK-18 (Process build list vs course outline divergence).

The old derivation re-decided chapters with its own has_content gate + container
descent, which (a) silently dropped content-less visible nodes (PoSD's "Back
Cover") and (b) exploded content-bearing subtrees into phantom units (FoSA's
"Discussion Questions" children surfacing as 27 duplicate chapters). These tests
pin the new contract: same keys, same titles, same order as the visible tree;
content-lessness is a FLAG, never a filter.
"""

from __future__ import annotations

import app.process.content.chapters as chapters_mod
import app.process.content.scope as scope_mod
from app.process.content.toc_tree import build_tree_from_outline

# The FoSA + PoSD shapes in one fixture: numbered chapters, a slug container whose
# children carry content (the phantom-explosion trap), and a content-less tail node
# (the silent-drop trap).
OUTLINE = [
    {"sectionKey": "toc:1", "title": "Introduction", "numberKey": "1", "listDepth": 0},
    {"sectionKey": "toc:1.1", "title": "Why", "numberKey": "1.1", "listDepth": 1},
    {"sectionKey": "toc:2", "title": "Complexity", "numberKey": "2", "listDepth": 0},
    {"sectionKey": "toc:discussion-questions", "title": "Discussion Questions", "numberKey": "", "listDepth": 0},
    {"sectionKey": "toc:1~2", "title": "Introduction", "numberKey": "", "listDepth": 1},
    {"sectionKey": "toc:2~2", "title": "Complexity", "numberKey": "", "listDepth": 1},
    {"sectionKey": "toc:back-cover", "title": "Back Cover", "numberKey": "", "listDepth": 0},
]

CONTENT_KEYS = {"toc:1", "toc:1.1", "toc:2", "toc:discussion-questions", "toc:1~2", "toc:2~2"}


class _FakeCursor:
    def execute(self, *_a, **_k):
        return self

    def fetchall(self):
        return []


class _FakeDb:
    def __enter__(self):
        return _FakeCursor()

    def __exit__(self, *_a):
        return False


def _install(monkeypatch, forest):
    monkeypatch.setattr(chapters_mod, "resolve_doc_id", lambda d: "doc1")
    monkeypatch.setattr(chapters_mod, "get_toc_tree", lambda d: (forest, 0, None))
    monkeypatch.setattr(chapters_mod, "db", lambda: _FakeDb())
    monkeypatch.setattr(
        scope_mod, "scope_blocks",
        lambda doc, key, rows=None: [{"markdown": "x"}] if key in CONTENT_KEYS else [],
    )


def test_chapter_units_mirror_toc_tree_top_level(monkeypatch):
    forest = [n.as_dict() for n in build_tree_from_outline(OUTLINE)]
    _install(monkeypatch, forest)

    data = chapters_mod.chapter_units("doc1")

    tops = [(n["sectionKey"], n.get("title") or n.get("label")) for n in forest]
    units = [(u["key"], u["title"]) for u in data["chapters"]]
    assert units == tops  # same keys, same titles, same order — no drift possible


def test_container_children_are_never_promoted_to_units(monkeypatch):
    """The FoSA regression: content-bearing children under a slug container used to
    surface as their own phantom chapters (toc:1~2 …). They must stay inside."""
    forest = [n.as_dict() for n in build_tree_from_outline(OUTLINE)]
    _install(monkeypatch, forest)

    keys = [u["key"] for u in chapters_mod.chapter_units("doc1")["chapters"]]
    assert "toc:1~2" not in keys and "toc:2~2" not in keys
    assert keys.count("toc:1") == 1  # no duplicate titles/keys from the subtree


def test_content_less_units_are_flagged_not_dropped(monkeypatch):
    """The PoSD regression: 'Back Cover' is visible in the course tree, so it must be
    listed — flagged hasContent: False for consumers to disable, not filtered."""
    forest = [n.as_dict() for n in build_tree_from_outline(OUTLINE)]
    _install(monkeypatch, forest)

    units = {u["key"]: u for u in chapters_mod.chapter_units("doc1")["chapters"]}
    assert "toc:back-cover" in units
    assert units["toc:back-cover"]["hasContent"] is False
    assert units["toc:1"]["hasContent"] is True
