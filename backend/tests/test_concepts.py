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


# --------------------------------------------------------------------------- #
# Repairing what JSON and the tokenizer do to text the model was told to COPY.
# Both failures are invisible once _norm_part has collapsed whitespace, which is
# how they survived 1,463 stored concepts unnoticed (v0.20.0).
# --------------------------------------------------------------------------- #

import json as _json

from app.process.extraction.concepts_extract import repair_model_text


def test_json_escape_eats_a_latex_backslash_and_the_repair_puts_it_back():
    """The exact chain that corrupted production data.

    Generation is grammar-constrained, so the model emits *valid* JSON — and `\\t` is valid
    JSON. `\\text{` decodes to TAB + `ext{` entirely per spec; nothing is malformed and
    nothing raises.
    """
    raw = r'{"s": "$P(a \text{ and } b)$"}'
    decoded = _json.loads(raw)["s"]
    assert decoded == "$P(a \text{ and } b)$"          # TAB, not a backslash
    assert repair_model_text(decoded) == r"$P(a \text{ and } b)$"


def test_repair_covers_the_three_colliding_escapes_only():
    """t/b/f collide with real macros (\\text \\beta \\frac). \\n and \\r are left alone —
    a newline in copied prose is plausible, a `\\newline` is not."""
    assert repair_model_text("\theta and \binom and \frac") == r"\theta and \binom and \frac"
    assert repair_model_text("line one\nline two") == "line one\nline two"


def test_a_real_tab_between_words_is_not_rewritten():
    """The trailing-letter condition: a tab welded to `ext{` is a lost macro; a tab used as
    whitespace is whitespace. Without this, indentation would become `\\t` macros."""
    assert repair_model_text("col one\t col two") == "col one\t col two"


def test_source_text_decides_when_the_repair_is_ambiguous():
    """Given the section's own markdown, a repair is kept only if it makes the quote
    findable — the same rule the rest of extraction lives by."""
    damaged = "the \tension of the rope"                  # TAB + "ension" — looks like \tension
    assert repair_model_text(damaged, source_text="We measure the \tension of the rope.") == damaged
    assert repair_model_text(damaged, source_text=r"We measure the \tension here.") == r"the \tension of the rope"


def test_byte_fallback_tokens_decode_back_to_the_character():
    """A character the model knows only as byte-fallback tokens can detokenize to literal
    `<0xE2><0x84><0x92>`. That is never real prose, so decoding is unambiguous."""
    assert repair_model_text("<0xE2><0x84><0x92>(V, W) is a vector space") == "ℒ(V, W) is a vector space"
    assert repair_model_text("<0xZZ> stays") == "<0xZZ> stays"


def test_undecodable_byte_run_is_left_visible_rather_than_guessed():
    assert repair_model_text("<0xFF><0xFE>") == "<0xFF><0xFE>"


def test_parse_repairs_the_stored_field_not_just_the_helper():
    from app.process.extraction.concepts_extract import parse_concepts_response
    obj = {"concepts": [{"name": "Tensor product", "kind": "definition",
                         "signal": "A construction on two spaces.",
                         "source_sentence": "written $V \totimes W$ here"}]}
    got = parse_concepts_response(obj)
    assert got and got[0].source == r"written $V \totimes W$ here"


def test_newline_repair_needs_ground_truth():
    r"""\n collides with \not, \nabla, \neq — but an unverified newline+letter is just a
    wrapped line. Without source text the repair must not fire; with it, it may."""
    damaged = "holds when $x \not\to y$ here"          # newline + "ot", tab + "o"
    assert "\\not" not in repair_model_text(damaged)   # no ground truth -> left alone
    fixed = repair_model_text(damaged, source_text=r"It holds when $x \not\to y$ here.")
    assert fixed == r"holds when $x \not\to y$ here"


def test_a_wrapped_line_is_not_turned_into_a_macro():
    """The regression the risky set could cause: prose that legitimately wraps."""
    prose = "the first half\nof the sentence"
    assert repair_model_text(prose, source_text="the first half of the sentence") == prose


def test_reading_guides_get_the_same_repair_as_concepts():
    """v0.20.0 wired `repair_model_text` into concept extraction and stopped there, so the
    reading-guide path kept storing `Γ <0xE2><0x8A><0xA8> φ`. The v0.19.0 spike surfaced it
    in real output: 2 of 26 generated questions carried mojibake. A fix that reaches one
    consumer of a shared problem is not a fix."""
    import app.process.extraction.reading_guide as rg
    assert rg.repair_model_text is repair_model_text
    src = getattr(rg, "_validate", None) or rg
    import inspect
    body = inspect.getsource(rg)
    assert "repair_model_text(c.get(\"q\"))" in body and "repair_model_text(c.get(\"a\"))" in body, \
        "both halves of a check must be repaired, not just the question"
    assert repair_model_text("<0xE2><0x8A><0xA8> holds") == "⊨ holds"
