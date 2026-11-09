"""Exam-pack decisions with no database: draw a paper, mark it, say what to do today.

Kept pure so the rules the human set are testable directly: a paper reads exam items only,
never repeats what you have seen, comes up short rather than padding, and a written answer
leaves the score provisional until you mark it.
"""

from __future__ import annotations

import random
from typing import Any

from app.process.packs import render_unseen


def _question(item: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": f"{item['key']}:{body.get('fingerprint', 'x')}", "itemKey": item["key"],
        "qtype": "written" if item["qtype"] == "written" else "choice",
        "unitKey": item["unit_key"], "skill": item["skill"], "skillLabel": item["skill_label"],
        "sectionKey": item["section_key"], "origin": item["origin"],
        "evidence": item["evidence"], **body,
    }


def _instance(item: dict[str, Any], seen: set[str], seed: int, choices: int):
    if item["qtype"] == "gen":
        return render_unseen(item["payload"]["spec"], seen, seed, choices)
    fp = f"item:{item['key']}"
    return None if fp in seen else {**item["payload"], "fingerprint": fp}


GEN_SERVES = 5  # a generator's most questions on one paper: the same 5 the build receipt counts it as


def weighted_pick(cands: list[dict[str, Any]], rng: random.Random) -> int:
    """Index of one candidate, chosen with probability proportional to its weight."""
    weights = [max(0.05, float(c.get("weight") or 1)) for c in cands]
    return max(range(len(cands)), key=lambda i: rng.random() ** (1.0 / weights[i]))


def draw_paper(items: list[dict[str, Any]], fmt: dict[str, Any], seen: set[str],
               seed: int) -> tuple[list[dict[str, Any]], int]:
    """(questions, how many short). Units take turns so a paper spreads across the chapters
    picked. Within a chapter, each pick is drawn in proportion to its skill's weight, so a
    skill the scope notes weight 2 comes up about twice as often as one at 1. A generator may
    serve up to GEN_SERVES questions with fresh numbers; a fixed item serves one. When the
    pool runs dry the paper ends there."""
    count = int(fmt.get("count") or 20)
    choices = int(fmt.get("choices") or 5)
    want_written = round(count * float(fmt.get("writtenShare") or 0))
    rng = random.Random(seed)
    pool = [i for i in items if i["role"] == "exam" and i["origin"] != "book_problem"]
    used = set(seen)
    out: list[dict[str, Any]] = []

    def take(cands: list[dict[str, Any]], limit: int) -> None:
        units: dict[str, list[dict[str, Any]]] = {}
        for it in cands:
            units.setdefault(it["unit_key"], []).append(it)
        served: dict[str, int] = {}
        taken = 0
        progress = True
        while taken < limit and progress:
            progress = False
            for u in units.values():
                if taken >= limit or not u:
                    continue
                it = u[weighted_pick(u, rng)]
                body = _instance(it, used, rng.randrange(1 << 30), choices)
                served[it["key"]] = served.get(it["key"], 0) + 1
                if it["qtype"] != "gen" or not body or served[it["key"]] >= GEN_SERVES:
                    u.remove(it)  # fixed items serve once; a generator until its cap or dry
                if not body:
                    progress = True  # this unit still has others to try
                    continue
                used.add(body["fingerprint"])
                out.append(_question(it, body))
                taken += 1
                progress = True

    take([i for i in pool if i["qtype"] == "written"], want_written)
    take([i for i in pool if i["qtype"] in ("gen", "mcq")], count - len(out))
    rng.shuffle(out)
    return out, max(0, count - len(out))


def public_question(q: dict[str, Any], finished: bool) -> dict[str, Any]:
    """What the learner may see: nothing that marks the answer until the paper is in."""
    if finished:
        return q
    return {k: q[k] for k in ("key", "qtype", "unitKey", "skillLabel", "stem", "choices",
                              "sectionKey") if k in q}


def mark(questions: list[dict[str, Any]], answers: dict[str, Any]) -> dict[str, Any]:
    """Score plus chapter and skill breakdowns. A written question counts once self-marked;
    until then it is pending and the score says provisional."""
    good = total = pending = 0
    units: dict[str, dict[str, int]] = {}
    skills: dict[str, dict[str, Any]] = {}
    verdicts: dict[str, bool | None] = {}
    for q in questions:
        a = answers.get(q["key"]) or {}
        if q["qtype"] == "written":
            ok = None if a.get("selfGrade") is None else int(a["selfGrade"]) >= 3
        else:
            ok = a.get("choice") == q.get("answer")
        verdicts[q["key"]] = ok
        for bucket, name in ((units, q["unitKey"]), (skills, q["skill"])):
            row = bucket.setdefault(name, {"total": 0, "good": 0, "pending": 0})
            row["total"] += 1
            row["good"] += 1 if ok else 0
            row["pending"] += 1 if ok is None else 0
            if bucket is skills:
                row.update(label=q["skillLabel"], sectionKey=q["sectionKey"])
        total += 1
        good += 1 if ok else 0
        pending += 1 if ok is None else 0
    return {"good": good, "total": total, "pending": pending, "provisional": pending > 0,
            "units": units, "skills": skills, "verdicts": verdicts}


def today_plan(pack: dict[str, Any], units: list[dict[str, Any]], due_skills: list[dict[str, Any]],
               sittings: list[dict[str, Any]], results: dict[str, Any] | None) -> dict[str, Any]:
    """One thing to do now, then the rest in order. Due reviews first: they decay. Then
    the next unit's next stage, then weak skills, then a sitting."""
    steps: list[dict[str, Any]] = []
    if due_skills:
        steps.append({"kind": "review", "title": f"Review {len(due_skills)} due skills",
                      "minutes": min(30, 4 * len(due_skills)), "unitKey": None})
    for u in units:
        if u["status"] != "ready":
            continue
        p = u.get("progress") or {}
        for stage, title, mins in (("chunk", "read the chunk", 10), ("steps", "work the steps", 15),
                                   ("test", "take the short test", 10)):
            if not p.get(stage):
                steps.append({"kind": "learn", "title": f"{u['title']}: {title}", "minutes": mins,
                              "unitKey": u["key"], "stage": stage})
                break
    if results:
        weak = [s for s in results["skills"].values() if s["good"] < s["total"] - s["pending"]]
        if weak:
            steps.append({"kind": "weak", "title": f"Rework {len(weak)} missed skills",
                          "minutes": 5 * len(weak), "unitKey": None})
    finished = [s for s in sittings if s.get("status") == "finished"]
    open_ = [s for s in sittings if s.get("status") == "open"]
    if open_:
        steps.insert(0, {"kind": "exam", "title": "Finish your open sitting", "minutes": None,
                         "unitKey": None})
    elif not any(s["kind"] == "learn" for s in steps):
        fmt = (pack.get("config") or {}).get("format") or {}
        title = "Sit a fresh paper" if finished else "Sit your first paper"
        steps.append({"kind": "exam", "title": title, "minutes": fmt.get("minutes"), "unitKey": None})
    return {"now": steps[0] if steps else None, "next": steps[1:]}
