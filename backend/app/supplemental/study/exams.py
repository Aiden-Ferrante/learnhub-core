"""Exam sittings — the one assembly over the item pool that stores a row.

Quiz and practice are live queries over ``ext_practice``; an exam is not, and the spec
reserves exactly this escape hatch. Three properties need persistence and none of them
survive a query: the paper must FREEZE when you start (a regeneration mid-exam must not
shift the questions), your answers must survive a reload, and a resit needs two stored
sittings to compare.

What an exam adds over the practice session is one rule: **you commit an answer before you
see the worked solution.** The practice loop reveals on demand, which is right for spaced
practice and useless as an audit — "I knew that" is the easiest lie in studying. Here the
whole paper is answered first and graded second.

Grading is not reimplemented. Each self-grade on the results walk goes through
``study.reviews.grade_review`` exactly as the practice session does, so a sitting moves the
same ``prac-`` FSRS rows and the same production-fluency denominator, tagged
``kind='exam'`` on the event floor so the heatmap can tell the two apart. Keyless and
deterministic, like everything else in the graded path.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from psycopg.types.json import Json

from app.gateways import db
from app.process.content import concept_filter, resolve_doc_id, scope_section_keys, version_sections_by_source

# Per chapter, per sitting. Small enough that a two-chapter paper is sittable in one go.
DEFAULT_PER_CHAPTER = 5
MAX_ITEMS = 60


def _rows_to_sitting(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": row["key"],
        "docId": row["doc_id"],
        "scope": row.get("scope"),
        "config": row.get("config") or {},
        "items": row.get("items") or [],
        "answers": row.get("answers") or {},
        "resitOf": row.get("resit_of"),
        "status": row.get("status"),
        "startedAt": row.get("started_at"),
        "finishedAt": row.get("finished_at"),
    }


def exam_pool(doc: str | None) -> dict[str, Any]:
    """What a paper could be drawn from, BEFORE the pick: per version-section counts by
    kind × difficulty. Zero rows for a section means it has not been processed, and the
    setup screen greys it out — the learner learns that before Start, not from a 400 after.
    Read through ``concept_filter`` like every other pool read, so a re-cut version sees
    its book's items; keys come back translated onto THIS version's outline."""
    doc = resolve_doc_id(doc)
    if not doc:
        return {"docId": None, "sections": {}}
    pred, binds = concept_filter(doc, None)
    with db() as conn:
        rows = conn.execute(
            'SELECT section_key AS "sectionKey", kind, difficulty, count(*) AS n '
            f"FROM ext_practice WHERE {pred} GROUP BY 1, 2, 3",
            binds,
        ).fetchall()
    by_source = version_sections_by_source(doc)
    sections: dict[str, dict[str, dict[str, int]]] = {}
    for r in rows:
        vks = by_source.get(r["sectionKey"]) or [r["sectionKey"]]
        level = str(r["difficulty"]) if r.get("difficulty") is not None else "unrated"
        by_kind = sections.setdefault(vks[0], {}).setdefault(r["kind"], {})
        by_kind[level] = by_kind.get(level, 0) + int(r["n"])
    return {"docId": doc, "sections": sections}


def _pool(
    doc: str,
    picks: list[dict[str, Any]],
    kinds: list[str] | None,
    difficulties: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Every eligible item under the picked scopes, tagged with the pick it came from
    (``chapter`` — the name predates section-level picks and is kept for the tests).

    Reads through ``concept_filter`` per pick, so a version inherits its book's items and
    a re-cut course still assembles — the same rule every other read of the pool follows.
    A difficulty filter EXCLUDES unrated items: "2–3" means rated 2 or 3, and an item
    nobody has rated is not silently promoted into that.
    """
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for pick in picks:
        scope = pick["scope"]
        span = scope_section_keys(doc, scope)
        pred, binds = concept_filter(doc, list(span) if span is not None else None)
        where = [pred]
        if kinds:
            where.append("kind = ANY(%(kinds)s::text[])")
            binds = {**binds, "kinds": list(kinds)}
        if difficulties:
            where.append("difficulty = ANY(%(diffs)s::int[])")
            binds = {**binds, "diffs": [int(d) for d in difficulties]}
        sql = (
            'SELECT key, kind, difficulty, section_key AS "sectionKey" FROM ext_practice '
            f'WHERE {" AND ".join(where)} ORDER BY section_key, "order"'
        )
        with db() as conn:
            for r in conn.execute(sql, binds).fetchall():
                if r["key"] in seen:  # a section inside two picks (a chapter and its own section) counts once
                    continue
                seen.add(r["key"])
                out.append({**r, "chapter": scope})
    return out


