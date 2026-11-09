"""Build a pack: for each chapter, a chunk, skills, Learn items and an exam pool.

Only the textbook goes in. Each output names a section and quotes it, and ``grounded``
checks that quote against the stored text, so a citation is a checked fact and scope notes
can reweight what the book says but cannot add to it. Generators must also pass the seed
harness, and everything left is judged by a second model. What fails is dropped with its
reason on the receipt, and a chapter that cannot fill its share of a paper is marked thin.
"""

from __future__ import annotations

import math
import os
import re
import uuid
from typing import Any

from psycopg.types.json import Json

from app.gateways import db
from app.gateways import (
    ollama_structured_completion,
    PackBookProblemSet,
    PackChunk,
    PackConceptSet,
    PackGeneratorSet,
    PackSkillSet,
    PackVerdictSet,
    PackWorkedSet,
)
from app.process.content import load_section_blocks, source_id_of
from app.process.packs import gen
from app.process.packs.answers import computed_answers, furniture, snippet_of
from app.process.packs.sandbox import run_snippets


def _author_model(override: str | None = None) -> str | None:
    """request model → LEARN_PRACTICE_MODEL → LEARN_EXTRACT_MODEL → llm.py's default.
    (The env names predate packs; they were the practice authors' and are kept.)"""
    return (
        override
        or os.environ.get("LEARN_PRACTICE_MODEL")
        or os.environ.get("LEARN_EXTRACT_MODEL")
        or None
    )


def _judge_model() -> str | None:
    """LEARN_PRACTICE_JUDGE_MODEL judges; unset, the author judges its own items."""
    return os.environ.get("LEARN_PRACTICE_JUDGE_MODEL") or None

SUMMARY_HEADING = re.compile(r"\b(summary|key takeaways?|recap)\b", re.I)
PROBLEM_HEADING = re.compile(r"\b(quiz|exercises?|problems?|review questions|self[- ]test)\b", re.I)
MIN_EVIDENCE = 15
PER_SECTION = 7000
TOTAL = 45000
RULES = (
    "Use ONLY the supplied textbook sections. Never add a fact, example or topic they do not "
    "contain. Every output names the sectionKey it came from and an `evidence` field: at "
    "least four consecutive words copied exactly from that section. Ask about the subject, "
    "never about the source: do not mention the textbook, the text, the book, the author, a "
    "chapter, a section, a figure, a table or a numbered step in any stem, choice or answer."
)


def normalize(text: str) -> str:
    text = re.sub(r"[`*_#>|\\]", "", text or "")
    return re.sub(r"\s+", " ", text).strip().lower()


def grounded(evidence: str, section_key: str, sections: dict[str, str]) -> str | None:
    """Why this citation fails, or None. The quote must really be in the cited section."""
    if section_key not in sections:
        return f"cites unknown section {section_key}"
    quote = normalize(evidence)
    if len(quote) < MIN_EVIDENCE:
        return "evidence too short"
    if quote not in normalize(sections[section_key]):
        return "evidence not found in cited section"
    return None


def locate(evidence: str, section_key: str, sections: dict[str, str]) -> str | None:
    """The section that really holds this quote: the cited one, else the only other match.
    Models shorten keys like ``toc:2.3~2``; the quote is the fact, so it decides."""
    if grounded(evidence, section_key, sections) is None:
        return section_key
    quote = normalize(evidence)
    if len(quote) < MIN_EVIDENCE:
        return None
    hits = [k for k, text in sections.items() if quote in normalize(text)]
    return hits[0] if len(hits) == 1 else None


def sort_sections(sections: list[Any]) -> dict[str, list[Any]]:
    """Split a chapter by what the book provides there."""
    out: dict[str, list[Any]] = {"summary": [], "problems": [], "body": []}
    for s in sections:
        h = s.heading or ""
        out["summary" if SUMMARY_HEADING.search(h)
            else "problems" if PROBLEM_HEADING.search(h) else "body"].append(s)
    return out


def _passages(sections: list[Any]) -> str:
    parts, used = [], 0
    for s in sections:
        text = (s.markdown or "")[:PER_SECTION]
        if used + len(text) > TOTAL:
            break
        used += len(text)
        parts.append(f'<section key="{s.source_section_key}" heading="{s.heading}">\n{text}\n</section>')
    return "\n".join(parts)


