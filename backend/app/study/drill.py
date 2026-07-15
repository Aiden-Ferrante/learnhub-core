"""Adaptive practice drill — a quiz session over the concepts you most need, not a fixed set.

Selection (desirable difficulty): concepts you've MISSED first (the testing effect is strongest
on errors), then the weakest sections, shuffled within tiers so a whole-course drill INTERLEAVES
across chapters. Unlike the exam it's ungraded practice (no pass/fail, no stage gate) — it just
records events so mastery moves and missed items get a fresh shot.
"""

from __future__ import annotations

import random
import time
import uuid

from app.platform import db
from app.study.concept_quiz_gen import build_concept_question, public_concept_question
from app.study.exam import _doc_pool
from app.content import scope_section_keys
from app.study.mastery import compute_mastery, record_quiz_event
from app.content import resolve_doc_id

_TTL = 60 * 60
_DRILL: dict[str, dict] = {}


def _sweep(now: float) -> None:
    for k in [k for k, v in _DRILL.items() if now - v.get("created", 0) > _TTL]:
        _DRILL.pop(k, None)


def _missed_keys(doc: str | None) -> set[str]:
    """Concept keys with at least one wrong answer on record (recent misses to resurface)."""
    try:
        with db() as conn:
            rows = conn.execute(
                "SELECT DISTINCT concept_key FROM study_events "
                "WHERE (%(d)s::text IS NULL OR doc = %(d)s OR doc IS NULL) "
                "AND correct = false AND concept_key IS NOT NULL AND concept_key <> ''",
                {"d": doc},
            ).fetchall()
        return {r["concept_key"] for r in rows}
    except Exception:  # noqa: BLE001
        return set()


def select_targets(doc: str, scope: str | None, pool: list[dict], n: int) -> list[dict]:
    """Order candidate concepts by practice need: missed first, then weakest sections, with
    interleaving (shuffle within tiers). ``scope`` null = whole course (cross-chapter)."""
    missed = _missed_keys(doc)
    try:
        sec_mastery = compute_mastery(doc=doc).get("bySection", {})
    except Exception:  # noqa: BLE001
        sec_mastery = {}

    if scope:
        keys = scope_section_keys(doc, scope) or set()
        cand = [c for c in pool if c.get("sectionKey") in keys and c.get("signal")]
    else:
        cand = [c for c in pool if c.get("signal")]

    rng = random.Random()

    def section_weakness(c: dict) -> float:
        m = sec_mastery.get(c.get("sectionKey"))
        return 1.0 - (m.get("mastery", 0.0) if isinstance(m, dict) else 0.0)

    missed_c = [c for c in cand if c["key"] in missed]
    rest = [c for c in cand if c["key"] not in missed]
    rng.shuffle(missed_c)  # interleave the misses
    rng.shuffle(rest)  # break ties randomly → cross-chapter interleaving
    rest.sort(key=section_weakness, reverse=True)  # weakest sections first
    return (missed_c + rest)[: max(1, n)]


def start_drill(doc_id: str | None, scope: str | None, n: int = 10) -> dict:
    """Build an adaptive drill: up to ``n`` MCQs over the concepts you most need to practice."""
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}
    pool = _doc_pool(doc_id)
    targets = select_targets(doc_id, scope, pool, n)
    if len(pool) < 4 or not targets:
        return {"error": "Not enough concepts to drill yet — study a chapter first."}

    rng = random.Random()
    missed = _missed_keys(doc_id)
    questions = [q for q in (build_concept_question(t, pool, rng) for t in targets) if q]
    if not questions:
        return {"error": "Could not build drill questions"}

    sid = str(uuid.uuid4())
    now = time.time()
    _sweep(now)
    _DRILL[sid] = {"questions": questions, "doc": doc_id, "scope": scope, "created": now}
    pub = [public_concept_question(q) for q in questions]
    return {
        "sessionId": sid,
        "total": len(questions),
        # How many of the drilled questions target a previously-missed concept (for the UI blurb).
        "fromMisses": sum(1 for q in questions if q.get("conceptKey") in missed),
        "questions": pub,
    }


def grade_drill(session_id: str, answers: list, confidences: list | None = None) -> dict:
    """Score a drill (practice — no pass/fail, no stage gate). Records events (with the learner's
    pre-reveal confidence, for calibration) so mastery moves."""
    sess = _DRILL.pop(str(session_id or ""), None)
    if not sess:
        return {"error": "Unknown or expired drill session — start a new one."}
    questions = sess["questions"]
    confidences = confidences or []
    results = []
    correct = 0
    for i, q in enumerate(questions):
        raw = answers[i] if i < len(answers) else None
        try:
            ans = int(raw)
        except (TypeError, ValueError):
            ans = -1
        ok = ans == q["answer_index"]
        if ok:
            correct += 1
        conf = confidences[i] if i < len(confidences) else None
        record_quiz_event(
            q.get("sectionKey"), ok, doc=sess.get("doc"),
            stem=q.get("expected"), expected=q.get("signal"), concept_key=q.get("conceptKey"),
            kind="drill", confidence=conf if conf in ("guess", "shaky", "confident") else None,
        )
        results.append({
            "correct": ok,
            "expected": q.get("expected"),
            "yourChoice": ans,
            "explanation": q.get("signal") or "",
            "source": q.get("source"),
        })
    total = len(questions)
    score = round(100 * correct / total) if total else 0
    return {"score": score, "correct": correct, "total": total, "results": results}
