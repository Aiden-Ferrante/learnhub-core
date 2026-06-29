"""Tests for the read-time noise filter (pure functions, no DB)."""

from app.arango_learn import _is_noise_triple, _triple_rows_from_cursor


def test_keeps_real_knowledge_triples():
    assert not _is_noise_triple("X", "is called", "a real random variable")
    assert not _is_noise_triple("V", "is a", "finite set of variables")
    assert not _is_noise_triple("A and B", "are conditionally independent given", "C")
    # Single-letter math entities (random variables) must survive.
    assert not _is_noise_triple("Z", "stands for", "the set {X, Y}")


def test_drops_pronoun_and_deictic_endpoints():
    assert _is_noise_triple("we", "start with", "hardest questions")
    assert _is_noise_triple("This chapter", "describes", "the basic paradigms")
    assert _is_noise_triple("It", "states that", "the belief in any event A ...")
    # Pronoun as the *object* is just as useless.
    assert _is_noise_triple("absolute values of P(alarm)", "was not necessary to estimate", "It")


def test_drops_page_number_and_citation_noise():
    assert _is_noise_triple("Figure 2", "has page number", "42")
    assert _is_noise_triple("Section", "has_page_number", "7")  # underscore variant
    assert _is_noise_triple("Pearl", "published", "2000")
    assert _is_noise_triple("Robins", "published in", "Journal")
    assert _is_noise_triple("Spirtes", "published_in", "MIT Press")


def test_cursor_filter_strips_noise_and_blanks():
    rows = [
        {"subject": "X", "predicate": "is called", "object": "a real random variable"},
        {"subject": "we", "predicate": "emphasize", "object": "universality"},
        {"subject": "Pearl", "predicate": "published", "object": "2000"},
        {"subject": "", "predicate": "is", "object": "X"},  # blank subject
    ]
    out = _triple_rows_from_cursor(rows)
    assert out == [{"subject": "X", "predicate": "is called", "object": "a real random variable"}]
