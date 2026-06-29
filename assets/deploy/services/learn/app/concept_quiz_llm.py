"""LLM-authored UNDERSTANDING questions for concepts — the harder tier of the concept quiz.

The deterministic builder (``concept_quiz_gen``) only does recognition ("match this definition
to its term"). This module asks the local model to author higher-order MCQs once per concept and
caches them on ``concepts.quizQuestions``, so studying stays keyless and instant after the
one-time authoring. Authoring runs lazily in a background thread keyed by scope.

Quality comes from three things, not model size:
  1. GROUNDING — each concept is quizzed against its real surrounding passage (section_content),
     not just its one-sentence signal, so "apply to a scenario" questions have material to stand on.
  2. SPREAD — three cognitive types per concept: apply / distinguish / why-or-consequence.
  3. A CRITIC PASS — a second LLM call revises the drafts (kills telegraphing, weak distractors,
     non-parallel options), then a programmatic gate drops anything that still gives the answer away.
"""

from __future__ import annotations

import json
import os
import random
import re
import threading
from typing import Any

from app.arango_tree import connect_arango
from app.concept_quiz_gen import _name_variants
from app.llm import ollama_structured_completion

CONCEPTS = "concepts"
# Authoring is GPU-bound on a single model, so it runs sequentially. The critic pass roughly
# doubles per-concept time (~1 concept/min for a 30B). Override with a smaller/faster model to
# trade quality for speed, e.g. LEARN_QUIZ_AUTHOR_MODEL=qwen3:8b.
_AUTHOR_MODEL = os.environ.get("LEARN_QUIZ_AUTHOR_MODEL") or None
# Separate from ``concepts.questions`` (the extraction's {q,a} study cards) — this holds the
# LLM-authored quiz MCQs only.
QFIELD = "quizQuestions"

# The three higher-order question types we author per concept (one of each).
_TYPES = ("apply", "distinguish", "why")

AUTHOR_SYSTEM = (
    "You are an exam author creating multiple-choice questions that test DEEP UNDERSTANDING of "
    "one concept, grounded strictly in a provided textbook passage.\n"
    "Write exactly THREE questions — one of each TYPE:\n"
    "- apply: give a concrete scenario or example and ask which choice correctly applies the "
    "concept, or what happens. Test transfer, not recall.\n"
    "- distinguish: ask what separates this concept from a closely-related neighbour; the wrong "
    "options are the neighbours it is most confused with.\n"
    "- why: ask why the concept holds, what it enables, or what breaks without it (cause / consequence).\n"
    "Hard rules — a question that breaks any of these is worthless:\n"
    "- Every question must test THE GIVEN CONCEPT specifically (the 'What it is' line is its true "
    "subject). The passage may discuss sibling concepts — use those only as wrong options, NEVER as "
    "the thing a question is about. If a question would work for a different concept in the passage, "
    "it is wrong: make it specific to this one.\n"
    "- NEVER name the concept in the stem, and never let the stem repeat the wording of the correct "
    "option. The learner must reason, not pattern-match — describe situations instead of naming them.\n"
    "- Exactly 4 options: one unambiguously correct, three plausible-but-wrong. Draw the wrong ones "
    "from the listed sibling concepts or genuine misconceptions — never absurd or off-topic choices.\n"
    "- All 4 options must be PARALLEL: same grammatical form, comparable length and specificity. The "
    "correct option must NOT be the longest or most detailed (that is a giveaway).\n"
    "- Ground every question and option ONLY in the passage. Invent no outside facts, numbers, or names.\n"
    "- One sentence of explanation citing what in the passage makes the answer correct.\n"
    "- answerIndex is the 0-based index of the correct option."
)

CRITIC_SYSTEM = (
    "You are a strict reviewer of multiple-choice questions. You are given the source passage and "
    "draft questions. Revise EACH question so it obeys every rule; rewrite freely, and if a draft "
    "cannot be saved, replace it with a better question of the SAME type.\n"
    "Fix these defects:\n"
    "- TELEGRAPHING: the stem names the concept or repeats words from the correct option. Rewrite the "
    "stem to describe the situation instead.\n"
    "- A correct option that just restates the definition verbatim — make the learner reason.\n"
    "- Weak distractors (absurd, off-topic, obviously wrong). Replace with plausible siblings or "
    "real misconceptions a learner would fall for.\n"
    "- Non-parallel options (one long/detailed answer among short ones). Make all four the same shape "
    "and length; the correct answer must not stand out.\n"
    "- Anything not supported by the passage — cut it.\n"
    "Keep exactly 4 options with one correct answerIndex, a one-sentence grounded explanation, and the "
    "original TYPE on each question. Return the revised set as JSON, same schema."
)

