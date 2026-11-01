from app.process.packs import gen
from app.process.packs.sandbox import gate, run_snippets

SPEC = {
    "params": {"a": {"kind": "int", "min": 3, "max": 40}, "b": {"kind": "int", "min": 2, "max": 9}},
    "stem": "What does this print?\n{{code}}",
    "code": "print({{a}} // {{b}})",
    "distractors": [
        {"misconception": "true division", "code": "print({{a}} / {{b}})"},
        {"misconception": "remainder", "code": "print({{a}} % {{b}} + 100)"},
        {"misconception": "multiplied", "code": "print({{a}} * {{b}} + 1000)"},
        {"misconception": "added", "code": "print({{a}} + {{b}} + 2000)"},
        {"misconception": "subtracted", "code": "print({{a}} - {{b}} + 3000)"},
    ],
    "explain": "{{a}} // {{b}} floors.",
    "steps": [{"ask": "Compute {{a}} // {{b}}", "code": "print({{a}} // {{b}})"}],
}


def test_gate_refuses_what_no_question_needs():
    assert gate("import os")
    assert gate("open('/etc/passwd')")
    assert gate("().__class__.__bases__")
    assert gate("print(")
    assert gate("import math\nprint(math.floor(2.5))") is None
    assert gate("class A:\n  def __init__(self): self.x = 1\nprint(A().x)") is None


def test_snippets_report_output_exceptions_and_refusals():
    out = run_snippets(["print(1 + 1)", "print(1 / 0)", "import os", "while True: pass"])
    assert out[0]["stdout"] == "2\n"
    assert out[1]["exception"] == "ZeroDivisionError"
    assert "refused" in out[2]
    assert out[3].get("timeout")


def test_gate_also_guards_batched_runs():
    out = run_snippets(["import math\nprint(len([k for k in dir.__self__]))"])
    assert "refused" in out[0]


def test_render_is_deterministic_and_marks_the_key():
    a, b = gen.render(SPEC, 3), gen.render(SPEC, 3)
    assert a == b and len(a["choices"]) == 5
    assert a["choices"][a["answer"]] not in [a["choices"][int(i)] for i in a["why"]]
    assert a["steps"][0]["show"] == a["choices"][a["answer"]]


def test_harness_passes_a_real_generator_and_rejects_a_constant():
    assert gen.harness(SPEC) is None
    assert gen.harness({"stem": "x", "code": "print(1)", "distractors": []})


def test_render_unseen_skips_fingerprints():
    first = gen.render_unseen(SPEC, set(), 11)
    second = gen.render_unseen(SPEC, {first["fingerprint"]}, 11)
    assert second["fingerprint"] != first["fingerprint"]