def _ask(system: str, user: str, schema: Any, model: str | None) -> dict[str, Any]:
    obj, err = ollama_structured_completion(
        [{"role": "system", "content": f"{system}\n\n{RULES}"}, {"role": "user", "content": user}],
        schema, temperature=0.3, model=model,
    )
    if err or obj is None:
        raise RuntimeError(err or "no response")
    return obj


def spec_of(g: dict[str, Any]) -> dict[str, Any]:
    params = {p["name"]: ({"kind": "choice", "values": p["values"]} if p["kind"] == "choice"
                          else {"kind": "int", "min": p["min"], "max": p["max"]})
              for p in g.get("params") or []}
    return {"params": params, "stem": g["stem"], "code": g["code"], "explain": g.get("explain", ""),
            "distractors": g.get("distractors") or [], "steps": g.get("steps") or []}


def mcq_flaw(m: dict[str, Any], choices: int) -> str | None:
    opts = [normalize(c) for c in m.get("choices") or []]
    if len(opts) != choices or len(set(opts)) != choices:
        return f"needs {choices} distinct choices"
    if not 0 <= int(m.get("answerIndex", -1)) < choices:
        return "answer index out of range"
    if any(re.search(r"\b(all|none) of the above\b", o) for o in opts):
        return "all/none of the above"
    return None


def confirmed_index(problem: dict[str, Any]) -> int:
    """The key for a book problem: its printed answer, else a solver run that matches one
    choice exactly. -1 means no one can confirm it, so it stays self-marked."""
    choices = problem.get("choices") or []
    if 0 <= int(problem.get("answerIndex", -1)) < len(choices):
        return int(problem["answerIndex"])
    code = snippet_of(problem.get("stem") or "", problem.get("code") or "")
    if code and choices:
        out = (run_snippets([code])[0].get("stdout") or "").strip()
        hits = [i for i, c in enumerate(choices) if c.strip() == out]
        if out and len(hits) == 1:
            return hits[0]
    return -1


