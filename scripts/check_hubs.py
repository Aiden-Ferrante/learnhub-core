#!/usr/bin/env python3
"""check_hubs — the module-hub contract, enforced (see docs/module-hubs.md).

Every package under backend/app is a hub: its __init__.py facade is the only
cross-package import surface, and its docstring is the folder's documentation.
This check fails (exit 1) on:

  1. cross-package DEEP imports  (from app.pkg.module import x — must be from app.pkg import x)
  2. cross-package UNDERSCORE imports (private names never leave a package)
  3. UPWARD imports (violating platform <- content <- domains <- {overview,pipeline} <- api)
  4. a facade missing a real docstring, or containing logic (defs/classes)

Exceptions, by design: backend/tests may deep-import (tests exercise internals);
app/main.py is the assembly point (facade imports only — rules 2-3 still apply).

Usage: python3 scripts/check_hubs.py [--report]
"""

from __future__ import annotations

import ast
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "backend")
APP = os.path.join(ROOT, "app")

# Layer numbers: an import may only target a layer <= its own (same-layer domain
# imports are allowed public-surface-only; upward imports never).
LAYERS = {
    "platform": 0,
    "content": 1,
    "ingestion": 2, "extraction": 2, "study": 2, "search": 2, "media": 2,
    "overview": 3, "pipeline": 3,
    "api": 4,
}

def check() -> list[str]:
    problems: list[str] = []

    # 4. facades: docstring + no logic
    for pkg in LAYERS:
        init = os.path.join(APP, pkg, "__init__.py")
        if not os.path.exists(init):
            problems.append(f"{pkg}: missing __init__.py facade")
            continue
        tree = ast.parse(open(init).read())
        doc = ast.get_docstring(tree)
        if not doc or len(doc.strip()) < 40:
            problems.append(f"{pkg}/__init__.py: facade docstring missing or too thin")
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                problems.append(f"{pkg}/__init__.py: facades hold imports + docs only, found def {node.name}")

    # 1-3. import rules
    for dirpath, dirnames, files in os.walk(APP):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        rel = os.path.relpath(dirpath, APP)
        src_pkg = rel.split(os.sep)[0] if rel != "." else None  # None = app/main.py level
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(dirpath, f)
            short = os.path.relpath(path, ROOT)
            tree = ast.parse(open(path).read())
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom) or not node.module:
                    continue
                if not node.module.startswith("app."):
                    continue
                parts = node.module.split(".")
                tgt = parts[1] if len(parts) > 1 else None
                if tgt not in LAYERS:
                    continue
                cross = tgt != src_pkg
                if cross and len(parts) > 2:
                    problems.append(f"{short}:{node.lineno}: deep import — use `from app.{tgt} import ...`")
                if cross:
                    for a in node.names:
                        if a.name.startswith("_"):
                            problems.append(f"{short}:{node.lineno}: private `{a.name}` imported across packages")
                if src_pkg in LAYERS and cross and LAYERS[tgt] > LAYERS[src_pkg]:
                    problems.append(
                        f"{short}:{node.lineno}: upward import {src_pkg} (L{LAYERS[src_pkg]}) -> {tgt} (L{LAYERS[tgt]})"
                    )
    return problems


def main() -> int:
    problems = check()
    if problems:
        print(f"hub-contract violations: {len(problems)}")
        for p in problems:
            print(f"  {p}")
        return 0 if "--report" in sys.argv else 1
    print("hub contract holds: facades documented, no deep/private/upward cross-package imports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
