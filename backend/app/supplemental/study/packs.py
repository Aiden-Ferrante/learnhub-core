"""Exam packs: the stored side. Decisions live in pack_logic; this file reads and writes.

A pack is one textbook's chapters built into Learn and an exam pool. Marked answers go to
FSRS through ``grade_review`` under one ``pack-`` row per skill, so what you practiced
outlives the pack and instances can change while the memory stays.
"""

from __future__ import annotations

import random
import time
import uuid
from typing import Any

from psycopg.types.json import Json

from app.gateways import db, enqueue_build
from app.process.content import resolve_doc_id, source_id_of
from app.process.packs import render_unseen
from app.supplemental.study.pack_logic import draw_paper, mark, public_question, today_plan
from app.supplemental.study.reviews import grade_review, pack_review_key

DEFAULT_FORMAT = {"count": 20, "minutes": 40, "choices": 5, "writtenShare": 0.2, "closedBook": True}


def clean_format(raw: dict[str, Any] | None) -> dict[str, Any]:
    f = {**DEFAULT_FORMAT, **(raw or {})}
    return {
        "count": max(1, min(100, int(f["count"]))),
        "minutes": max(1, min(300, int(f["minutes"]))),
        "choices": 4 if int(f["choices"]) == 4 else 5,
        "writtenShare": max(0.0, min(1.0, float(f["writtenShare"]))),
        "closedBook": bool(f["closedBook"]),
    }


def create_pack(doc: str | None, title: str, chapters: list[dict[str, str]],
                fmt: dict[str, Any] | None, scope_notes: str, exam_date: str | None) -> dict[str, Any]:
    doc = resolve_doc_id(doc)
    if not doc or not chapters:
        return {"error": "pick a course and at least one chapter"}
    key = uuid.uuid4().hex
    config = {"format": clean_format(fmt), "scopeNotes": (scope_notes or "").strip()}
    with db() as conn:
        conn.execute(
            "INSERT INTO exam_packs (key, doc_id, title, config, exam_date) "
            "VALUES (%(k)s, %(d)s, %(t)s, %(c)s, %(e)s)",
            {"k": key, "d": doc, "t": title.strip() or "Exam pack", "c": Json(config),
             "e": exam_date or None},
        )
        for i, ch in enumerate(chapters):
            conn.execute(
                'INSERT INTO pack_units (key, pack_key, section_key, title, "order") '
                "VALUES (%(k)s, %(p)s, %(s)s, %(t)s, %(o)s)",
                {"k": uuid.uuid4().hex, "p": key, "s": ch["scope"], "t": ch["title"], "o": i},
            )
    enqueue_build(doc, f"pack:{key}", kind="pack", payload={"packKey": key})
    return {"key": key}


def set_scope_notes(key: str, notes: str) -> dict[str, Any]:
    """Change a built pack's scope notes and queue the reweight: new skill weights, same
    questions. Notes steer what a paper draws; they never add material."""
    with db() as conn:
        p = conn.execute("SELECT doc_id, status FROM exam_packs WHERE key = %(k)s", {"k": key}).fetchone()
        if not p:
            return {"error": "no such pack"}
        if p["status"] == "building":
            return {"error": "the pack is still building; change the notes once it is ready"}
        conn.execute("UPDATE exam_packs SET config = jsonb_set(config, '{scopeNotes}', to_jsonb(%(n)s::text)) "
                     "WHERE key = %(k)s", {"n": (notes or "").strip(), "k": key})
    enqueue_build(p["doc_id"], f"reweight:{key}", kind="pack", payload={"packKey": key, "reweight": True})
    return {"ok": True}


def _units(conn, key: str) -> list[dict[str, Any]]:
    return conn.execute(
        'SELECT key, section_key AS "sectionKey", title, "order", status, receipt, progress, '
        'chunk IS NOT NULL AS "hasChunk" FROM pack_units WHERE pack_key = %(k)s ORDER BY "order"',
        {"k": key},
    ).fetchall()


def list_packs(doc: str | None) -> dict[str, Any]:
    doc = resolve_doc_id(doc)
    with db() as conn:
        rows = conn.execute(
            'SELECT p.key, p.title, p.status, p.exam_date::text AS "examDate", '
            "(SELECT count(*) FROM pack_units u WHERE u.pack_key = p.key) AS units, "
            "(SELECT count(*) FROM pack_units u WHERE u.pack_key = p.key AND u.status = 'ready') AS ready, "
            "(SELECT count(*) FROM pack_sittings s WHERE s.pack_key = p.key) AS sittings "
            "FROM exam_packs p WHERE p.doc_id = %(d)s ORDER BY p.created_at DESC",
            {"d": doc},
        ).fetchall()
    return {"packs": rows}


