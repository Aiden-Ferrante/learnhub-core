"""Tests for server-side extraction (pure functions, no LLM, no DB)."""

from app.arango_learn import triple_id
from app.extract import (
    ExtractedTriple,
    SectionExtractInput,
    _blocks_in_scope,
    _section_depth,
    assemble_section_extraction,
    build_system_prompt,
    build_user_prompt,
    edge_provenance_merge,
    normalize_entity,
    normalize_triple,
    parse_extraction_response,
    proposition_key,
    section_body_len,
    section_mention_entities,
    structural_subsection_triples,
)

INP = SectionExtractInput(
    doc_id="doc1",
    section_key="toc:1.2",
    heading="1.2 Graphs",
    page_start=13,
    page_end=16,
    markdown="## 1.2 Graphs\n\nbody text here, long enough to extract from",
)

MODEL_OUT = {
    "propositions": [
        {
            "proposition_text": "A DAG is a directed acyclic graph.",
            "source_sentence": "A directed acyclic graph (DAG) is a graph that is both directed and acyclic.",
            "triples": [
                {"subject": "DAG", "predicate": "is", "object": "directed acyclic graph"},
                {"subject": "dag", "predicate": "IS", "object": "Directed Acyclic Graph"},  # case dup
            ],
        },
        {"proposition_text": "", "source_sentence": "x", "triples": []},  # dropped: no text
        {
            "proposition_text": "A root has no parents.",
            "source_sentence": "A node in a directed graph is called a root if it has no parents.",
            "triples": [
                {"subject": "root", "predicate": "has no", "object": "parents"},
                {"subject": "", "predicate": "x", "object": "y"},  # dropped: empty subject
            ],
        },
    ]
}


def test_build_user_prompt_injects_heading_pages_markdown():
    p = build_user_prompt(INP)
    assert "1.2 Graphs" in p and "toc:1.2" in p and "pages 13-16" in p
    assert "body text here" in p


def test_system_prompt_has_sections():
    s = build_system_prompt()
    assert "PROPOSITIONS" in s and "TRIPLES" in s and "verbatim" in s


def test_parse_drops_malformed_keeps_valid():
    raw = parse_extraction_response(MODEL_OUT)
    assert len(raw) == 2  # empty-text proposition dropped
    assert raw[0]["text"].startswith("A DAG")
    assert len(raw[1]["triples"]) == 1  # empty-subject triple dropped


def test_parse_non_dict_is_empty():
    assert parse_extraction_response("nope") == []
    assert parse_extraction_response({"propositions": "x"}) == []


def test_assemble_dedupes_triples_and_attaches_provenance():
    ext = assemble_section_extraction(INP, parse_extraction_response(MODEL_OUT))
    assert ext.doc_id == "doc1" and ext.section_key == "toc:1.2"
    assert ext.page_start == 13 and ext.page_end == 16
    assert len(ext.propositions) == 2
    # the DAG triple appears twice (case variants) → 1 in the section union; + root = 2
    assert len(ext.triples) == 2
    # propositions keep their own (un-deduped) triples
    assert len(ext.propositions[0].triples) == 2


def test_normalize_entity_strips_markup():
    assert normalize_entity("**Conditional Independence**") == "Conditional Independence"
    assert normalize_entity("  d-separation  ") == "d-separation"


def test_normalize_triple_drops_empty():
    assert normalize_triple("a", "", "b") is None
    assert normalize_triple("a", "is", "b") == ExtractedTriple("a", "is", "b")


def test_section_mention_entities_distinct():
    ext = assemble_section_extraction(INP, parse_extraction_response(MODEL_OUT))
    low = [e.lower() for e in section_mention_entities(ext)]
    assert len(low) == len(set(low))
    assert "dag" in low and "root" in low


def test_structural_subsection_chain():
    tr = structural_subsection_triples(["toc:1.2.3", "toc:1.2", "toc:2", "toc:preface"])
    pairs = {(t.subject, t.object) for t in tr}
    assert ("toc:root", "toc:1") in pairs
    assert ("toc:1", "toc:1.2") in pairs
    assert ("toc:1.2", "toc:1.2.3") in pairs
    assert ("toc:root", "toc:2") in pairs
    assert all(t.predicate == "has_subsection" for t in tr)
    assert sum(1 for t in tr if (t.subject, t.object) == ("toc:root", "toc:1")) == 1  # deduped
    assert not any("preface" in t.object for t in tr)  # slug keys excluded


def test_proposition_key_deterministic_and_scoped():
    a = proposition_key("doc1", "toc:1.2", "X is Y")
    assert a == proposition_key("doc1", "toc:1.2", "X is Y")
    assert a != proposition_key("doc1", "toc:1.3", "X is Y")  # different section = different row


def test_triple_id_format_for_propositions():
    t = ExtractedTriple("conditional independence", "implies", "factorization")
    tid = triple_id({"subject": t.subject, "predicate": t.predicate, "object": t.object})
    assert len(tid) == 16 and tid == triple_id({"subject": t.subject, "predicate": t.predicate, "object": t.object})


def test_edge_provenance_merge():
    m = edge_provenance_merge(
        {"sectionKeys": ["toc:1"], "pageStart": 5, "pageEnd": 8},
        {"sectionKeys": ["toc:2"], "pageStart": 3, "pageEnd": 12},
    )
    assert m["sectionKeys"] == ["toc:1", "toc:2"]
    assert m["pageStart"] == 3 and m["pageEnd"] == 12
    m2 = edge_provenance_merge({}, {"sectionKeys": ["toc:1"], "pageStart": None, "pageEnd": None})
    assert m2["sectionKeys"] == ["toc:1"] and m2["pageStart"] is None


def test_section_body_len():
    assert section_body_len("## Heading\n\nlong body content here") > 10
    assert section_body_len("## Heading only") == 0


def _row(order, key):
    return {"order": order, "sectionKey": key, "markdown": "x", "heading": key}


_SCOPE_ROWS = [
    _row(0, "toc:contents"),
    _row(1, "toc:1"),
    _row(2, "toc:1.1"),
    _row(3, "toc:definition-1-2-3"),  # slug theorem inside chapter 1
    _row(4, "toc:1.2"),
    _row(5, "toc:2"),  # chapter 2 — the boundary
    _row(6, "toc:2.1"),
]


def test_section_depth():
    assert _section_depth("toc:1") == 1
    assert _section_depth("toc:1.2.3") == 3
    assert _section_depth("toc:preface") == 99


def test_blocks_in_scope_chapter_includes_slugs_stops_at_next_chapter():
    keys = [r["sectionKey"] for r in _blocks_in_scope(_SCOPE_ROWS, "toc:1")]
    assert keys == ["toc:1", "toc:1.1", "toc:definition-1-2-3", "toc:1.2"]


def test_blocks_in_scope_subsection():
    keys = [r["sectionKey"] for r in _blocks_in_scope(_SCOPE_ROWS, "toc:1.1")]
    assert keys == ["toc:1.1", "toc:definition-1-2-3"]
