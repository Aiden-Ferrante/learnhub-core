"""Chapter skeleton — the ordered sections + a one-line essence each. This is the memory
scaffold the learner reproduces from memory (free recall + self-grade), the keystone of the
chapter learning path.

Also owns the per-chapter PATH PROGRESS store, which later stages (orient, quizzes, exam,
lock-in) write into so the journey has one source of truth for soft-gate completion.
"""

from __future__ import annotations

import hashlib
import re
import time

from app.arango_content import fetch_latest_document
from app.arango_tree import connect_arango
from app.extract import _load_section_blocks
from app.llm import ollama_structured_completion
from app.llm_schemas import Orient, Skeleton

SKELETONS = "chapter_skeletons"
ORIENT = "chapter_orient"
PROGRESS = "chapter_progress"

# Self-grade scale for the skeleton recall. Soft gate: "most" or better completes the stage.
GRADE_VALUE = {"missed": 1, "partial": 2, "most": 3, "nailed": 4}


def _key(doc_id: str, scope: str | None) -> str:
    return hashlib.sha256(f"{doc_id}|{scope or 'ALL'}".encode()).hexdigest()[:16]


def _norm_heading(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", (s or "").lower())).strip()


def _attach_depths(db, doc_id: str, sections: list[dict]) -> list[dict]:
    """Tag each skeleton section with a relative ``depth`` (0 = shallowest in this scope) so the
    UI can render the TOC hierarchy with indentation instead of a flat numbered list.

    The document outline carries the true nesting (``listDepth``) but in a COARSER, separate
    keyspace than section_content — so we match by normalized heading TEXT, not key. Finer
    section_content headings the outline omits (sub-subsections) sit one level under the most
    recent matched heading. Falls back to the section_content markdown heading level only when
    there's no outline. View-time enrichment — works on cached skeleton rows.
    """
    if not sections:
        return sections
    depth_by_title: dict[str, int] = {}
    try:
        doc = db.collection("documents").get(doc_id)
        for e in (doc or {}).get("outline") or []:
            t, d = _norm_heading(e.get("title")), e.get("listDepth")
            if t and d is not None and t not in depth_by_title:
                depth_by_title[t] = d
    except Exception:  # noqa: BLE001
        depth_by_title = {}

    raw: list[int] = []
    if depth_by_title:
        last = 0
        for s in sections:
            d = depth_by_title.get(_norm_heading(s.get("heading")))
            if d is None:
                d = last + 1  # finer heading the outline skipped → one under its parent
            else:
                last = d
            raw.append(d)
    else:
        # No outline — fall back to the section_content markdown heading level.
        keys = [s.get("sectionKey") for s in sections if s.get("sectionKey")]
        levels: dict[str, int] = {}
        try:
            for r in db.aql.execute(
                "FOR b IN section_content FILTER b.docId == @d AND b.sectionKey IN @ks "
                "RETURN {sk: b.sectionKey, lvl: b.level}",
                bind_vars={"d": doc_id, "ks": keys},
            ):
                sk, lvl = r.get("sk"), r.get("lvl")
                if sk and lvl is not None:
                    levels[sk] = min(lvl, levels.get(sk, lvl))
        except Exception:  # noqa: BLE001
            levels = {}
        raw = [levels.get(s.get("sectionKey"), 0) for s in sections]

    base = min(raw) if raw else 0
    for s, d in zip(sections, raw):
        s["depth"] = max(0, d - base)
    return sections


def ensure_path_collections(db) -> None:
    for name in (SKELETONS, ORIENT, PROGRESS):
        if not db.has_collection(name):
            col = db.create_collection(name)
            col.add_persistent_index(fields=["docId"])


SKELETON_SYSTEM = (
    "You distill a textbook chapter's SKELETON for a learner to memorize. Given the chapter's "
    "sections in order (heading + key concepts), write a ONE-line essence for each section — "
    "what it covers, in a handful of plain words. Keep the EXACT sections and order; never add, "
    "drop, merge, or reorder. No markdown, no section numbers."
)


def _clean(s: object) -> str:
    return re.sub(r"[*_`#]", "", str(s or "")).strip()


def _concepts_by_section(db, doc_id: str, section_keys: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    if not section_keys:
        return out
    for r in db.aql.execute(
        "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks SORT c.order "
        "RETURN {sk: c.sectionKey, name: c.name}",
        bind_vars={"d": doc_id, "ks": section_keys},
    ):
        out.setdefault(r["sk"], []).append(r["name"])
    return out


def generate_skeleton(db, doc_id: str, scope: str | None, model: str | None = None) -> list[dict] | None:
    """Build the ordered [{sectionKey, heading, essence}] for a chapter scope."""
    sections = _load_section_blocks(db, doc_id, scope=scope)
    if not sections:
        return None
    keys = [s.section_key for s in sections]
    by_sec = _concepts_by_section(db, doc_id, keys)

    lines = []
    for s in sections:
        h = _clean(s.heading or s.section_key)
        cs = ", ".join(by_sec.get(s.section_key, [])[:6])
        lines.append(f"- {h}" + (f"  (concepts: {cs})" if cs else ""))
    user = "Chapter sections, in order:\n" + "\n".join(lines)

    essences: dict[str, str] = {}
    obj, _err = ollama_structured_completion(
        [{"role": "system", "content": SKELETON_SYSTEM}, {"role": "user", "content": user}],
        Skeleton, temperature=0.3, model=model,
    )
    if obj and isinstance(obj.get("sections"), list):
        for it in obj["sections"]:
            h = _clean(it.get("heading"))
            if h:
                essences[h.lower()] = _clean(it.get("essence"))

    out: list[dict] = []
    for s in sections:
        h = _clean(s.heading or s.section_key)
        out.append({"sectionKey": s.section_key, "heading": h, "essence": essences.get(h.lower(), "")})
    return out


def fetch_skeleton(doc_id: str | None = None, scope: str | None = None, regenerate: bool = False) -> dict:
    """Cached chapter skeleton (generate on first request)."""
    try:
        db = connect_arango()
        if doc_id is None:
            doc = (fetch_latest_document() or {}).get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"error": "no document found"}
        ensure_path_collections(db)
        k = _key(doc_id, scope)
        col = db.collection(SKELETONS)
        if not regenerate:
            existing = col.get(k)
            if existing and existing.get("sections"):
                return {
                    "docId": doc_id,
                    "scope": scope,
                    "sections": _attach_depths(db, doc_id, existing["sections"]),
                }
        sections = generate_skeleton(db, doc_id, scope)
        if not sections:
            return {"docId": doc_id, "scope": scope, "sections": [], "error": "no sections in this scope"}
        col.insert(
            {"_key": k, "docId": doc_id, "scope": scope, "sections": sections, "createdAt": int(time.time())},
            overwrite=True,
        )
        return {"docId": doc_id, "scope": scope, "sections": _attach_depths(db, doc_id, sections)}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


# --------------------------------------------------------------------------- #
# Orient — objectives + watch-fors (advance organizer), generated from concepts
# --------------------------------------------------------------------------- #

ORIENT_SYSTEM = (
    "You write a short ORIENTATION for a learner about to read a textbook chapter — an advance "
    "organizer that primes them. From the chapter's key concepts, produce:\n"
    "- objectives: 3-5 learning objectives phrased as 'By the end you'll be able to …' (use action "
    "verbs: explain, distinguish, apply, derive). What they should be able to DO.\n"
    "- watchFor: 3-5 things to pay attention to — key distinctions, easily-confused pairs, common "
    "misconceptions, or the 'why this matters'.\n"
    "Spoken, concise, one sentence each. No markdown. Ground everything in the given concepts."
)


def generate_orient(db, doc_id: str, scope: str | None, model: str | None = None) -> dict | None:
    sections = _load_section_blocks(db, doc_id, scope=scope)
    if not sections:
        return None
    keys = [s.section_key for s in sections]
    rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks SORT c.sectionKey, c.order "
            "RETURN {name: c.name, signal: c.signal}",
            bind_vars={"d": doc_id, "ks": keys},
        )
    )
    if not rows:
        return {"objectives": [], "watchFor": []}
    concept_lines = "\n".join(f"- {r['name']}: {_clean(r.get('signal'))}" for r in rows[:40])
    user = f"Chapter key concepts:\n{concept_lines}"
    obj, _err = ollama_structured_completion(
        [{"role": "system", "content": ORIENT_SYSTEM}, {"role": "user", "content": user}],
        Orient, temperature=0.4, model=model,
    )
    if not obj:
        return {"objectives": [], "watchFor": []}
    return {
        "objectives": [_clean(x) for x in (obj.get("objectives") or []) if _clean(x)],
        "watchFor": [_clean(x) for x in (obj.get("watchFor") or []) if _clean(x)],
    }


