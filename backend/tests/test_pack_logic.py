from app.supplemental.study.pack_logic import draw_paper, mark, public_question, today_plan
from tests.test_pack_gen import SPEC


def item(key, qtype="mcq", role="exam", origin="generated", unit="u1", skill=None):
    payload = {"spec": SPEC} if qtype == "gen" else {"stem": key, "choices": list("abcde"), "answer": 1}
    return {"key": key, "qtype": qtype, "role": role, "origin": origin, "unit_key": unit,
            "skill": skill or key, "skill_label": key, "section_key": "s", "evidence": "e",
            "payload": payload, "weight": 1}


FMT = {"count": 6, "choices": 5, "writtenShare": 0}


def test_a_paper_never_holds_book_problems_or_learn_items():
    pool = [item("a"), item("b", origin="book_problem", role="learn"), item("c", role="learn")]
    qs, short = draw_paper(pool, {**FMT, "count": 3}, set(), 1)
    assert [q["itemKey"] for q in qs] == ["a"] and short == 2


def test_seen_items_are_excluded_and_the_paper_comes_up_short():
    qs, short = draw_paper([item("a"), item("b")], FMT, {"item:a"}, 1)
    assert [q["itemKey"] for q in qs] == ["b"] and short == 5


def test_a_generator_serves_many_distinct_instances():
    qs, short = draw_paper([item("g", "gen")], FMT, set(), 5)
    assert short == 0 and len({q["fingerprint"] for q in qs}) == 6


def test_two_sittings_share_no_instance():
    first, _ = draw_paper([item("g", "gen")], FMT, set(), 5)
    second, _ = draw_paper([item("g", "gen")], FMT, {q["fingerprint"] for q in first}, 5)
    assert not {q["fingerprint"] for q in first} & {q["fingerprint"] for q in second}


def test_chapters_take_turns():
    pool = [item(f"a{i}", unit="u1") for i in range(5)] + [item(f"b{i}", unit="u2") for i in range(5)]
    qs, _ = draw_paper(pool, {**FMT, "count": 4}, set(), 2)
    assert sorted(q["unitKey"] for q in qs) == ["u1", "u1", "u2", "u2"]


def test_answers_stay_hidden_until_finished():
    q, = draw_paper([item("a")], {**FMT, "count": 1}, set(), 1)[0]
    assert "answer" not in public_question(q, False)
    assert "answer" in public_question(q, True)


def test_written_leaves_the_score_provisional():
    qs = [{"key": "k", "qtype": "written", "unitKey": "u", "skill": "s", "skillLabel": "S", "sectionKey": "x"},
          {"key": "m", "qtype": "choice", "answer": 2, "unitKey": "u", "skill": "t", "skillLabel": "T", "sectionKey": "x"}]
    r = mark(qs, {"m": {"choice": 2}})
    assert r["provisional"] and r["good"] == 1 and r["pending"] == 1
    r = mark(qs, {"m": {"choice": 2}, "k": {"selfGrade": 3}})
    assert not r["provisional"] and r["good"] == 2


def test_today_walks_stages_then_offers_the_exam():
    unit = {"key": "u", "title": "Ch 1", "status": "ready", "progress": {"chunk": True}}
    plan = today_plan({"config": {}}, [unit], [], [], None)
    assert plan["now"]["stage"] == "steps"
    done = {**unit, "progress": {"chunk": True, "steps": True, "test": {"good": 1, "total": 1}}}
    assert today_plan({"config": {}}, [done], [], [], None)["now"]["kind"] == "exam"
