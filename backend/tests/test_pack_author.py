from types import SimpleNamespace as NS

from app.process.packs import author
from tests.test_pack_gen import SPEC

TEXT = "The floor division operator rounds the result down to the nearest whole number every time."
QUOTE = "rounds the result down to the nearest whole"


def sec(key, heading, md=TEXT):
    return NS(source_section_key=key, heading=heading, markdown=md)


def fake_model(by_schema):
    def ask(system, user, schema, model):
        return by_schema[schema.__name__]
    return ask


GEN = {"skillId": "floor", "sectionKey": "s1", "params": [{"name": "a", "kind": "int", "min": 3, "max": 40, "values": []},
       {"name": "b", "kind": "int", "min": 2, "max": 9, "values": []}], "stem": SPEC["stem"], "code": SPEC["code"],
       "distractors": SPEC["distractors"], "explain": "x", "steps": [], "evidence": QUOTE}
BASE = {
    "PackChunk": {"points": [{"text": "ok", "sectionKey": "s1", "evidence": QUOTE},
                             {"text": "invented", "sectionKey": "s1", "evidence": "this sentence is not in the book"}]},
    "PackSkillSet": {"skills": [{"id": "floor", "label": "Floor division", "sectionKey": "s1", "style": "computable",
                                 "weight": 1, "evidence": QUOTE}]},
    "PackBookProblemSet": {"problems": [{"skillId": "floor", "sectionKey": "q1", "stem": "Q", "choices": [], "answerIndex": -1,
                                         "printedAnswer": "", "code": "", "evidence": QUOTE}]},
    "PackWorkedSet": {"worked": [{"skillId": "floor", "sectionKey": "s1", "stem": "W", "steps": [], "answer": "a", "evidence": QUOTE}]},
    "PackGeneratorSet": {"generators": [GEN, {**GEN, "code": "print(1)", "params": []}]},
    "PackVerdictSet": {"verdicts": []},
}


def build(monkeypatch, responses, sections=None, count_share=5):
    monkeypatch.setattr(author, "_ask", fake_model(responses))
    sections = sections or [sec("s1", "Floor division"), sec("q1", "SECTION QUIZ"), sec("r1", "SECTION SUMMARY")]
    return author.author_unit({}, sections, {"choices": 5}, "", count_share, "a", "j")


def test_grounded_checks_the_quote_in_the_cited_section():
    secs = {"s": TEXT}
    assert author.grounded(QUOTE, "s", secs) is None
    assert "unknown" in author.grounded(QUOTE, "x", secs)
    assert "not found" in author.grounded("a sentence the book never wrote", "s", secs)


def test_a_shortened_key_is_corrected_by_where_the_quote_really_is():
    secs = {"toc:2.3~2": TEXT, "toc:2.3~3": "something else entirely in this other section"}
    assert author.locate(QUOTE, "toc:2.3", secs) == "toc:2.3~2"
    assert author.locate(QUOTE, "toc:2.3~3", secs) == "toc:2.3~2"
    assert author.locate("a sentence the book never wrote", "toc:2.3", secs) is None


def test_sections_sort_by_what_the_book_provides():
    out = author.sort_sections([sec("a", "2.1 SECTION SUMMARY"), sec("b", "2.1 SECTION QUIZ"), sec("c", "Literals")])
    assert [len(out[k]) for k in ("summary", "problems", "body")] == [1, 1, 1]


def test_unit_keeps_grounded_items_and_reports_every_drop(monkeypatch):
    built = build(monkeypatch, BASE)
    r = built["receipt"]
    assert r["source"] == "book_summary"
    assert len(built["chunk"]["points"]) == 1
    reasons = [d["reason"] for d in r["dropped"]]
    assert "evidence not found in cited section" in reasons
    assert any("not a generator" in x for x in reasons)
    assert [i["qtype"] for i in built["items"] if i["role"] == "exam"] == ["gen"]


def test_book_problems_stay_in_learn_and_unconfirmed_ones_are_self_marked(monkeypatch):
    built = build(monkeypatch, BASE)
    book = [i for i in built["items"] if i["origin"] == "book_problem"]
    assert book and all(i["role"] == "learn" for i in book)
    assert book[0]["qtype"] == "written" and book[0]["payload"]["answer"] is None


def test_a_chapter_without_a_summary_or_problems_is_generated_from_sections(monkeypatch):
    built = build(monkeypatch, BASE, [sec("s1", "Floor division")])
    assert built["receipt"]["source"] == "sections" and built["receipt"]["bookProblems"] == 0


def test_a_thin_chapter_says_so(monkeypatch):
    assert build(monkeypatch, BASE, count_share=50)["receipt"]["thin"] is True


def test_solver_confirms_only_an_exact_single_match():
    assert author.confirmed_index({"choices": ["1", "2"], "code": "print(2)"}) == 1
    assert author.confirmed_index({"choices": ["1", "1"], "code": "print(1)"}) == -1
    assert author.confirmed_index({"choices": ["1", "2"], "code": ""}) == -1


def test_the_judge_drops_and_a_broken_judge_is_counted(monkeypatch):
    bad = {**BASE, "PackVerdictSet": {"verdicts": [{"index": 0, "keep": False, "reason": "key wrong"}]}}
    built = build(monkeypatch, bad)
    assert not [i for i in built["items"] if i["role"] == "exam"]
    assert any(d["reason"] == "judge: key wrong" for d in built["receipt"]["dropped"])