def fetch_orient(doc_id: str | None = None, scope: str | None = None, regenerate: bool = False) -> dict:
    try:
        db = connect_arango()
        if doc_id is None:
            doc = (fetch_latest_document() or {}).get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"error": "no document found"}
        ensure_path_collections(db)
        k = _key(doc_id, scope)
        col = db.collection(ORIENT)
        if not regenerate:
            existing = col.get(k)
            if existing and (existing.get("objectives") or existing.get("watchFor")):
                return {"docId": doc_id, "scope": scope, "objectives": existing["objectives"], "watchFor": existing["watchFor"]}
        data = generate_orient(db, doc_id, scope)
        if data is None:
            return {"docId": doc_id, "scope": scope, "objectives": [], "watchFor": [], "error": "no sections in this scope"}
        col.insert({"_key": k, "docId": doc_id, "scope": scope, **data, "createdAt": int(time.time())}, overwrite=True)
        return {"docId": doc_id, "scope": scope, **data}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


# --------------------------------------------------------------------------- #
# Path progress (shared across stages)
# --------------------------------------------------------------------------- #

def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


def get_chapter_progress(doc_id: str | None, scope: str | None) -> dict:
    try:
        db = connect_arango()
        doc_id = _resolve_doc_id(doc_id)
        if not doc_id:
            return {"stages": {}}
        ensure_path_collections(db)
        rec = db.collection(PROGRESS).get(_key(doc_id, scope))
        return {"docId": doc_id, "scope": scope, "stages": (rec or {}).get("stages", {})}
    except Exception as exc:  # noqa: BLE001
        return {"stages": {}, "error": str(exc)}


def update_stage(doc_id: str | None, scope: str | None, stage: str, data: dict) -> dict:
    """Merge one stage's progress (e.g. {done, grade, score}) into chapter_progress."""
    try:
        db = connect_arango()
        doc_id = _resolve_doc_id(doc_id)
        if not doc_id:
            return {"error": "no document found"}
        ensure_path_collections(db)
        col = db.collection(PROGRESS)
        k = _key(doc_id, scope)
        rec = col.get(k) or {"_key": k, "docId": doc_id, "scope": scope, "stages": {}}
        stages = rec.get("stages", {})
        stages[stage] = {**stages.get(stage, {}), **data, "at": int(time.time())}
        rec["stages"] = stages
        col.insert(rec, overwrite=True)
        return {"docId": doc_id, "scope": scope, "stages": stages}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def record_skeleton_grade(doc_id: str | None, scope: str | None, grade: str) -> dict:
    """Self-graded skeleton recall. Soft gate: 'most'/'nailed' marks the stage done."""
    g = str(grade or "").lower()
    val = GRADE_VALUE.get(g, 0)
    return update_stage(doc_id, scope, "skeleton", {"grade": g, "value": val, "done": val >= 3})