AUTHOR_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": list(_TYPES)},
                    "stem": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answerIndex": {"type": "integer"},
                    "explanation": {"type": "string"},
                },
                "required": ["type", "stem", "options", "answerIndex", "explanation"],
            },
        }
    },
    "required": ["questions"],
}

# In-flight guard so concurrent quiz requests don't author the same scope twice.
_inflight: set[str] = set()
_inflight_lock = threading.Lock()

# Function words ignored when measuring stem/answer overlap — only content words telegraph.
_STOP = frozenset(
    "the a an of to in on for and or is are be as it its this that with by from into within which "
    "what does do can could would should will when where how why if then than over under between "
    "about given using used use uses one two each any all not no but so such these those their them "
    "they you your we our he she his her some more most less least only also very much many".split()
)


def _content_tokens(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) > 3 and w not in _STOP}


def _options_parallel(opts: list[str], ai: int) -> bool:
    """Reject questions where the correct option is a length outlier vs the distractors (the
    'one long description + three bare names' tell). Keeps options format-neutral."""
    correct_w = len(opts[ai].split())
    other_w = [len(o.split()) for k, o in enumerate(opts) if k != ai]
    if not other_w:
        return False
    hi, lo = max(other_w), min(other_w)
    return not (correct_w > 2 * hi or (lo > 0 and correct_w * 2 < lo))


def _valid_question(q: dict[str, Any]) -> bool:
    """Structural validity only (shape the serving layer relies on)."""
    opts = q.get("options")
    ai = q.get("answerIndex")
    return (
        isinstance(q.get("stem"), str)
        and q["stem"].strip() != ""
        and isinstance(opts, list)
        and len(opts) == 4
        and all(isinstance(o, str) and o.strip() for o in opts)
        and len(set(opts)) == 4
        and isinstance(ai, int)
        and 0 <= ai < 4
        and _options_parallel(opts, ai)
    )


def _telegraphs(q: dict[str, Any], name: str) -> bool:
    """True if the stem gives the answer away — the failure mode the structural check misses:
    the concept's own name appears in the stem, or the stem repeats most of the correct option's
    content words (e.g. stem '...defines the fixed set of symbols a model can emit?' with answer
    'It is the fixed set of symbols a model can emit')."""
    stem = q["stem"]
    stem_l = stem.lower()
    for v in _name_variants(name):
        if v and re.search(r"\b" + re.escape(v.lower()) + r"\b", stem_l):
            return True
    ans_toks = _content_tokens(q["options"][q["answerIndex"]])
    if ans_toks:
        overlap = len(ans_toks & _content_tokens(stem)) / len(ans_toks)
        if overlap >= 0.6:
            return True
    return False


def _accept(q: dict[str, Any], name: str) -> bool:
    return _valid_question(q) and not _telegraphs(q, name)


def _normalize(q: Any) -> dict[str, Any] | None:
    """Coerce a raw model question into our shape, or None if unusable."""
    if not isinstance(q, dict):
        return None
    stem = q.get("stem")
    opts = q.get("options")
    ai = q.get("answerIndex")
    if not isinstance(stem, str) or not isinstance(opts, list) or not isinstance(ai, int):
        return None
    typ = q.get("type") if q.get("type") in _TYPES else "apply"
    return {
        "type": typ,
        "stem": stem.strip(),
        "options": [str(o).strip() for o in opts],
        "answerIndex": ai,
        "explanation": (q.get("explanation") or "").strip(),
    }


def _author_user(name: str, signal: str, source: str, passage: str, sib: str) -> str:
    anchor = f'\nKey sentence about it from the text: "{source}"' if source else ""
    return (
        f"Concept (the subject of all three questions): {name}\n"
        f"What it is: {signal}{anchor}\n"
        f"Sibling concepts (use as distractors, never as the subject): {sib}\n\n"
        "Passage for context — ground everything in this, but keep every question about the concept "
        "above, not about whatever else the passage discusses; do not copy passage wording into the "
        "correct option:\n"
        f'"""\n{passage}\n"""'
    )


