"""Tests for exam question generation (deterministic builder + LLM validation)."""

import json
import random

from app.quiz_gen import (
    _object_question,
    _predicate_question,
    _subject_question,
    _validate_llm_item,
    build_deterministic_questions,
    build_exam,
    parse_llm_questions,
    public_question,
)

TRIPLES = [
    {"subject": "Photosynthesis", "predicate": "occurs_in", "object": "Chloroplast"},
    {"subject": "Chloroplast", "predicate": "contains", "object": "Thylakoid"},
    {"subject": "Calvin Cycle", "predicate": "produces", "object": "Glucose"},
    {"subject": "Light Reaction", "predicate": "produces", "object": "ATP"},
    {"subject": "Photosynthesis", "predicate": "requires", "object": "Sunlight"},
    {"subject": "Mitochondria", "predicate": "produces", "object": "NADH"},
]


def _assert_well_formed(q):
    assert isinstance(q["stem"], str) and q["stem"].strip()
    assert len(q["choices"]) == 4
    assert len(set(q["choices"])) == 4
    assert 0 <= q["answer_index"] < 4
    assert q["expected"] == q["choices"][q["answer_index"]]


# --- deterministic variants ---

def test_object_variant_answer_is_object():
    rng = random.Random(1)
    q = _object_question(TRIPLES[0], TRIPLES, rng)
    _assert_well_formed(q)
    assert q["expected"] == "Chloroplast"
    assert q["source"] == "deterministic"


def test_subject_variant_answer_is_subject():
    rng = random.Random(2)
    q = _subject_question(TRIPLES[0], TRIPLES, rng)
    _assert_well_formed(q)
    assert q["expected"] == "Photosynthesis"


def test_predicate_variant_answer_is_predicate():
    rng = random.Random(3)
    q = _predicate_question(TRIPLES[0], TRIPLES, rng)
    _assert_well_formed(q)
    assert q["expected"] == "occurs_in"


def test_padding_when_pool_too_thin():
    rng = random.Random(4)
    tiny = [{"subject": "A", "predicate": "rel", "object": "B"}]
    q = _object_question(tiny[0], tiny, rng)
    _assert_well_formed(q)  # still 4 unique choices via padding
    assert q["expected"] == "B"


def test_build_deterministic_count_and_shape():
    rng = random.Random(5)
    qs = build_deterministic_questions(TRIPLES, count=4, rng=rng)
    assert len(qs) == 4
    stems = [q["stem"] for q in qs]
    assert len(set(stems)) == 4  # no duplicate stems
    for q in qs:
        _assert_well_formed(q)


# --- LLM validation / parsing ---

def _good_item(answer_index=0):
    return {
        "stem": "What does the Calvin Cycle produce?",
        "options": ["Glucose", "ATP", "NADH", "Sunlight"],
        "answerIndex": answer_index,
        "explanation": "Calvin Cycle | produces | Glucose",
    }


def test_validate_good_item():
    q = _validate_llm_item(_good_item(0))
    assert q is not None
    assert q["expected"] == "Glucose"
    assert q["source"] == "llm"
    assert q["triple"] is None


def test_validate_rejects_wrong_option_count():
    item = _good_item()
    item["options"] = ["Glucose", "ATP", "NADH"]  # only 3
    assert _validate_llm_item(item) is None


def test_validate_rejects_out_of_range_index():
    assert _validate_llm_item(_good_item(answer_index=7)) is None


def test_validate_rejects_bool_index():
    item = _good_item()
    item["answerIndex"] = True  # bool is a subclass of int — must be rejected
    assert _validate_llm_item(item) is None


def test_validate_rejects_duplicate_options():
    item = _good_item()
    item["options"] = ["Glucose", "Glucose", "ATP", "NADH"]
    assert _validate_llm_item(item) is None


def test_parse_questions_from_fenced_json():
    payload = {"questions": [_good_item(0), _good_item(1)]}
    raw = "Here is your exam:\n```json\n" + json.dumps(payload) + "\n```\nDone."
    qs = parse_llm_questions(raw, max_items=5)
    assert len(qs) == 2


def test_parse_malformed_returns_empty():
    assert parse_llm_questions("not json at all", max_items=5) == []
    assert parse_llm_questions('{"questions": "nope"}', max_items=5) == []


# --- build_exam assembly ---

def test_build_exam_deterministic_only():
    qs = build_exam(TRIPLES, count=4, use_llm=False, rng=random.Random(6))
    assert len(qs) == 4
    assert [q["id"] for q in qs] == ["q1", "q2", "q3", "q4"]
    for q in qs:
        _assert_well_formed(q)
        # public view withholds answers
        pub = public_question(q)
        assert set(pub.keys()) == {"id", "stem", "choices"}


def test_build_exam_empty_when_no_candidates():
    degenerate = [{"subject": "X", "predicate": "is", "object": "X"}]  # subject == object
    assert build_exam(degenerate, count=5, use_llm=False) == []
