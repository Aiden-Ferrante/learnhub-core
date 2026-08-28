"""Practice items — the pure logic: furniture filter, authoring post-processing,
review keys, queue cards, and the production-fluency summary's three rules."""

from app.process.extraction import practice
from app.supplemental.study.mastery import summarize_fluency
from app.supplemental.study.reviews import (
    PRACTICE_KEY_PREFIX,
    _practice_card,
    practice_review_key,
)

# ── furniture tells — both spikes' observed failure shapes must be caught ────


def test_furniture_filter_catches_both_spike_tells():
    # spike 1: 23% of retrieval questions referenced the text itself
    assert practice._has_furniture("According to the text, what does logic supply?")
    # spike 2: procedural sections referenced the book's apparatus
    assert practice._has_furniture(
        "Write the exact command as shown in step 3 of Table 2-1."
    )
    assert practice._has_furniture("What is the primary purpose of this section?")
    assert practice._has_furniture("Per the definition given in Listing 4, refactor it.")
    # caught live on the first real run (2026-08-28): a section-symbol reference,
    # an "introduction" reference, and an adjective squeezed into "this … section"
    assert practice._has_furniture(
        "What does the quantified statement in §6 guarantee about network approximation?"
    )
    assert practice._has_furniture("Using the identity from section 3.2, simplify the sum.")
    assert practice._has_furniture(
        "According to the introduction, what role does logic play in interpreting claims?"
    )
    assert practice._has_furniture(
        "What will the learner not accomplish by studying this introductory section?"
    )


def test_furniture_filter_passes_subject_questions():
    assert not practice._has_furniture(
        "Construct a complete truth table for (P → Q) ↔ (¬Q → ¬P)."
    )
    assert not practice._has_furniture(
        "If you replace UNION ALL with UNION, how many rows are returned? Explain why."
    )
    assert not practice._has_furniture("In the implication P → Q, when is the statement false?")


# ── _author_section post-processing (LLM stubbed out) ────────────────────────


def _stub_completion(payload):
    def fake(messages, schema, temperature=0.3, model=None):
        return payload, None

    return fake


def test_author_section_drops_furniture_and_keeps_the_rest(monkeypatch):
    monkeypatch.setattr(
        practice,
        "ollama_structured_completion",
        _stub_completion(
            {
                "problems": [
                    {"prompt": "Derive X from Y.", "answer": "Step 1 … Step 2 …", "rubric": "names both steps"},
                    {"prompt": "According to the text, define Z.", "answer": "Z is …", "rubric": "r"},
                ]
            }
        ),
    )
    kept, dropped = practice._author_section("problem", "H", "text", "", None)
    assert len(kept) == 1 and dropped == 1
    assert kept[0]["kind"] == "problem"
    assert kept[0]["prompt"] == "Derive X from Y."


def test_author_section_empty_list_is_a_refusal_not_an_error(monkeypatch):
    # The prompts sanction returning an EMPTY list for contentless sections; the runner
    # must treat that as success (counted as refused), never raise.
    monkeypatch.setattr(practice, "ollama_structured_completion", _stub_completion({"problems": []}))
    kept, dropped = practice._author_section("problem", "H", "text", "", None)
    assert kept == [] and dropped == 0


def test_author_section_retrieve_maps_q_a_and_requires_both(monkeypatch):
    monkeypatch.setattr(
        practice,
        "ollama_structured_completion",
        _stub_completion(
            {
                "questions": [
                    {"q": "When is P → Q false?", "a": "Only when P is true and Q is false."},
                    {"q": "Orphan question", "a": "  "},  # blank answer dropped
                ]
            }
        ),
    )
    kept, dropped = practice._author_section("retrieve", "H", "text", "", None)
    assert len(kept) == 1 and dropped == 0
    assert kept[0] == {
        "kind": "retrieve",
        "prompt": "When is P → Q false?",
        "answer": "Only when P is true and Q is false.",
        "rubric": None,
    }


# ── review keys + queue cards ────────────────────────────────────────────────


def test_practice_review_key_is_deterministic_prefixed_and_uuid_anchored():
    a = practice_review_key("item-uuid-1")
    assert a == practice_review_key("item-uuid-1")
    assert a.startswith(PRACTICE_KEY_PREFIX)
    assert practice_review_key("item-uuid-2") != a


def test_practice_card_reads_live_fields_and_never_snapshots():
    item = {
        "key": "abc123",
        "kind": "problem",
        "prompt": "Derive X.",
        "answer": "The worked solution.",
        "rubric": "must contain the derivation",
        "payload": None,
        "sectionKey": "toc:1.4",
        "docId": "doc-1",
    }
    card = _practice_card(item, "new", None)
    assert card["itemType"] == "practice"
    assert card["conceptKey"] == practice_review_key("abc123")
    assert card["practiceKey"] == "abc123"
    assert card["practiceKind"] == "problem"
    # the reveal fields come from the ITEM at queue time — editable, not snapshotted
    assert card["answer"] == "The worked solution."
    assert card["rubric"] == "must contain the derivation"
    assert "children" not in card


# ── production fluency: the three rules are exit criteria, not preferences ───


def test_fluency_zero_items_is_unknown_not_zero():
    out = summarize_fluency([], {"prac-x": 0.5})
    assert out == {"items": 0, "attempted": 0, "fluency": None, "state": "unknown"}


def test_fluency_unattempted_items_are_not_a_score():
    out = summarize_fluency(["prac-a", "prac-b"], {})
    assert out["items"] == 2 and out["attempted"] == 0
    assert out["fluency"] is None and out["state"] == "unattempted"


def test_fluency_is_mean_retrievability_over_attempted_only():
    out = summarize_fluency(["prac-a", "prac-b", "prac-c"], {"prac-a": 0.9, "prac-b": 0.5})
    assert out["items"] == 3 and out["attempted"] == 2
    assert abs(out["fluency"] - 0.7) < 1e-9
    assert out["state"] == "measured"
    # raw number only — no solid/shaky adjective anywhere in the payload
    assert "retention" not in out


def test_fluency_reports_no_threshold_words():
    out = summarize_fluency(["prac-a"], {"prac-a": 0.95})
    assert out["state"] == "measured"  # never "solid" — thresholds are for 20s cards