def _critique(passage: str, name: str, drafts: list[dict[str, Any]], model: str | None) -> list[dict[str, Any]]:
    """Second LLM pass: revise the drafts to kill telegraphing / weak distractors. Returns the
    revised set (or the originals if the critic call fails)."""
    if not drafts:
        return []
    user = (
        f"Concept: {name}\n\n"
        f'Passage:\n"""\n{passage}\n"""\n\n'
        f"Draft questions (JSON):\n{json.dumps({'questions': drafts}, ensure_ascii=False)}\n\n"
        "Return the revised questions as JSON (same schema)."
    )
    obj, err = ollama_structured_completion(
        [{"role": "system", "content": CRITIC_SYSTEM}, {"role": "user", "content": user}],
        AUTHOR_SCHEMA,
        temperature=0.2,
        model=model,
    )
    if err or not obj:
        return drafts
    revised = [n for n in (_normalize(q) for q in obj.get("questions") or []) if n]
    return revised or drafts


def author_concept_questions(
    concept: dict[str, Any],
    siblings: list[str],
    passage: str | None = None,
    model: str | None = None,
) -> list[dict[str, Any]]:
    """Author → critic-revise → gate understanding MCQs for one concept. Returns the questions
    that pass the semantic gate ([] on failure — the caller falls back to the deterministic
    recognition question)."""
    name = (concept.get("name") or "").strip()
    signal = (concept.get("signal") or "").strip()
    if not name or not signal:
        return []
    source = (concept.get("source") or "").strip()
    passage = (passage or "").strip() or f"{signal}\n\n{source}"
    sib = ", ".join(s for s in siblings[:12] if s and s != name) or "(none provided)"

    obj, err = ollama_structured_completion(
        [
            {"role": "system", "content": AUTHOR_SYSTEM},
            {"role": "user", "content": _author_user(name, signal, source, passage, sib)},
        ],
        AUTHOR_SCHEMA,
        temperature=0.5,
        model=model,
    )
    drafts = [] if err or not obj else [n for n in (_normalize(q) for q in obj.get("questions") or []) if n]
    if not drafts:
        return []

    revised = _critique(passage, name, drafts, model)

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for q in revised:
        if _accept(q, name) and q["stem"].lower() not in seen:
            seen.add(q["stem"].lower())
            out.append(
                {
                    "stem": q["stem"],
                    "options": q["options"],
                    "answerIndex": int(q["answerIndex"]),
                    "explanation": q["explanation"],
                    "kind": q["type"],
                }
            )
    return out