def get_pack(key: str) -> dict[str, Any]:
    with db() as conn:
        p = conn.execute(
            'SELECT key, doc_id AS "docId", title, config, exam_date::text AS "examDate", status, '
            "receipt FROM exam_packs WHERE key = %(k)s", {"k": key},
        ).fetchone()
        if not p:
            return {"error": "no such pack"}
        p["units"] = _units(conn, key)
        p["sittings"] = conn.execute(
            'SELECT key, status, extract(epoch from started_at)::float8 AS "startedAt", '
            'short_by AS "shortBy", jsonb_array_length(questions) AS questions '
            "FROM pack_sittings WHERE pack_key = %(k)s ORDER BY started_at DESC", {"k": key},
        ).fetchall()
    return p


def presets(doc: str | None) -> dict[str, Any]:
    doc = resolve_doc_id(doc)
    with db() as conn:
        rows = conn.execute("SELECT name, format FROM pack_presets WHERE doc_id = %(d)s ORDER BY name",
                            {"d": doc}).fetchall()
    return {"presets": rows, "default": DEFAULT_FORMAT}


def save_preset(doc: str | None, name: str, fmt: dict[str, Any]) -> dict[str, Any]:
    doc = resolve_doc_id(doc)
    with db() as conn:
        conn.execute(
            "INSERT INTO pack_presets (doc_id, name, format) VALUES (%(d)s, %(n)s, %(f)s) "
            "ON CONFLICT (doc_id, name) DO UPDATE SET format = EXCLUDED.format",
            {"d": doc, "n": name.strip(), "f": Json(clean_format(fmt))},
        )
    return {"ok": True}


def _items(conn, pack: str, unit: str | None = None) -> list[dict[str, Any]]:
    return conn.execute(
        "SELECT key, unit_key, skill, skill_label, weight, role, origin, qtype, section_key, "
        "evidence, payload FROM pack_items WHERE pack_key = %(p)s "
        "AND (%(u)s::text IS NULL OR unit_key = %(u)s)",
        {"p": pack, "u": unit},
    ).fetchall()


def _seen(conn, pack: str) -> set[str]:
    return {r["fingerprint"] for r in conn.execute(
        "SELECT fingerprint FROM pack_seen WHERE pack_key = %(p)s", {"p": pack}).fetchall()}


def _see(conn, pack: str, prints: list[str]) -> None:
    for fp in prints:
        conn.execute("INSERT INTO pack_seen (pack_key, fingerprint) VALUES (%(p)s, %(f)s) "
                     "ON CONFLICT DO NOTHING", {"p": pack, "f": fp})


def learn_unit(pack: str, unit: str) -> dict[str, Any]:
    """A chapter's Learn page: chunk, worked steps, book problems, and a short test. The test
    is computed here so its gen instances count as seen and no exam repeats them."""
    with db() as conn:
        u = conn.execute(
            'SELECT key, title, status, chunk, progress, receipt, section_key AS "sectionKey" '
            "FROM pack_units WHERE key = %(u)s AND pack_key = %(p)s", {"u": unit, "p": pack},
        ).fetchone()
        if not u:
            return {"error": "no such unit"}
        items = _items(conn, pack, unit)
        seen = _seen(conn, pack)
        fmt = (conn.execute("SELECT config FROM exam_packs WHERE key = %(p)s",
                            {"p": pack}).fetchone()["config"] or {}).get("format") or {}
        test = []
        shown = []
        rng = random.Random()
        for it in items:
            if it["qtype"] == "gen" and it["role"] == "exam" and len(test) < 3:
                inst = render_unseen(it["payload"]["spec"], seen, rng.randrange(1 << 30),
                                         int(fmt.get("choices") or 5))
                if inst:
                    seen.add(inst["fingerprint"])
                    shown.append(inst["fingerprint"])
                    test.append(_learn_q(it, inst))
            elif it["role"] == "learn" and it["qtype"] == "mcq" and len(test) < 5:
                test.append(_learn_q(it, it["payload"]))
        _see(conn, pack, shown)
    u["worked"] = [_learn_q(i, i["payload"]) for i in items if i["qtype"] == "worked"]
    u["bookProblems"] = [_learn_q(i, i["payload"]) for i in items if i["origin"] == "book_problem"]
    u["test"] = test
    return u


