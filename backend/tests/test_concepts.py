"""Tests for concept-course extraction (pure functions, no LLM, no DB)."""

from app.process.extraction.concepts_extract import (
    concept_key,
    normalize_concept_name,
    parse_concepts_response,
)

MODEL_OUT = {
    "concepts": [
        {
            "name": "d-separation",
            "kind": "definition",
            "signal": "A set Z d-separates X from Y when Z blocks every path between them.",
            "source_sentence": "Definition 1.2.3 (d-Separation). A path p is blocked by Z if ...",
        },
        {"name": "", "kind": "theorem", "signal": "x"},  # dropped: no name
        {
            "name": "**Path**",
            "kind": "not-a-kind",  # clamped → result
            "signal": "A path is a sequence of consecutive edges in a graph.",
            # The grounding gate (LEARN_REQUIRE_SOURCE, default on) drops sourceless
            # concepts — this fixture must carry one to test the kind clamp.
            "source_sentence": "A path is a sequence of consecutive edges in a graph.",
        },
    ]
}


def test_parse_concepts_valid_and_clamped():
    cs = parse_concepts_response(MODEL_OUT)
    assert len(cs) == 2  # empty-name concept dropped
    c0 = cs[0]
    assert c0.name == "d-separation" and c0.kind == "definition"
    assert cs[1].name == "Path"  # markup stripped
    assert cs[1].kind == "result"  # invalid kind clamped


def test_parse_non_dict_and_missing_signal():
    assert parse_concepts_response("nope") == []
    assert parse_concepts_response({"concepts": [{"name": "x", "kind": "result", "signal": ""}]}) == []


def test_concept_key_case_insensitive_and_scoped():
    a = concept_key("doc", "toc:1", "D-Separation")
    assert a == concept_key("doc", "toc:1", "d-separation")
    assert a != concept_key("doc", "toc:2", "d-separation")  # different section = different concept


def test_normalize_concept_name():
    assert normalize_concept_name("  **Bayes' rule**  ") == "Bayes' rule"


def test_parse_concepts_stats_accounting():
    stats: dict = {}
    parse_concepts_response(MODEL_OUT, stats=stats)
    assert stats["raw"] == 3
    assert stats["malformed"] == 1
    assert "gated" not in stats  # both kept concepts are grounded


def test_split_markdown_chunks_lossless():
    from app.process.extraction.concepts_extract import _split_markdown_chunks

    md = "\n\n".join(f"para {i} " + "x" * 50 for i in range(10))
    chunks = _split_markdown_chunks(md, 120)
    assert len(chunks) > 1
    assert "\n\n".join(chunks) == md  # nothing dropped, nothing reordered


def test_match_renamed_concepts_carries_best_unique_match():
    from app.process.extraction.concepts_extract import match_renamed_concepts

    old = [("k1", "LLM"), ("k2", "Vector database")]
    new = [("n1", "Large language model (LLM)"), ("n2", "Vector databases"), ("n3", "Quantization")]
    m = match_renamed_concepts(old, new)
    assert m["k2"] == "n2"  # near-identical name
    assert m.get("k1") in (None, "n1")  # abbreviation expansion may or may not clear threshold
    assert len(set(m.values())) == len(m)  # each successor used at most once


def test_match_renamed_concepts_no_match_below_threshold():
    from app.process.extraction.concepts_extract import match_renamed_concepts

    m = match_renamed_concepts([("k1", "Bayes' rule")], [("n1", "Gradient descent")])
    assert m == {}


def test_eval_summarize_verdicts():
    from app.process.extraction.eval_gate import summarize_verdicts

    concepts = [{"name": "a", "sectionKey": "toc:1"}, {"name": "b", "sectionKey": "toc:1"},
                {"name": "c", "sectionKey": "toc:2"}]
    verdicts = [
        {"grounded": True, "informative": True, "durable": True, "reason": "ok"},
        {"grounded": True, "informative": False, "durable": True, "reason": "restates name"},
        None,  # critic unreachable for this one
    ]
    r = summarize_verdicts(concepts, verdicts)
    assert r["sampled"] == 3 and r["graded"] == 2 and r["passed"] == 1
    assert r["score"] == 0.5
    assert r["failures"][0]["name"] == "b" and r["failures"][0]["informative"] is False