def _concept_passage(db, concept: dict[str, Any]) -> str:
    """The concept's real surrounding text, windowed CONCEPT-TIGHT (~1.2k chars) around its own
    source sentence — not the whole section. A whole section shared by many concepts is dominated
    by one topic, so questions drift to it; centring on the source keeps each concept's questions
    about that concept while still giving apply/why questions material to stand on."""
    sk = concept.get("sectionKey")
    if not sk:
        return ""
    try:
        blocks = list(
            db.aql.execute(
                "FOR b IN section_content FILTER b.sectionKey == @sk "
                "AND (@doc == null OR b.docId == @doc) SORT b.order ASC RETURN b.markdown",
                bind_vars={"sk": sk, "doc": concept.get("docId")},
            )
        )
    except Exception:  # noqa: BLE001
        return ""
    text = "\n\n".join(b for b in blocks if b).strip()
    window = 1200
    if len(text) <= window:
        return text
    # Anchor the window on the concept's own locale: its source sentence, else its name.
    src = (concept.get("source") or "").strip()
    idx = text.find(src[:60]) if len(src) >= 12 else -1
    if idx < 0:
        name = (concept.get("name") or "").strip()
        idx = text.lower().find(name.lower()) if name else -1
    if idx < 0:
        idx = 0
    start = max(0, idx - window // 3)
    return text[start : start + window].strip()


def _ensure_worker(doc: str | None, section_keys: list[str], limit: int, sig: str) -> None:
    try:
        db = connect_arango()
        rows = list(
            db.aql.execute(
                "FOR c IN concepts FILTER (@doc == null OR c.docId == @doc) "
                "AND c.sectionKey IN @ks AND c.signal != null "
                f"AND (c.{QFIELD} == null OR LENGTH(c.{QFIELD}) == 0) "
                "LIMIT @lim "
                "RETURN {key: c._key, name: c.name, signal: c.signal, source: c.source, "
                "docId: c.docId, sectionKey: c.sectionKey}",
                bind_vars={"doc": doc, "ks": section_keys, "lim": limit},
            )
        )
        if not rows:
            return
        # Sibling names per section, for distractor grounding.
        sibs: dict[str, list[str]] = {}
        for sk in {r.get("sectionKey") for r in rows}:
            sibs[sk] = [
                r["name"]
                for r in db.aql.execute(
                    "FOR c IN concepts FILTER c.sectionKey == @sk RETURN {name: c.name}",
                    bind_vars={"sk": sk},
                )
                if r.get("name")
            ]
        col = db.collection(CONCEPTS)
        # Sequential: a single GPU-resident model is compute-bound, so concurrent requests just
        # time-slice the GPU (no speedup, lumpier progress). Steady cadence reads better.
        for r in rows:
            passage = _concept_passage(db, r)
            qs = author_concept_questions(
                r, sibs.get(r.get("sectionKey"), []), passage=passage, model=_AUTHOR_MODEL
            )
            if qs:
                col.update({"_key": r["key"], QFIELD: qs})
    except Exception:  # noqa: BLE001 — best-effort backfill
        pass
    finally:
        with _inflight_lock:
            _inflight.discard(sig)


def ensure_questions_async(doc: str | None, section_keys: set[str] | None, limit: int = 12) -> bool:
    """Fire-and-forget: author understanding questions for un-authored concepts in scope. Guarded
    so a given scope only authors once at a time. Returns True if a job was started."""
    if not section_keys:
        return False
    keys = sorted(section_keys)
    sig = f"{doc}|{','.join(keys)}"
    with _inflight_lock:
        if sig in _inflight:
            return False
        _inflight.add(sig)
    threading.Thread(target=_ensure_worker, args=(doc, keys, limit, sig), daemon=True).start()
    return True


def scope_question_status(db, doc: str | None, section_keys: set[str] | None) -> dict[str, Any]:
    """Authoring progress for a scope: how many of its concepts have quiz questions yet."""
    if not section_keys:
        return {"total": 0, "authored": 0, "running": False}
    keys = sorted(section_keys)
    total = db.aql.execute(
        "RETURN LENGTH(FOR c IN concepts FILTER (@doc == null OR c.docId == @doc) "
        "AND c.sectionKey IN @ks AND c.signal != null RETURN 1)",
        bind_vars={"doc": doc, "ks": keys},
    ).next()
    authored = db.aql.execute(
        f"RETURN LENGTH(FOR c IN concepts FILTER (@doc == null OR c.docId == @doc) "
        f"AND c.sectionKey IN @ks AND c.{QFIELD} != null AND LENGTH(c.{QFIELD}) > 0 RETURN 1)",
        bind_vars={"doc": doc, "ks": keys},
    ).next()
    with _inflight_lock:
        running = f"{doc}|{','.join(keys)}" in _inflight
    return {"total": total, "authored": authored, "running": running}


def prepare_scope(db, doc: str | None, section_keys: set[str] | None) -> dict[str, Any]:
    """Author ALL of a scope's un-authored concepts up front (background), and report status."""
    ensure_questions_async(doc, section_keys, limit=1000)
    return scope_question_status(db, doc, section_keys)


def servable_from_cached(
    concept: dict[str, Any], llmq: dict[str, Any], rng: random.Random
) -> dict[str, Any] | None:
    """Turn a cached LLM question + its concept into the server-side question shape (options
    shuffled so the answer position isn't fixed)."""
    opts = list(llmq.get("options") or [])
    ai = llmq.get("answerIndex")
    if len(opts) < 2 or not isinstance(ai, int) or not (0 <= ai < len(opts)):
        return None
    correct = opts[ai]
    rng.shuffle(opts)
    return {
        "stem": llmq.get("stem"),
        "choices": opts,
        "answer_index": opts.index(correct),
        "expected": correct,
        "conceptKey": concept.get("key"),
        "sectionKey": concept.get("sectionKey"),
        "signal": concept.get("signal"),
        "source": llmq.get("explanation") or concept.get("source"),
    }