def _stratify(pool: list[dict[str, Any]], per_chapter: int | dict[str, int]) -> list[str]:
    """Take up to the pick's count from each pick (an int applies the same count to all),
    round-robin within a pick across its sections so one long section cannot crowd out the
    rest of it. Deterministic given the pool: the variety comes from what was authored,
    not from a shuffle nobody can reproduce."""
    by_chapter: dict[str, dict[str, list[str]]] = {}
    for it in pool:
        by_chapter.setdefault(it["chapter"], {}).setdefault(it.get("sectionKey") or "", []).append(it["key"])
    chosen: list[str] = []
    for chapter in sorted(by_chapter):
        want = per_chapter if isinstance(per_chapter, int) else int(per_chapter.get(chapter, 0))
        sections = by_chapter[chapter]
        taken: list[str] = []
        round_ = 0
        while len(taken) < want:
            added = False
            for sk in sorted(sections):
                if round_ < len(sections[sk]) and len(taken) < want:
                    taken.append(sections[sk][round_])
                    added = True
            if not added:
                break
            round_ += 1
        chosen.extend(taken)
    return chosen[:MAX_ITEMS]


def normalize_picks(
    picks: list[dict[str, Any]] | None,
    chapters: list[str] | None = None,
    per_chapter: int | None = None,
) -> list[dict[str, Any]]:
    """One shape for the two request forms: ``picks=[{scope, count}]`` (v0.23.0) or the
    older ``chapters + perChapter``. Counts are clamped to 1..MAX_ITEMS; empty scopes and
    repeats are dropped (first occurrence wins, matching ``_pool``'s dedupe)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    source: list[dict[str, Any]] = list(picks or [])
    if not source and chapters:
        source = [{"scope": c, "count": per_chapter or DEFAULT_PER_CHAPTER} for c in chapters]
    for p in source:
        scope = str((p or {}).get("scope") or "").strip()
        if not scope or scope in seen:
            continue
        seen.add(scope)
        raw = (p or {}).get("count")
        try:
            count = DEFAULT_PER_CHAPTER if raw is None else int(raw)
        except (TypeError, ValueError):
            count = DEFAULT_PER_CHAPTER
        out.append({"scope": scope, "count": max(1, min(MAX_ITEMS, count))})
    return out


def create_exam(
    doc: str | None,
    chapters: list[str] | None = None,
    per_chapter: int = DEFAULT_PER_CHAPTER,
    kinds: list[str] | None = None,
    *,
    picks: list[dict[str, Any]] | None = None,
    difficulties: list[int] | None = None,
) -> dict[str, Any]:
    """Assemble and freeze a sitting from the learner's pick — which scopes, how many from
    each, which kinds, which difficulties. Returns the sitting, or an error envelope."""
    doc = resolve_doc_id(doc)
    if not doc:
        return {"error": "no document found", "status": 404}
    picks = normalize_picks(picks, chapters, per_chapter)
    if not picks:
        return {"error": "pick at least one chapter or section", "status": 400}
    difficulties = sorted({d for d in (difficulties or []) if d in (1, 2, 3)}) or None
    pool = _pool(doc, picks, kinds, difficulties)
    items = _snapshot(doc, _stratify(pool, {p["scope"]: p["count"] for p in picks}))
    if not items:
        return {
            "error": "nothing in the pool matches that pick — widen it, or generate items first",
            "status": 400,
        }
    key = uuid.uuid4().hex
    scopes = [p["scope"] for p in picks]
    config = {
        "picks": picks,
        "kinds": kinds or None,
        "difficulties": difficulties,
        # Kept for readers of pre-v0.23.0 sittings, which stored only these two.
        "chapters": scopes,
        "perChapter": per_chapter,
    }
    with db() as conn:
        conn.execute(
            "INSERT INTO exam_sessions (key, doc_id, scope, config, items, answers, status, started_at) "
            "VALUES (%(k)s,%(d)s,%(s)s,%(c)s,%(i)s,'{}'::jsonb,'open', now())",
            {
                "k": key, "d": doc,
                "s": scopes[0] if len(scopes) == 1 else None,
                "c": Json(config), "i": Json(items),
            },
        )
    return fetch_exam(key)


def resit(key: str) -> dict[str, Any]:
    """A new sitting of the SAME paper — the item list is copied verbatim, never
    reassembled, which is the whole point of comparing two scores."""
    prior = fetch_exam(key)
    if prior.get("error"):
        return prior
    new_key = uuid.uuid4().hex
    with db() as conn:
        conn.execute(
            "INSERT INTO exam_sessions (key, doc_id, scope, config, items, answers, resit_of, status, started_at) "
            "VALUES (%(k)s,%(d)s,%(s)s,%(c)s,%(i)s,'{}'::jsonb,%(r)s,'open', now())",
            {
                "k": new_key, "d": prior["docId"], "s": prior.get("scope"),
                "c": Json(prior.get("config") or {}), "i": Json(prior["items"]), "r": key,
            },
        )
    return fetch_exam(new_key)


def _snapshot(doc: str, item_keys: list[str]) -> list[dict[str, Any]]:
    """Freeze the paper's QUESTIONS, not just their keys.

    Storing keys alone is not a frozen paper: a regeneration deletes unedited items, so a
    question could vanish from a sitting already in progress, and a resit months later
    would be a different exam wearing the same name. The practice session deliberately
    reads items live — an edit shows on the next card — but a sitting is a historical
    record of what was asked, and the two requirements are opposites.

    Section keys are translated onto this version's outline once, here, so the results
    breakdown keeps working even after the course is re-cut.
    """
    if not item_keys:
        return []
    with db() as conn:
        rows = conn.execute(
            'SELECT key, kind, prompt, answer, rubric, difficulty, section_key AS "sectionKey" '
            "FROM ext_practice WHERE key = ANY(%(ks)s::text[])",
            {"ks": item_keys},
        ).fetchall()
    by_key = {r["key"]: dict(r) for r in rows}
    by_source = version_sections_by_source(doc) if doc else {}
    out = []
    for k in item_keys:
        r = by_key.get(k)
        if not r:
            continue
        vks = by_source.get(r["sectionKey"])
        if vks:
            r["sectionKey"] = vks[0]
        out.append(r)
    return out


def fetch_exam(key: str, *, with_items: bool = True) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT key, doc_id, scope, config, items, answers, resit_of, status, "
            "extract(epoch from started_at)::float8 AS started_at, "
            "extract(epoch from finished_at)::float8 AS finished_at "
            "FROM exam_sessions WHERE key = %(k)s",
            {"k": key},
        ).fetchone()
    if not row:
        return {"error": f"exam {key} not found", "status": 404}
    sitting = _rows_to_sitting(row)
    # The questions ARE the stored snapshot — nothing is re-read from the pool, which is
    # what makes a sitting immune to a regeneration and reproducible on a resit.
    sitting["questions"] = sitting["items"] if with_items else []
    return sitting


def list_exams(doc: str | None) -> dict[str, Any]:
    doc = resolve_doc_id(doc)
    with db() as conn:
        rows = conn.execute(
            "SELECT key, doc_id, scope, config, items, answers, resit_of, status, "
            "extract(epoch from started_at)::float8 AS started_at, "
            "extract(epoch from finished_at)::float8 AS finished_at "
            "FROM exam_sessions WHERE (%(d)s::text IS NULL OR doc_id = %(d)s) "
            "ORDER BY started_at DESC LIMIT 50",
            {"d": doc},
        ).fetchall()
    sittings = []
    for r in rows:
        s = _rows_to_sitting(r)
        graded = [a for a in s["answers"].values() if a.get("selfGrade")]
        s["count"] = len(s["items"])
        s["answered"] = sum(1 for a in s["answers"].values() if (a.get("response") or "").strip())
        s["score"] = _score(graded) if graded else None
        s.pop("answers", None)
        sittings.append(s)
    return {"docId": doc, "exams": sittings}


def save_answer(key: str, item_key: str, response: str) -> dict[str, Any]:
    """Record one written answer. Upsert into the answers map so a reload resumes exactly
    where it left off — the reason a sitting is a row and not a page of React state."""
    with db() as conn:
        row = conn.execute(
            "SELECT items, status FROM exam_sessions WHERE key = %(k)s", {"k": key}
        ).fetchone()
        if not row:
            return {"error": f"exam {key} not found", "status": 404}
        if row.get("status") != "open":
            return {"error": "this sitting is already finished", "status": 409}
        if item_key not in {q.get("key") for q in (row.get("items") or [])}:
            return {"error": "that question is not on this paper", "status": 400}
        conn.execute(
            "UPDATE exam_sessions SET answers = jsonb_set("
            "  COALESCE(answers, '{}'::jsonb), ARRAY[%(ik)s], %(val)s::jsonb, true) "
            "WHERE key = %(k)s",
            {"k": key, "ik": item_key, "val": Json({"response": response, "at": time.time()})},
        )
    return {"saved": item_key}


def finish_exam(key: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "UPDATE exam_sessions SET status = 'finished', finished_at = now() "
            "WHERE key = %(k)s AND status = 'open' RETURNING key",
            {"k": key},
        ).fetchone()
    if not row:
        # Already finished is not an error — a double-submit should land on the results.
        return fetch_exam(key)
    return fetch_exam(key)


def grade_answer(key: str, item_key: str, grade: int, doc: str | None = None) -> dict[str, Any]:
    """Self-grade one answer on the results walk. Routed through the ONE grading engine
    (`grade_review`) so an exam moves the same schedule and the same fluency denominator as
    practice; only the study event is tagged differently."""
    from app.supplemental.study.reviews import grade_review

    # The paper is frozen but the pool is not: an item regenerated or deleted away between
    # sitting and marking has no FSRS row to move. The grade still belongs to the sitting —
    # it is your record of how you did — so it is kept, and `scheduled` says plainly that it
    # fed nothing. Asked before grading rather than inferred from an error code, because the
    # resolver reports a missing item as a 400 and that is indistinguishable from a bad
    # request.
    with db() as conn:
        alive = conn.execute(
            "SELECT 1 FROM ext_practice WHERE key = %(k)s", {"k": item_key}
        ).fetchone()
    scheduled = alive is not None
    if scheduled:
        payload, status = grade_review(
            {"practice": True, "practiceKey": item_key, "doc": doc, "eventKind": "exam"},
            "",
            grade,
            time.time(),
        )
        if status != 200:
            return {**payload, "status": status}
    with db() as conn:
        conn.execute(
            "UPDATE exam_sessions SET answers = jsonb_set("
            "  COALESCE(answers, '{}'::jsonb), ARRAY[%(ik)s], "
            "  COALESCE(answers -> %(ik)s, '{}'::jsonb) || %(val)s::jsonb, true) "
            "WHERE key = %(k)s",
            {"k": key, "ik": item_key, "val": Json({"selfGrade": int(grade)})},
        )
    return {"graded": item_key, "grade": int(grade), "scheduled": scheduled}


def _score(graded: list[dict[str, Any]]) -> dict[str, Any]:
    """A score is 'how many did you answer well', not a percentage of mastery. Grades 3-4
    are the pass side of the same 1-4 scale every other graded activity uses."""
    total = len(graded)
    good = sum(1 for a in graded if int(a.get("selfGrade") or 0) >= 3)
    return {"graded": total, "good": good, "fraction": (good / total) if total else None}


def exam_results(key: str) -> dict[str, Any]:
    """Total, per-section and per-kind breakdown — the point being that a paper should say
    WHICH chapter let you down, not just that one did. Ungraded answers are reported as
    ungraded rather than counted wrong: an unmarked question is missing information."""
    sitting = fetch_exam(key)
    if sitting.get("error"):
        return sitting
    answers = sitting["answers"]
    questions = sitting["questions"]

    graded_all: list[dict[str, Any]] = []
    by_section: dict[str, dict[str, Any]] = {}
    by_kind: dict[str, dict[str, Any]] = {}
    for q in questions:
        a = answers.get(q["key"]) or {}
        sec = q.get("sectionKey") or "—"
        kind = q.get("kind") or "—"
        for bucket, name in ((by_section, sec), (by_kind, kind)):
            b = bucket.setdefault(name, {"total": 0, "graded": 0, "good": 0})
            b["total"] += 1
        if a.get("selfGrade"):
            graded_all.append(a)
            good = int(a["selfGrade"]) >= 3
            by_section[sec]["graded"] += 1
            by_kind[kind]["graded"] += 1
            if good:
                by_section[sec]["good"] += 1
                by_kind[kind]["good"] += 1

    comparison = None
    if sitting.get("resitOf"):
        prior = exam_results(sitting["resitOf"])
        if not prior.get("error"):
            comparison = {"key": sitting["resitOf"], "score": prior["score"],
                          "finishedAt": prior.get("finishedAt")}

    return {
        **sitting,
        "score": _score(graded_all),
        "bySection": by_section,
        "byKind": by_kind,
        "comparison": comparison,
    }