def author_unit(unit: dict[str, Any], sections: list[Any], fmt: dict[str, Any], notes: str,
                paper_share: int, author: str | None, judge: str | None) -> dict[str, Any]:
    """One chapter → {chunk, items, receipt}. Pure of the database, so a stubbed model can
    exercise every drop path."""
    split = sort_sections(sections)
    texts = {s.source_section_key: s.markdown or "" for s in sections}
    body = _passages(split["body"])
    all_text = _passages(split["body"] + split["summary"])
    choices = int(fmt.get("choices") or 5)
    dropped: list[dict[str, str]] = []

    def keep(kind: str, what: str, x: dict[str, Any]) -> bool:
        """Check a citation, correcting it to the section that really holds the quote."""
        real = locate(x["evidence"], x["sectionKey"], texts)
        if real is None:
            why = grounded(x["evidence"], x["sectionKey"], texts) or "evidence is ambiguous"
            dropped.append({"kind": kind, "what": what[:80], "reason": why})
            return False
        x["sectionKey"] = real
        return True

    source = "book_summary" if split["summary"] else "sections"
    chunk_src = _passages(split["summary"]) + "\n" + body if split["summary"] else body
    chunk_obj = _ask(
        "Compress this chapter into 6 to 12 short study points for a final review. Prefer the "
        "book's own summary where one is given. Use descriptive, code-like names over bare symbols.",
        chunk_src, PackChunk, author)
    points = [{"text": p["text"], "sectionKey": p["sectionKey"]} for p in chunk_obj["points"]
              if keep("chunk", p["text"], p)]

    steer = f"\n\nThe learner's scope notes, for WEIGHTING only:\n{notes}" if notes else ""
    skills_obj = _ask(
        "List the 3 to 8 distinct skills this chapter teaches. style=computable when a question "
        "can be answered by running Python, including what a program prints or which error it "
        "raises; otherwise conceptual. weight 1 is normal; raise it for what the scope notes "
        "emphasize. A note that asks for material not in these sections changes nothing.",
        all_text + steer, PackSkillSet, author)
    skills = {s["id"]: s for s in skills_obj["skills"]
              if keep("skill", s["label"], s)}
    listing = "\n".join(f"- {s['id']} ({s['style']}): {s['label']}" for s in skills.values())
    items: list[dict[str, Any]] = []

    def add(skill_id: str, role: str, origin: str, qtype: str, section: str, evidence: str,
            payload: dict[str, Any]) -> None:
        s = skills[skill_id]
        items.append({"skill": skill_id, "skill_label": s["label"], "weight": s.get("weight", 1),
                      "role": role, "origin": origin, "qtype": qtype, "section_key": section,
                      "evidence": evidence, "payload": payload})

    def known(kind: str, x: dict[str, Any]) -> bool:
        if x["skillId"] not in skills:
            dropped.append({"kind": kind, "what": x.get("stem", "")[:80], "reason": "unknown skill"})
            return False
        if x.get("origin") != "book_problem":
            text = " ".join([x.get("stem", ""), *(x.get("choices") or []), str(x.get("answer") or "")])
            hit = furniture(text)
            if hit:
                dropped.append({"kind": kind, "what": x.get("stem", "")[:80],
                                "reason": f"points at the book: {hit!r}"})
                return False
        return True

    book: list[dict[str, Any]] = []
    if split["problems"]:
        got = _ask(
            "Extract the practice problems exactly as printed, one per problem. Give the choices if "
            "any, answerIndex or printedAnswer ONLY when the book prints the answer, and `code` "
            "only if a program in the problem can be run as printed to get the answer.\n\nSkills:\n"
            + listing, _passages(split["problems"]), PackBookProblemSet, author)
        for p in got["problems"]:
            p["origin"] = "book_problem"  # the book's own wording is quoted, not authored
            if known("book problem", p) and keep("book problem", p["stem"], p):
                book.append(p)
        open_ = [p for p in book if not p.get("printedAnswer") and not p.get("choices")]
        ran = dict(zip(map(id, open_), computed_answers([(p["stem"], p.get("code") or "") for p in open_])))
        for p in book:
            idx = confirmed_index(p)
            body = {"stem": p["stem"], "choices": p.get("choices") or [],
                    "answer": idx if idx >= 0 else None, "printedAnswer": p.get("printedAnswer") or ""}
            if ran.get(id(p)):
                body["computedAnswer"] = ran[id(p)]
            add(p["skillId"], "learn", "book_problem", "mcq" if idx >= 0 else "written",
                p["sectionKey"], p["evidence"], body)

    worked = _ask("Write one worked example per skill, using the book's own examples where it has "
                  "them, split into 3 to 6 steps. Each step asks what to do next, then shows it.\n\n"
                  "Skills:\n" + listing, all_text, PackWorkedSet, author)
    for w in worked["worked"]:
        if known("worked", w) and keep("worked", w["stem"], w):
            add(w["skillId"], "learn", "generated", "worked", w["sectionKey"], w["evidence"],
                {"stem": w["stem"], "steps": w["steps"], "answer": w["answer"]})

    computable = [s for s in skills.values() if s["style"] == "computable"]
    if computable:
        lines = "\n".join(f"- {s['id']}: {s['label']}" for s in computable)
        seeds = "\n".join(f"- [{p['skillId']}] {p['stem']}" for p in book)
        gens = _ask(
            "Write one or two question generators per skill. `code` is a Python snippet whose printed "
            "output IS the answer; {{name}} slots take the params; {{code}} in the stem shows the "
            f"snippet. Give at least {choices + 1} distractors, each a realistic bug naming the "
            "misconception. Only math, string, itertools, functools and collections may be imported; "
            "no input(), files, getattr, randomness or time. Vary numbers enough that outputs differ. "
            "Where a book problem fits, base a generator on its idea with new values, set "
            "basedOnBookProblem=true, and do not copy its text.\n\nSkills:\n" + lines
            + ("\n\nBook problems:\n" + seeds if seeds else ""),
            all_text, PackGeneratorSet, author)
        for g in gens["generators"]:
            if not known("generator", g) or not keep("generator", g["stem"], g):
                continue
            spec = spec_of(g)
            why = gen.harness(spec, choices)
            if why:
                dropped.append({"kind": "generator", "what": g["stem"][:80], "reason": why})
                continue
            add(g["skillId"], "exam", "variant" if g.get("basedOnBookProblem") else "generated",
                "gen", g["sectionKey"], g["evidence"], {"spec": spec})

    concepts = [s for s in skills.values() if s["style"] == "conceptual"]
    if concepts:
        lines = "\n".join(f"- {s['id']}: {s['label']}" for s in concepts)
        got = _ask(
            f"For each skill write 4 scenario MCQs with exactly {choices} choices: a concrete situation "
            "that requires applying the idea, not recalling a sentence. Each wrong choice is a plausible "
            "misunderstanding; no 'all of the above'; the key must not be the longest choice by habit. "
            "Also write 2 written questions per skill with a model answer and marking rubric.\n\n"
            "Skills:\n" + lines, all_text, PackConceptSet, author)
        seen_learn: set[str] = set()
        for m in got["mcqs"]:
            if not known("mcq", m) or not keep("mcq", m["stem"], m):
                continue
            flaw = mcq_flaw(m, choices)
            if flaw:
                dropped.append({"kind": "mcq", "what": m["stem"][:80], "reason": flaw})
                continue
            role = "exam" if m["skillId"] in seen_learn else "learn"
            seen_learn.add(m["skillId"])
            add(m["skillId"], role, "generated", "mcq", m["sectionKey"], m["evidence"],
                {"stem": m["stem"], "choices": m["choices"], "answer": m["answerIndex"],
                 "explain": m["explain"]})
        for w in got["written"]:
            if known("written", w) and keep("written", w["stem"], w):
                add(w["skillId"], "exam", "generated", "written", w["sectionKey"], w["evidence"],
                    {"stem": w["stem"], "answer": w["answer"], "rubric": w["rubric"]})

    items = judged(items, all_text, choices, judge, dropped)
    capacity = pool_capacity(items)
    receipt = {
        "source": source, "bookProblems": sum(i["origin"] == "book_problem" for i in items),
        "skills": len(skills), "kept": len(items), "dropped": dropped,
        "droppedCount": len(dropped), "capacity": capacity, "share": paper_share,
        "thin": capacity < paper_share,
    }
    return {"chunk": {"points": points, "source": source}, "items": items, "receipt": receipt}


