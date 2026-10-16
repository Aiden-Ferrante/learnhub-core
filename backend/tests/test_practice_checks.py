"""Authoring-time quality stages (v0.23.0) — objectives route kinds, revise output is
re-screened, the answerability gate drops contradicts/unanswerable and never fakes a pass,
and the recall check relabels only with concept lines to compare against. LLM stubbed."""

from app.gateways import (
    AnswerVerdictSet,
    AttemptSet,
    ObjectiveSet,
    ProblemSet,
    RecallVerdictSet,
    RetrieveSet,
)
from app.process.extraction import practice, practice_checks


def _by_schema(responses):
    """A stub that answers by schema. A list value is consumed one call at a time; None
    means the call failed. Records every call's schema in ``calls``."""
    calls = []

    def fake(messages, schema, temperature=0.3, model=None):
        calls.append(schema)
        r = responses.get(schema)
        if isinstance(r, list):
            r = r.pop(0) if r else None
        return (r, None) if r is not None else (None, "boom")

    return fake, calls


def _stub(monkeypatch, responses):
    fake, calls = _by_schema(responses)
    monkeypatch.setattr(practice, "ollama_structured_completion", fake)
    monkeypatch.setattr(practice_checks, "ollama_structured_completion", fake)
    return calls


def _item(prompt, answer="A.", kind="problem"):
    return {"kind": kind, "prompt": prompt, "answer": answer, "rubric": "r", "difficulty": 2}


# ── objectives ───────────────────────────────────────────────────────────────


def test_objectives_dedupe_cap_per_level_and_drop_bad_levels(monkeypatch):
    _stub(monkeypatch, {ObjectiveSet: {"objectives": [
        {"text": "Define soundness.", "level": "recall"},
        {"text": "define soundness.", "level": "recall"},  # duplicate, case-folded
        {"text": "Prove X.", "level": "produce"},
        {"text": "R2", "level": "recall"}, {"text": "R3", "level": "recall"},
        {"text": "R4", "level": "recall"},  # over the per-level cap
        {"text": "Odd", "level": "analyze"},  # not a level
    ]}})
    objs = practice_checks.objectives("H", "text", "", None)
    assert [o["text"] for o in objs] == ["Define soundness.", "Prove X.", "R2", "R3"]


def test_pipeline_refuses_a_kind_with_no_objectives_of_its_level_without_calling(monkeypatch):
    calls = _stub(monkeypatch, {
        ObjectiveSet: {"objectives": [{"text": "Define soundness.", "level": "recall"}]},
        RetrieveSet: [
            {"questions": [{"q": "What does soundness guarantee?", "a": "Only truths are provable.", "difficulty": 1}]},
            {"questions": [{"q": "What does soundness guarantee?", "a": "Only truths are provable.", "difficulty": 1}]},
        ],
        AttemptSet: {"attempts": [{"index": 0, "answer": "Provable implies true."}]},
        AnswerVerdictSet: {"verdicts": [{"index": 0, "verdict": "consistent", "reason": "same"}]},
    })
    items, receipt, failed = practice.author_section_items("H", "text", "", ["retrieve", "problem"], None, revise_passes=1)
    assert ProblemSet not in calls  # no produce objective → problem refused without a call
    assert receipt["refused"] == 1 and receipt["authored"] == 1
    assert [i["kind"] for i in items] == ["retrieve"] and failed == []


def test_objectives_steer_the_authoring_prompt(monkeypatch):
    seen = {}

    def fake(messages, schema, temperature=0.3, model=None):
        seen[schema] = messages[-1]["content"]
        return {"problems": []}, None

    monkeypatch.setattr(practice, "ollama_structured_completion", fake)
    practice._author_section("problem", "H", "text", "", None,
                             objectives=[{"text": "Derive the contrapositive.", "level": "produce"}])
    assert "1. Derive the contrapositive." in seen[ProblemSet]
    assert "one item per objective" in seen[ProblemSet]


# ── critique → revise ────────────────────────────────────────────────────────


