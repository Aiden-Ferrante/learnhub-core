"""Free-recall "brain dump" — the generation effect. The learner writes everything they remember
about a chapter from memory; we compare it to the chapter's concept list (keyless term-match) and
show what they covered vs missed. Records a 'recall' engagement event.
"""

from __future__ import annotations

import re

from app.extraction.concept_store import fetch_section_concepts
from app.study.mastery import record_engagement


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())).strip()


def check_recall(doc: str | None, scope: str | None, text: str) -> dict:
    """Compare a free-recall dump to the chapter's concepts. A concept counts as recalled if its
    (normalized) name appears in the dump, or at least half of its significant words do."""
    if not scope:
        return {"error": "Open a chapter to free-recall it.", "covered": [], "missed": [], "coverage": 0, "total": 0}
    res = fetch_section_concepts(scope, doc)
    if res.get("error"):
        return {"error": res["error"], "covered": [], "missed": [], "coverage": 0, "total": 0}

    names: list[str] = []
    seen: set[str] = set()
    for c in res.get("concepts", []):
        n = (c.get("name") or "").strip()
        if n and n.lower() not in seen:
            seen.add(n.lower())
            names.append(n)

    dump = _norm(text or "")
    dump_words = set(dump.split())
    covered: list[str] = []
    missed: list[str] = []
    for n in names:
        nn = _norm(n)
        nwords = [w for w in nn.split() if len(w) > 3]
        hit = (
            bool(nn) and nn in dump
        ) or (
            bool(nwords) and sum(1 for w in nwords if w in dump_words) >= max(1, (len(nwords) + 1) // 2)
        )
        (covered if hit else missed).append(n)

    if (text or "").strip():
        record_engagement("recall", scope, doc=doc)
    total = len(names)
    return {
        "covered": covered,
        "missed": missed,
        "coverage": round(100 * len(covered) / total) if total else 0,
        "total": total,
    }
