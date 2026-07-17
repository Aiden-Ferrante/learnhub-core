# Module hubs — the folder contract

*Designed 2026-07-15 (decisions made in session). Status: spec, not yet implemented.*

## The idea in one sentence

Every package under `backend/app/` is a **hub**: its `__init__.py` is the **orchestrator/facade**
— the only thing other packages may import — and that same file's docstring is the folder's
documentation, fed into MAP.md automatically. One file answers both "what does this folder do?"
and "what may I use from it?".

## Decisions (made 2026-07-15)

| Question | Decision |
|---|---|
| What is the orchestrator? | A **public facade**: re-exports the module's public surface; internals become genuinely private. (Modules with real multi-step flows — the conductor — keep their coordinator *behind* the facade.) |
| Enforcement | **CI check, hard fail** — an AST import check in the code-map workflow. Mechanical contracts > prose. |
| Documentation | **Facade docstring, map-fed** — `gen_map.py` extracts it into MAP.md's package sections; the existing map-staleness check covers it. |
| Scope | **All packages** — gateways and api included. Uniformity is what makes the rule teachable and checkable. |

## The contract (what the CI check enforces)

1. **Cross-package imports target the package, never a module inside it.**
   `from app.study import grade_review` ✓ · `from app.study.reviews import grade_review` ✗
   (Inside a package, modules import each other freely — that's what "internal" means.)
2. **Underscore names never cross a package boundary** (already adopted; now checked).
3. **The dependency direction is unchanged and checked**:
   `gateways ← process/content ← domains ← conductor ← api`.
4. **Every facade has a docstring** with three parts: what the module owns, its public surface
   (the `__all__`), what it depends on. Empty or missing docstring fails the check.
5. **Exceptions, stated once**: `backend/tests/` may deep-import (tests exercise internals);
   `app/main.py` is the assembly point (it imports facades, incl. `app.api`'s router list);
   `gateways/ledger`'s injected runner/resolver seam stays — it is *why* gateways never imports up.

## Facade shape (example: `app/supplemental/study/__init__.py`)

```python
"""Study — the learning loop over extracted concepts.

Owns: quiz/exam/drill sessions, SM-2 review scheduling (srs), mastery
computation (coverage x accuracy x decay), and the append-only study_events
floor. Depends on: content (scope + docs), gateways (db).
"""

from app.study.mastery import compute_mastery, record_quiz_event, ...
from app.study.reviews import build_review_queue, grade_review, ...

__all__ = [...]
```

No logic in `__init__.py` — imports and the docstring only. The facade is a table of
contents, not a place for code.

## Why `__init__.py` and not a separate `orchestrator.py`

`from app.study import grade_review` is the natural Python spelling of "import through the
hub" — the package name *is* the hub. A separate `orchestrator.py` would make every import
one segment longer and create a second convention to police (`__init__` must stay empty).
The docstring requirement gives the folder its visible front door either way.

## What implements it

- `scripts/check_hubs.py` — AST walk (~100 lines): flags cross-package deep imports,
  cross-package underscore imports, upward (layer-violating) imports, missing facade
  docstrings. Modes: `--report` (list) and default (exit 1 on any finding).
- `gen_map.py` extension — pulls each facade docstring's first paragraph into the package
  heading in MAP.md (replacing the hand-written blurbs, which then can't drift).
- `.github/workflows/code-map.yml` — add the check as a hard-fail step.

## Migration (mechanical, ~149 deep-import sites measured 2026-07-15)

1. Write the 10 facades + docstrings (public surface = what other packages import *today* —
   the measured edge list is the spec).
2. Repoint the 149 cross-package imports to facades (mechanical rewrite).
3. Run `check_hubs.py --report`; fix stragglers; flip to hard fail in CI.
4. Later moves (audit §3: admin_routes dismantle, study reshuffle, gateways tidies) get
   easier, not harder — call sites already face facades, so moving internals stops
   touching other packages.

Interaction with audit moves 3–6: hub-ification goes **first**; it's independent and
mechanical, and it turns the remaining moves into single-package changes.