def test_revise_output_is_rescreened(monkeypatch):
    # A reviser can reintroduce what the author avoided; the furniture screen runs again.
    _stub(monkeypatch, {
        ObjectiveSet: {"objectives": [{"text": "Derive X.", "level": "produce"}]},
        ProblemSet: [
            {"problems": [{"prompt": "Derive X from Y.", "answer": "Step 1", "rubric": "r", "difficulty": 2}]},
            {"problems": [{"prompt": "According to the text, derive X.", "answer": "Step 1", "rubric": "r", "difficulty": 2}]},
        ],
    })
    items, receipt, _ = practice.author_section_items("H", "text", "", ["problem"], None, revise_passes=1)
    assert items == [] and receipt["dropped"] == 1


def test_a_failed_revise_keeps_the_items_and_counts_them(monkeypatch):
    _stub(monkeypatch, {
        ObjectiveSet: {"objectives": [{"text": "Derive X.", "level": "produce"}]},
        ProblemSet: [{"problems": [{"prompt": "Derive X from Y.", "answer": "Step 1", "rubric": "r", "difficulty": 2}]}, None],
        AttemptSet: {"attempts": [{"index": 0, "answer": "Step 1"}]},
        AnswerVerdictSet: {"verdicts": [{"index": 0, "verdict": "consistent", "reason": "ok"}]},
    })
    items, receipt, _ = practice.author_section_items("H", "text", "", ["problem"], None, revise_passes=1)
    assert len(items) == 1 and receipt["unrevised"] == 1


def test_revise_never_adds_items(monkeypatch):
    _stub(monkeypatch, {ProblemSet: {"problems": [
        {"prompt": f"Derive X{i}.", "answer": "s", "rubric": "r", "difficulty": 2} for i in range(4)
    ]}})
    raw = practice_checks.revise("problem", "H", "text", [_item("Derive X.")], None)
    assert len(raw) == 1


def test_revise_passes_env_is_clamped(monkeypatch):
    monkeypatch.setenv("LEARN_PRACTICE_REVISE_PASSES", "9")
    assert practice._revise_passes() == practice_checks.MAX_REVISE_PASSES
    monkeypatch.setenv("LEARN_PRACTICE_REVISE_PASSES", "junk")
    assert practice._revise_passes() == 1
    monkeypatch.setenv("LEARN_PRACTICE_REVISE_PASSES", "0")
    assert practice._revise_passes() == 0


# ── the answerability gate ───────────────────────────────────────────────────


def test_gate_drops_contradicts_and_unanswerable_with_reasons(monkeypatch):
    _stub(monkeypatch, {
        AttemptSet: {"attempts": [{"index": i, "answer": f"a{i}"} for i in range(3)]},
        AnswerVerdictSet: {"verdicts": [
            {"index": 0, "verdict": "consistent", "reason": "same"},
            {"index": 1, "verdict": "contradicts", "reason": "4 vs 5"},
            {"index": 2, "verdict": "unanswerable", "reason": "CANNOT ANSWER"},
        ]},
    })
    kept, failed, unchecked = practice_checks.answerability(
        "H", "text", [_item("P0?"), _item("P1?"), _item("P2?")], None)
    assert [k["prompt"] for k in kept] == ["P0?"]
    assert [(f["prompt"], f["check"]["verdict"]) for f in failed] == [
        ("P1?", "contradicts"), ("P2?", "unanswerable")]
    assert failed[0]["check"]["reason"] == "4 vs 5" and unchecked == 0


def test_gate_never_shows_the_attempt_the_stored_answer(monkeypatch):
    seen = []

    def fake(messages, schema, temperature=0.3, model=None):
        seen.append((schema, messages[-1]["content"]))
        return None, "stop after the attempt"

    monkeypatch.setattr(practice_checks, "ollama_structured_completion", fake)
    practice_checks.answerability("H", "text", [_item("P0?", answer="SECRET-REFERENCE")], None)
    assert seen[0][0] is AttemptSet and "SECRET-REFERENCE" not in seen[0][1]


def test_gate_failure_keeps_items_and_counts_unchecked_never_a_silent_pass(monkeypatch):
    _stub(monkeypatch, {AttemptSet: None})
    kept, failed, unchecked = practice_checks.answerability("H", "text", [_item("P0?"), _item("P1?")], None)
    assert len(kept) == 2 and failed == [] and unchecked == 2

    _stub(monkeypatch, {
        AttemptSet: {"attempts": [{"index": 0, "answer": "a"}, {"index": 1, "answer": "b"}]},
        AnswerVerdictSet: {"verdicts": [{"index": 0, "verdict": "consistent", "reason": "ok"}]},
    })
    kept, failed, unchecked = practice_checks.answerability("H", "text", [_item("P0?"), _item("P1?")], None)
    assert len(kept) == 2 and unchecked == 1  # item 1 had no verdict