def _learn_q(it: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    return {"itemKey": it["key"], "skill": it["skill"], "skillLabel": it["skill_label"],
            "sectionKey": it["section_key"], "origin": it["origin"], "qtype": it["qtype"],
            "evidence": it["evidence"], **body}


def set_progress(pack: str, unit: str, patch: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        conn.execute("UPDATE pack_units SET progress = progress || %(p)s "
                     "WHERE key = %(u)s AND pack_key = %(k)s",
                     {"p": Json(patch), "u": unit, "k": pack})
    return {"ok": True}


def _grade_skill(doc: str, skill: str, label: str, section: str, grade: int, kind: str) -> None:
    src = source_id_of(doc)
    grade_review({"doc": src, "skill": skill, "skillLabel": label, "sectionKey": section,
                  "eventKind": kind}, pack_review_key(src, skill), grade, time.time())


def grade_learn(pack: str, skill: str, correct: bool) -> dict[str, Any]:
    """A Learn test answer: Good or Again on the skill's long-term row."""
    with db() as conn:
        p = conn.execute("SELECT doc_id FROM exam_packs WHERE key = %(k)s", {"k": pack}).fetchone()
        it = conn.execute("SELECT skill_label, section_key FROM pack_items WHERE pack_key = %(k)s "
                          "AND skill = %(s)s LIMIT 1", {"k": pack, "s": skill}).fetchone()
    if not p or not it:
        return {"error": "no such skill"}
    _grade_skill(p["doc_id"], skill, it["skill_label"], it["section_key"], 3 if correct else 1, "practice")
    return {"ok": True}


def start_sitting(pack: str) -> dict[str, Any]:
    """Freeze a paper of unseen instances, or resume the open one."""
    with db() as conn:
        openrow = conn.execute("SELECT key FROM pack_sittings WHERE pack_key = %(p)s AND status = 'open'",
                               {"p": pack}).fetchone()
        if openrow:
            return fetch_sitting(openrow["key"])
        p = conn.execute("SELECT config FROM exam_packs WHERE key = %(p)s", {"p": pack}).fetchone()
        if not p:
            return {"error": "no such pack"}
        fmt = (p["config"] or {}).get("format") or DEFAULT_FORMAT
        questions, short = draw_paper(_items(conn, pack), fmt, _seen(conn, pack),
                                      random.randrange(1 << 30))
        if not questions:
            return {"error": "nothing unseen left to draw; the pool is exhausted"}
        key = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO pack_sittings (key, pack_key, questions, minutes, short_by) "
            "VALUES (%(k)s, %(p)s, %(q)s, %(m)s, %(s)s)",
            {"k": key, "p": pack, "q": Json(questions), "m": fmt.get("minutes"), "s": short},
        )
        _see(conn, pack, [q["fingerprint"] for q in questions])
    return fetch_sitting(key)


def _sitting(conn, key: str) -> dict[str, Any] | None:
    return conn.execute(
        'SELECT key, pack_key AS "packKey", questions, answers, minutes, short_by AS "shortBy", '
        'status, extract(epoch from started_at)::float8 AS "startedAt" '
        "FROM pack_sittings WHERE key = %(k)s", {"k": key},
    ).fetchone()


def fetch_sitting(key: str) -> dict[str, Any]:
    with db() as conn:
        s = _sitting(conn, key)
    if not s:
        return {"error": "no such sitting"}
    done = s["status"] == "finished"
    s["questions"] = [public_question(q, done) for q in s["questions"]]
    return s


def save_answer(key: str, qkey: str, answer: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        n = conn.execute(
            "UPDATE pack_sittings SET answers = answers || jsonb_build_object(%(q)s::text, %(a)s::jsonb) "
            "WHERE key = %(k)s AND status = 'open'",
            {"q": qkey, "a": Json(answer), "k": key},
        ).rowcount
    return {"ok": True} if n else {"error": "sitting is closed"}


def finish_sitting(key: str) -> dict[str, Any]:
    """Close the paper and send each auto-marked skill to FSRS. A skill wrong anywhere on
    the paper is Again. Written answers grade when you mark them."""
    with db() as conn:
        s = _sitting(conn, key)
        if not s:
            return {"error": "no such sitting"}
        if s["status"] == "finished":
            return results(key)
        conn.execute("UPDATE pack_sittings SET status = 'finished', finished_at = now() "
                     "WHERE key = %(k)s", {"k": key})
        p = conn.execute("SELECT doc_id FROM exam_packs WHERE key = %(k)s",
                         {"k": s["packKey"]}).fetchone()
    verdicts = mark(s["questions"], s["answers"])["verdicts"]
    skills: dict[str, tuple[bool, dict[str, Any]]] = {}
    for q in s["questions"]:
        ok = verdicts[q["key"]]
        if ok is None:
            continue
        prev = skills.get(q["skill"], (True, q))[0]
        skills[q["skill"]] = (prev and ok, q)
    for skill, (ok, q) in skills.items():
        _grade_skill(p["doc_id"], skill, q["skillLabel"], q["sectionKey"], 3 if ok else 1, "exam")
    return results(key)


def mark_written(key: str, qkey: str, grade: int) -> dict[str, Any]:
    """Self-mark a written answer against its worked solution, then feed its skill."""
    with db() as conn:
        s = _sitting(conn, key)
        if not s or s["status"] != "finished":
            return {"error": "finish the paper first"}
        q = next((x for x in s["questions"] if x["key"] == qkey and x["qtype"] == "written"), None)
        if not q:
            return {"error": "not a written question"}
        a = {**(s["answers"].get(qkey) or {}), "selfGrade": grade}
        conn.execute(
            "UPDATE pack_sittings SET answers = answers || jsonb_build_object(%(q)s::text, %(a)s::jsonb) "
            "WHERE key = %(k)s", {"q": qkey, "a": Json(a), "k": key})
        p = conn.execute("SELECT doc_id FROM exam_packs WHERE key = %(k)s",
                         {"k": s["packKey"]}).fetchone()
    _grade_skill(p["doc_id"], q["skill"], q["skillLabel"], q["sectionKey"], grade, "exam")
    return results(key)


def results(key: str) -> dict[str, Any]:
    with db() as conn:
        s = _sitting(conn, key)
    if not s:
        return {"error": "no such sitting"}
    if s["status"] != "finished":
        return {"error": "the paper is still open"}
    return {**s, "score": mark(s["questions"], s["answers"])}


def due_skills(pack: str) -> list[dict[str, Any]]:
    """This pack's skills whose FSRS row is due, each with one fresh instance when it has a
    generator."""
    with db() as conn:
        p = conn.execute("SELECT doc_id FROM exam_packs WHERE key = %(k)s", {"k": pack}).fetchone()
        if not p:
            return []
        src = source_id_of(p["doc_id"])
        items = _items(conn, pack)
        dues = {r["key"] for r in conn.execute(
            "SELECT key FROM concept_reviews WHERE item_type = 'pack' AND doc_id = %(d)s "
            "AND due <= now()", {"d": src}).fetchall()}
    out: dict[str, dict[str, Any]] = {}
    for it in items:
        if pack_review_key(src, it["skill"]) in dues and it["skill"] not in out:
            out[it["skill"]] = {"skill": it["skill"], "label": it["skill_label"],
                                "sectionKey": it["section_key"]}
    return list(out.values())


def review_set(pack: str) -> dict[str, Any]:
    """One question per due skill: a fresh instance where a generator exists, else a Learn
    MCQ. Long-term review, so fresh numbers keep the memory honest."""
    dues = due_skills(pack)
    with db() as conn:
        items = _items(conn, pack)
        seen = _seen(conn, pack)
        shown: list[str] = []
        out = []
        rng = random.Random()
        for d in dues:
            own = [i for i in items if i["skill"] == d["skill"]]
            g = next((i for i in own if i["qtype"] == "gen"), None)
            m = next((i for i in own if i["qtype"] == "mcq"), None)
            if g:
                inst = render_unseen(g["payload"]["spec"], seen, rng.randrange(1 << 30))
                if inst:
                    seen.add(inst["fingerprint"])
                    shown.append(inst["fingerprint"])
                    out.append(_learn_q(g, inst))
                    continue
            if m:
                out.append(_learn_q(m, m["payload"]))
        _see(conn, pack, shown)
    return {"questions": out}


def today(pack: str) -> dict[str, Any]:
    p = get_pack(pack)
    if p.get("error"):
        return p
    last = next((s for s in p["sittings"] if s["status"] == "finished"), None)
    res = results(last["key"]).get("score") if last else None
    return {**today_plan(p, p["units"], due_skills(pack), p["sittings"], res), "examDate": p["examDate"]}
