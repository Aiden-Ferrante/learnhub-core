"""Tests for concept-course extraction (pure functions, no LLM, no DB)."""

from app.concepts_extract import (
    concept_key,
    normalize_concept_name,
    parse_concepts_response,
    resolve_prereq_pairs,
)

MODEL_OUT = {
    "concepts": [
        {
            "name": "d-separation",
            "kind": "definition",
            "signal": "A set Z d-separates X from Y when Z blocks every path between them.",
            "source_sentence": "Definition 1.2.3 (d-Separation). A path p is blocked by Z if ...",
            "questions": [
                {"q": "When does a set Z d-separate X and Y?", "a": "When Z blocks every path between them."},
                {"q": "", "a": "x"},  # dropped: empty question
            ],
            "prerequisites": ["path", "collider", "d-separation"],  # self-ref dropped
        },
        {"name": "", "kind": "theorem", "signal": "x", "questions": []},  # dropped: no name
        {
            "name": "**Path**",
            "kind": "not-a-kind",  # clamped → result
            "signal": "A path is a sequence of consecutive edges in a graph.",
            "questions": [],
            "prerequisites": [],
        },
    ]
}


def test_parse_concepts_valid_and_clamped():
    cs = parse_concepts_response(MODEL_OUT)
    assert len(cs) == 2  # empty-name concept dropped
    c0 = cs[0]
    assert c0.name == "d-separation" and c0.kind == "definition"
    assert len(c0.questions) == 1  # empty question dropped
    assert set(c0.prereq_names) == {"path", "collider"}  # self-reference excluded
    assert cs[1].name == "Path"  # markup stripped
    assert cs[1].kind == "result"  # invalid kind clamped


def test_parse_non_dict_and_missing_signal():
    assert parse_concepts_response("nope") == []
    assert parse_concepts_response({"concepts": [{"name": "x", "kind": "result", "signal": "", "questions": []}]}) == []


def test_concept_key_case_insensitive_and_scoped():
    a = concept_key("doc", "toc:1", "D-Separation")
    assert a == concept_key("doc", "toc:1", "d-separation")
    assert a != concept_key("doc", "toc:2", "d-separation")  # different section = different concept


def test_resolve_prereq_pairs():
    concepts = [
        ("k1", "d-separation", ["path", "collider", "unknown concept"]),
        ("k2", "path", []),
        ("k3", "collider", ["path"]),
    ]
    pairs = set(resolve_prereq_pairs(concepts))
    assert ("k1", "k2") in pairs  # d-separation requires path
    assert ("k1", "k3") in pairs  # d-separation requires collider
    assert ("k3", "k2") in pairs  # collider requires path
    assert all(a != b for a, b in pairs)  # no self-edges
    assert "unknown concept" not in {b for _, b in pairs}  # unresolved name dropped


def test_normalize_concept_name():
    assert normalize_concept_name("  **Bayes' rule**  ") == "Bayes' rule"
