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


# --------------------------------------------------------------------------- #
# C3 (v0.18.0) — an extraction where every section failed is a failed extraction
# --------------------------------------------------------------------------- #

def test_an_extraction_with_every_section_failed_reports_failure(monkeypatch):
    """`extract_concepts_document` sets `error` only when the RUN could not start, and
    reports per-section outcomes otherwise. So a chapter whose every section timed out or
    came back ungrounded arrived here as a clean `done` with zero concepts — identical, on
    every surface above, to a chapter that genuinely teaches nothing."""
    from app.conductor import build as b

    monkeypatch.setattr(b, "_scope_keys", lambda *_a, **_k: ["toc:1", "toc:2"])
    monkeypatch.setattr(b, "concept_count", lambda *_a, **_k: 0)
    monkeypatch.setattr(b.asyncio, "run", lambda _c: {
        "sections": 2, "errors": 2, "extracted": 0, "concepts": 0, "outcomes": []})

    class Ctx:
        phase = None
        def patch(self, _f): pass
        def progress(self, *_a, **_k): pass

    out = b.run_extract({"docId": "d", "scope": "toc:1"}, Ctx())
    assert out and "every section failed" in out["error"]


def test_a_partly_failed_extraction_still_succeeds(monkeypatch):
    """The boundary that keeps the rule useful: some sections failing is normal and must
    not throw away the ones that worked."""
    from app.conductor import build as b

    monkeypatch.setattr(b, "_scope_keys", lambda *_a, **_k: ["toc:1", "toc:2"])
    monkeypatch.setattr(b, "concept_count", lambda *_a, **_k: 0)
    monkeypatch.setattr(b.asyncio, "run", lambda _c: {
        "sections": 3, "errors": 1, "extracted": 2, "concepts": 7, "outcomes": []})

    class Ctx:
        phase = None
        def patch(self, _f): pass
        def progress(self, *_a, **_k): pass

    assert b.run_extract({"docId": "d", "scope": "toc:1"}, Ctx()) is None