def pool_capacity(items: list[dict[str, Any]]) -> int:
    """How many unseen questions this chapter can supply. Fixed items serve once; a generator
    is counted as five so one spec cannot make a chapter look deep."""
    n = 0
    for i in items:
        if i["role"] == "exam":
            n += 5 if i["qtype"] == "gen" else 1
    return n


def judged(items: list[dict[str, Any]], text: str, choices: int, model: str | None,
           dropped: list[dict[str, str]]) -> list[dict[str, Any]]:
    """A second model checks each exam-facing item against the book. A failed judge call
    drops nothing but says so: an unjudged item is counted, never passed silently."""
    exam = [i for i in items if i["role"] == "exam" or i["qtype"] == "mcq"]
    if not exam:
        return items
    lines = []
    for n, i in enumerate(exam):
        if i["qtype"] == "gen":
            sample = gen.render_unseen(i["payload"]["spec"], set(), 1, choices) or {}
            lines.append(f"[{n}] {sample.get('stem')}\nChoices: {sample.get('choices')}\n"
                         f"Key: {(sample.get('choices') or [''])[sample.get('answer', 0)]}")
        else:
            lines.append(f"[{n}] {i['payload']}")
    try:
        got = _ask("Judge each exam item against the sections. keep=false if it is unsupported by "
                   "them, the key is wrong, it is ambiguous, or the question gives away its answer. "
                   "Give a short reason.", text + "\n\nItems:\n" + "\n\n".join(lines),
                   PackVerdictSet, model)
    except RuntimeError as e:
        dropped.append({"kind": "judge", "what": f"{len(exam)} items left unjudged", "reason": str(e)[:120]})
        return items
    bad = {v["index"]: v["reason"] for v in got["verdicts"] if not v["keep"]}
    remove = set()
    for n, reason in bad.items():
        if 0 <= n < len(exam):
            remove.add(id(exam[n]))
            dropped.append({"kind": exam[n]["qtype"], "what": str(exam[n]["payload"].get("stem") or
                            exam[n]["payload"].get("spec", {}).get("stem"))[:80], "reason": f"judge: {reason}"})
    return [i for i in items if id(i) not in remove]


