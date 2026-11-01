"""Run a generator's Python snippets away from the app.

A ``gen`` item's answer is computed, not stored, so model-written code runs at build time
and again when a paper is drawn. Three layers, cheapest first: an AST gate refuses what no
exam question needs; the child runs ``python -I -S`` with an empty environment; and it
drops into CPU, memory, file and process limits with a reduced builtins table before any
snippet executes. This is containment for code from our own model grounded on a textbook,
not a boundary for hostile input.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys

ALLOWED_IMPORTS = {"math", "string", "itertools", "functools", "collections"}
BANNED_NAMES = {
    "open", "eval", "exec", "compile", "__import__", "globals", "locals", "vars", "getattr",
    "setattr", "delattr", "input", "breakpoint", "memoryview", "help", "exit", "quit", "id",
    "hash", "dir", "__builtins__", "__loader__", "__spec__",
}
BANNED_ATTRS = {
    "__class__", "__subclasses__", "__globals__", "__bases__", "__base__", "__mro__",
    "__builtins__", "__code__", "__closure__", "__getattribute__", "__reduce__",
    "__reduce_ex__", "__import__", "__loader__", "__spec__", "gi_frame", "f_globals",
    "f_builtins", "f_back",
}

_RUNNER = r"""
import builtins, contextlib, io, json, resource, signal, sys
payload = json.loads(sys.stdin.read())
for lim, val in ((resource.RLIMIT_CPU, 6), (resource.RLIMIT_AS, 512 * 2**20),
                 (resource.RLIMIT_FSIZE, 0), (resource.RLIMIT_NPROC, 0)):
    try:
        resource.setrlimit(lim, (val, val))
    except (ValueError, OSError):
        pass
import math, string, itertools, functools, collections
mods = {"math": math, "string": string, "itertools": itertools, "functools": functools,
        "collections": collections}
def _imp(name, *a, **k):
    if name not in mods:
        raise ImportError(name)
    return mods[name]
drop = set(payload["banned"])
safe = {k: v for k, v in vars(builtins).items() if k not in drop}
safe["__import__"] = _imp
class Timeout(BaseException):
    pass
def _alarm(*_):
    raise Timeout()
signal.signal(signal.SIGALRM, _alarm)
out = []
for code in payload["codes"]:
    buf = io.StringIO()
    res = {}
    try:
        signal.setitimer(signal.ITIMER_REAL, 1.0)
        with contextlib.redirect_stdout(buf):
            exec(code, {"__name__": "__main__", "__builtins__": safe})
        signal.setitimer(signal.ITIMER_REAL, 0)
        res = {"stdout": buf.getvalue()[:2000]}
    except Timeout:
        res = {"timeout": True}
    except BaseException as e:
        signal.setitimer(signal.ITIMER_REAL, 0)
        res = {"stdout": buf.getvalue()[:2000], "exception": type(e).__name__}
    out.append(res)
sys.__stdout__.write(json.dumps(out))
"""


def gate(code: str) -> str | None:
    """Why this snippet may not run, or None. Static, so a refused generator costs no child."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"syntax: {e.msg}"
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in ALLOWED_IMPORTS:
                    return f"import {a.name}"
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] not in ALLOWED_IMPORTS:
                return f"import {node.module}"
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            return f"name {node.id}"
        elif isinstance(node, ast.Attribute) and node.attr in BANNED_ATTRS:
            return f"attribute {node.attr}"
    return None


def run_snippets(codes: list[str], timeout: float = 8.0) -> list[dict]:
    """Each snippet's {stdout, exception?} or {refused}/{timeout}, same order as ``codes``.
    Refused snippets never reach the child. A child that dies fails every snippet it held."""
    results: list[dict | None] = [None] * len(codes)
    todo: list[tuple[int, str]] = []
    for i, code in enumerate(codes):
        why = gate(code)
        if why:
            results[i] = {"refused": why}
        else:
            todo.append((i, code))
    if todo:
        body = json.dumps({"codes": [c for _, c in todo], "banned": sorted(BANNED_NAMES)})
        try:
            done = subprocess.run(
                [sys.executable, "-I", "-S", "-c", _RUNNER], input=body, text=True,
                capture_output=True, timeout=timeout, env={"PYTHONHASHSEED": "0"}, cwd="/tmp",
            )
            ran = json.loads(done.stdout) if done.returncode == 0 else None
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            ran = None
        for n, (i, _) in enumerate(todo):
            results[i] = ran[n] if ran and n < len(ran) else {"timeout": True}
    return [r or {"timeout": True} for r in results]
