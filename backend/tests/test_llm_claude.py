"""``claude:<model>`` routes a structured completion through the host's ``claude -p``
(v0.23.0): system messages become the system prompt, the rest go on stdin, no tools or
settings load, and every failure comes back through the (None, error) contract."""

import json
import subprocess

from app.gateways import llm


class _Done:
    def __init__(self, payload, stderr=""):
        self.stdout = json.dumps(payload)
        self.stderr = stderr


def _stub(monkeypatch, payload):
    seen = {}

    def run(cmd, input=None, **kw):
        seen["cmd"], seen["input"] = cmd, input
        return _Done(payload)

    monkeypatch.setattr(llm.shutil, "which", lambda _: "/usr/bin/claude")
    monkeypatch.setattr(llm.subprocess, "run", run)
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("ollama called")))
    return seen


def test_claude_model_goes_through_the_cli_not_ollama(monkeypatch):
    seen = _stub(monkeypatch, {"type": "result", "subtype": "success", "is_error": False,
                               "structured_output": {"n": 2}})
    out, err = llm.ollama_structured_completion(
        [{"role": "system", "content": "SYS"}, {"role": "user", "content": "ASK"}],
        {"type": "object"}, model="claude:sonnet")
    assert (out, err) == ({"n": 2}, None)
    cmd = seen["cmd"]
    assert cmd[cmd.index("--model") + 1] == "sonnet"
    assert cmd[cmd.index("--system-prompt") + 1] == "SYS" and seen["input"] == "ASK"
    assert cmd[cmd.index("--tools") + 1] == "" and "--no-session-persistence" in cmd


def test_claude_error_result_is_an_error_not_a_pass(monkeypatch):
    _stub(monkeypatch, {"type": "result", "subtype": "error_max_turns", "is_error": True})
    out, err = llm.ollama_structured_completion([{"role": "user", "content": "x"}], {}, model="claude:opus")
    assert out is None and "error_max_turns" in err


def test_no_cli_is_an_error(monkeypatch):
    monkeypatch.setattr(llm.shutil, "which", lambda _: None)
    out, err = llm.ollama_structured_completion([{"role": "user", "content": "x"}], {}, model="claude:opus")
    assert out is None and "claude CLI not found" in err


def test_timeout_is_an_error(monkeypatch):
    monkeypatch.setattr(llm.shutil, "which", lambda _: "/usr/bin/claude")

    def run(*a, **k):
        raise subprocess.TimeoutExpired("claude", 1)

    monkeypatch.setattr(llm.subprocess, "run", run)
    out, err = llm.ollama_structured_completion([{"role": "user", "content": "x"}], {}, model="claude:opus")
    assert out is None and err