def _store_unit(pack: str, unit: str, built: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute("DELETE FROM pack_items WHERE unit_key = %(u)s", {"u": unit})
        for it in built["items"]:
            conn.execute(
                "INSERT INTO pack_items (key, pack_key, unit_key, skill, skill_label, weight, role, "
                "origin, qtype, section_key, evidence, payload) VALUES (%(k)s, %(p)s, %(u)s, %(s)s, "
                "%(l)s, %(w)s, %(r)s, %(o)s, %(q)s, %(sk)s, %(e)s, %(pl)s)",
                {"k": uuid.uuid4().hex, "p": pack, "u": unit, "s": it["skill"], "l": it["skill_label"],
                 "w": it["weight"], "r": it["role"], "o": it["origin"], "q": it["qtype"],
                 "sk": it["section_key"], "e": it["evidence"], "pl": Json(it["payload"])},
            )
        conn.execute("UPDATE pack_units SET status = 'ready', chunk = %(c)s, receipt = %(r)s "
                     "WHERE key = %(u)s",
                     {"c": Json(built["chunk"]), "r": Json(built["receipt"]), "u": unit})


def build_pack(pack: str, on_progress=None) -> dict[str, Any]:
    """The ledgered job. Each chapter commits as it finishes, so it opens right away and a
    failure in one leaves the others usable. Units already ready are skipped on a re-run."""
    with db() as conn:
        p = conn.execute("SELECT doc_id, config FROM exam_packs WHERE key = %(k)s", {"k": pack}).fetchone()
        units = conn.execute('SELECT key, section_key, title, status FROM pack_units '
                             'WHERE pack_key = %(k)s ORDER BY "order"', {"k": pack}).fetchall()
    if not p:
        return {"error": "no such pack"}
    config = p["config"] or {}
    fmt = config.get("format") or {}
    share = math.ceil(int(fmt.get("count") or 20) / max(1, len(units)))
    author, judge = _author_model(None), _judge_model()
    for n, u in enumerate(units):
        if u["status"] == "ready":
            continue
        with db() as conn:
            conn.execute("UPDATE pack_units SET status = 'building' WHERE key = %(u)s", {"u": u["key"]})
        try:
            sections = load_section_blocks(p["doc_id"], scope=u["section_key"], coalesce=True)
            if not sections:
                raise RuntimeError("chapter has no readable sections")
            built = author_unit(u, sections, fmt, config.get("scopeNotes") or "", share, author, judge)
            _store_unit(pack, u["key"], built)
        except Exception as e:  # noqa: BLE001  # one chapter must not sink the pack
            with db() as conn:
                conn.execute("UPDATE pack_units SET status = 'failed', receipt = %(r)s WHERE key = %(u)s",
                             {"r": Json({"error": str(e)[:200]}), "u": u["key"]})
        if on_progress:
            on_progress(n + 1, len(units), u["title"])
    return finalize_pack(pack)


def pack_totals(units: list[dict[str, Any]]) -> dict[str, Any]:
    """The pack receipt, summed over every chapter's own receipt. Computed from the stored
    units, not from this run, so re-running one failed chapter cannot shrink the totals."""
    totals: dict[str, Any] = {"kept": 0, "dropped": 0, "thin": [], "failed": []}
    for u in units:
        r = u.get("receipt") or {}
        if u["status"] == "ready":
            totals["kept"] += int(r.get("kept") or 0)
            totals["dropped"] += int(r.get("droppedCount") or 0)
            if r.get("thin"):
                totals["thin"].append(u["title"])
        elif u["status"] == "failed":
            totals["failed"].append({"title": u["title"], "error": str(r.get("error") or "")[:200]})
    return totals


def finalize_pack(pack: str) -> dict[str, Any]:
    with db() as conn:
        units = conn.execute('SELECT title, status, receipt FROM pack_units WHERE pack_key = %(k)s '
                             'ORDER BY "order"', {"k": pack}).fetchall()
        totals = pack_totals(units)
        ok = any(u["status"] == "ready" for u in units)
        conn.execute("UPDATE exam_packs SET status = %(s)s, receipt = %(r)s WHERE key = %(k)s",
                     {"s": "ready" if ok else "failed", "r": Json(totals), "k": pack})
    return totals


__all__ = ["build_pack", "author_unit", "grounded", "sort_sections", "source_id_of"]
