from app.process.packs import answers, author, sandbox


def test_a_printed_program_is_answered_by_running_it():
    stem = "What is the output?\n\nlst = [3, 1]\nlst.sort()\nprint(lst)"
    assert answers.computed_answers([(stem, "")]) == ["[1, 3]"]


def test_an_expression_answers_like_the_prompt_and_an_exception_is_named():
    got = answers.computed_answers([("Result?\n\n2 == 2.", ""), ("Run it?\n\nlst = []\ndel lst\nprint(lst)", "")])
    assert got == ["True", "Raises NameError"]


def test_what_cannot_run_as_printed_stays_unanswered():
    for stem in ("No code here at all", "Fill it in\n\nprint(1 ??? [1])", "Ask\n\nx = int(input())\nprint(x)",
                 "Flattened\n\n1 2 3 print('a') print('b')", "Context\n\nprint(rocky.kennel)",
                 "Figure\n\n![Figure](/api/learn/figure?n=1)"):
        assert answers.computed_answers([(stem, "")]) == [None], stem


def test_furniture_catches_references_to_the_book_not_the_subject():
    for bad in ("Which pair fits the textbook?", "What does the text say about it?",
                "Which approach works according to the textbook?", "as shown in Table 2-1"):
        assert answers.furniture(bad), bad
    for ok in ("Count the words in the text variable", "print the book title", "Which loop prints 3?"):
        assert answers.furniture(ok) is None, ok


def test_a_rerun_of_one_chapter_keeps_the_whole_pack_on_the_receipt():
    units = [{"title": "A", "status": "ready", "receipt": {"kept": 10, "droppedCount": 2, "thin": False}},
             {"title": "B", "status": "ready", "receipt": {"kept": 5, "droppedCount": 1, "thin": True}},
             {"title": "C", "status": "failed", "receipt": {"error": "boom"}}]
    t = author.pack_totals(units)
    assert (t["kept"], t["dropped"], t["thin"], [f["title"] for f in t["failed"]]) == (15, 3, ["B"], ["C"])


def test_the_sandbox_child_drops_root(monkeypatch):
    import os
    monkeypatch.setattr(os, "geteuid", lambda: 0)
    ident = sandbox.child_identity()
    assert ident["user"] != 0 and ident["group"] != 0
    monkeypatch.setattr(os, "geteuid", lambda: 1000)
    assert sandbox.child_identity() == {}
