"""The generalized processing ledger — kind-aware keys and back-compat."""

from app.build_queue import KINDS, _bkey


def test_build_kind_keeps_the_pre_kind_key():
    # Existing chapter_builds rows were keyed sha(doc|scope) — "build" must still hit them.
    import hashlib

    legacy = hashlib.sha256(b"doc1|toc:1").hexdigest()[:16]
    assert _bkey("doc1", "toc:1") == legacy
    assert _bkey("doc1", "toc:1", "build") == legacy


def test_other_kinds_get_distinct_keys():
    keys = {_bkey("doc1", "toc:1", k) for k in KINDS}
    assert len(keys) == len(KINDS)  # no collisions across kinds
    assert _bkey("doc1", "toc:1", "quizzes") != _bkey("doc1", "toc:2", "quizzes")


def test_kinds_registry_shape():
    assert "build" in KINDS
    assert {"quizzes", "guides", "skeleton", "orient"} <= set(KINDS)