def test_gate_retries_items_a_short_batch_left_out(monkeypatch):
    # Observed: gpt-oss answered a batch of three long problems with an EMPTY list.
    calls = _stub(monkeypatch, {
        AttemptSet: [{"attempts": []}, {"attempts": [{"index": 0, "answer": "a"}]},
                     {"attempts": [{"index": 1, "answer": "  "}]}],
        AnswerVerdictSet: {"verdicts": [{"index": 0, "verdict": "consistent", "reason": "ok"}]},
    })
    kept, failed, unchecked = practice_checks.answerability("H", "text", [_item("P0?"), _item("P1?")], None)
    assert calls.count(AttemptSet) == 3  # the batch, then one per missing item
    assert len(kept) == 2 and unchecked == 1  # item 1's blank answer is not an attempt


def test_gate_drops_an_item_that_gives_its_answer_away(monkeypatch):
    _stub(monkeypatch, {
        AttemptSet: {"attempts": [{"index": 0, "answer": "the distance from the truth"}]},
        AnswerVerdictSet: {"verdicts": [{"index": 0, "verdict": "gives_away", "reason": "prompt states it"}]},
    })
    kept, failed, _ = practice_checks.answerability(
        "H", "text", [_item("Define bias as the distance from the truth.", kind="retrieve")], None)
    assert kept == [] and failed[0]["check"]["verdict"] == "gives_away"


def test_screen_drops_are_recorded_with_their_reason(monkeypatch):
    _stub(monkeypatch, {
        ObjectiveSet: {"objectives": [{"text": "Derive X.", "level": "produce"}]},
        ProblemSet: {"problems": [
            {"prompt": "As shown in Table 2, derive X.", "answer": "s", "rubric": "r", "difficulty": 2},
            {"prompt": "The bias of an estimator.", "answer": "s", "rubric": "r", "difficulty": 2},
        ]},
    })
    items, receipt, failed = practice.author_section_items("H", "text", "", ["problem"], None, revise_passes=0)
    assert receipt["dropped"] == 2 and items == []
    reasons = [f["check"]["reason"] for f in failed]
    assert all(f["check"]["verdict"] == "screened" for f in failed)
    assert "As shown in" in reasons[0] and reasons[1] == "asks nothing"


# ── recall in disguise ───────────────────────────────────────────────────────


def test_recall_check_relabels_restating_problems_only(monkeypatch):
    _stub(monkeypatch, {RecallVerdictSet: {"verdicts": [
        {"index": 0, "restates": True, "reason": "restates the definition of soundness"},
        {"index": 2, "restates": False, "reason": "builds a truth table"},
    ]}})
    items = [_item("State soundness as a problem."), _item("Q?", kind="retrieve"), _item("Build a truth table.")]
    out, relabeled, unchecked = practice_checks.recall_in_disguise(items, "- Soundness: …", None)
    assert [i["kind"] for i in out] == ["retrieve", "retrieve", "problem"]
    assert relabeled == 1 and unchecked == 0
    assert "soundness" in out[0]["relabel"]


def test_recall_check_needs_concept_lines(monkeypatch):
    calls = _stub(monkeypatch, {})
    items = [_item("Build a truth table.")]
    out, relabeled, unchecked = practice_checks.recall_in_disguise(items, "", None)
    assert out == items and relabeled == 0 and unchecked == 0 and calls == []


def test_recall_check_failure_counts_unchecked(monkeypatch):
    _stub(monkeypatch, {RecallVerdictSet: None})
    out, relabeled, unchecked = practice_checks.recall_in_disguise([_item("Derive X.")], "- X: …", None)
    assert out[0]["kind"] == "problem" and relabeled == 0 and unchecked == 1


# ── the guardrail ────────────────────────────────────────────────────────────


def test_graded_loop_never_imports_the_checks():
    import pathlib

    study = pathlib.Path(practice.__file__).resolve().parents[2] / "supplemental" / "study"
    for name in ("reviews.py", "exams.py"):
        src = (study / name).read_text()
        assert "practice_checks" not in src and "ollama" not in src.lower()
