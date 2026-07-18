"""The generalized processing ledger — kind-aware keys and back-compat."""

from app.gateways.ledger import KINDS, _bkey


def test_build_kind_keeps_the_pre_kind_key():
    # Existing chapter_builds rows were keyed sha(doc|scope) — "build" must still hit them.
    import hashlib

    legacy = hashlib.sha256(b"doc1|toc:1").hexdigest()[:16]
    assert _bkey("doc1", "toc:1") == legacy
    assert _bkey("doc1", "toc:1", "build") == legacy


def test_other_kinds_get_distinct_keys():
    # Every kind EXCEPT the build/extract alias pair gets its own namespace.
    distinct = [k for k in KINDS if k != "extract"]  # extract deliberately shares build's key
    keys = {_bkey("doc1", "toc:1", k) for k in distinct}
    assert len(keys) == len(distinct)  # no collisions among the rest
    assert _bkey("doc1", "toc:1", "guides") != _bkey("doc1", "toc:2", "guides")


def test_build_and_extract_share_one_key():
    # They run the identical runner — the same (doc, scope) work must dedup to one row, and
    # both must hit the legacy sha(doc|scope) rows. (Fixes: autochained extract invisible to
    # the build-filtering status poller.)
    assert _bkey("doc1", "toc:1", "extract") == _bkey("doc1", "toc:1", "build")


def test_kinds_registry_shape():
    assert "build" in KINDS
    assert {"guides", "skeleton", "orient"} <= set(KINDS)
