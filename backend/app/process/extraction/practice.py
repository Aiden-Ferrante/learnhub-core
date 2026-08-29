"""LLM-authored PRACTICE ITEMS — the one item pool behind practice, quizzes, and exams.

One table (``ext_practice``), one ``kind`` column typed by HOW THE ANSWER IS CHECKED,
never by subject: ``retrieve``/``problem`` are self-graded against a revealed worked
solution; ``mcq``/``order``/``code`` carry their check data in ``payload``. Items belong
to the BOOK (doc_id = sources.key) like concepts, so every version inherits them through
its blocks and reads go through ``concept_filter``.

Authoring is a ledgered ``practice`` job (same shape as reading_guide's ``guides`` job).
``edited_at IS NULL`` marks the regenerable set: a regenerate deletes and rewrites only
untouched rows, so hand polish is permanent. Generation is LLM; grading is not — the
graded loop stays in study/reviews.py, keyless and deterministic.
"""

from __future__ import annotations

import os
import re
import time
import uuid
from typing import Any

from psycopg.types.json import Json

from app.gateways import ProblemSet, RetrieveSet, db, ollama_structured_completion
from app.process.content import (
    concept_filter,
    load_section_blocks,
    resolve_doc_id,
    scope_section_keys,
    source_id_of,
    version_sections_by_source,
)
from app.process.extraction.concepts_extract import repair_model_text

# Kinds this pass can author. mcq/order/code join in later phases; the registry shape
# (kind -> author function) is the extension point.
DEFAULT_KINDS = ("retrieve", "problem")

# Curators may edit content and check data; provenance (doc/section/key) is read-only.
EDITABLE_FIELDS = frozenset({"prompt", "answer", "rubric", "kind", "payload"})

_MAX_PASSAGE = 20_000  # chars of section text per call; num_ctx is 32768 tokens

# The two observed failure tells are the same shape: a reference to the book's FURNITURE
# (its text, sections, tables, numbered steps) instead of its subject. Spike 1 measured
# 23% "according to the text…" retrieval questions; spike 2 produced "as shown in step 3
# of Table 2-1" on procedural sections. The prompt forbids the habit; this deterministic
# post-filter is the backstop (precedent: the LEARN_REQUIRE_SOURCE grounding gate).
_BOOK_NOUN = r"(text|book|author|section|chapter|passage|excerpt|introduction|material|reading)"

_FURNITURE_TELLS = [
    re.compile(rf"\baccording to (the|this) \w*\s*{_BOOK_NOUN}\b", re.I),
    # "this section", but also "this introductory section" — one adjective may intervene
    # (live run: "this introductory section", which the plain two-word form missed).
    re.compile(rf"\b(this|the|that) (\w+ )?{_BOOK_NOUN}\b", re.I),
    re.compile(r"\bas (shown|described|listed|given|presented|defined) (in|by|above)\b", re.I),
    re.compile(r"\b(table|figure|listing|step|example)\s+\d", re.I),
    # "§6", "section 3.2" — the first live run produced "the quantified statement in §6".
    re.compile(r"§\s*\d", re.I),
    re.compile(r"\bsections?\s+\d", re.I),
]

# The second failure family, found on the first production run: DEIXIS — the item points
# at material it does not carry ("translate the quoted sentence", "…equivalent to the
# original sentence"). The furniture ban does not catch these because they name no book
# noun, but the effect is worse: the task is unanswerable without the book open, and the
# learner is shown a prompt with a hole where its subject should be.
_REFERENT_NOUN = r"(sentence|claim|statement|formula|expression|equation|query|snippet|code|passage|quote|example|definition|theorem|rule|argument)"

_DEIXIS_TELLS = [
    re.compile(rf"\b(the|this|that) (quoted|original|above|preceding|foregoing|aforementioned) \w*\s*{_REFERENT_NOUN}s?\b", re.I),
    re.compile(rf"\bthe {_REFERENT_NOUN} (quoted|shown|given|cited|mentioned|discussed) (above|earlier|previously)\b", re.I),
    re.compile(r"\b(the|this|that) (quoted|original) (one|text)\b", re.I),
]

# An item is a TASK. The first attempt at the self-containment instruction below made the
# model emit bare quotations as prompts — material with nothing asked of it — so the
# quote requirement needs a floor under it: every prompt must ask for something. A question
# mark or an imperative verb is that floor, and virtually every real prompt has one, which
# is what makes this cheap to check and safe to enforce.
_TASK_VERBS = (
    "write|state|give|name|list|identify|explain|describe|justify|argue|show|prove|derive|"
    "compute|calculate|evaluate|simplify|solve|find|determine|decide|classify|compare|"
    "contrast|construct|build|design|draw|sketch|rewrite|translate|formalize|formalise|"
    "convert|express|apply|use|using|assign|choose|select|pick|order|arrange|complete|"
    "fill|verify|check|test|predict|estimate|count|suppose|assume|consider|take|let"
)
_TASK_SIGNAL = re.compile(rf"(\?|^\s*(?:\d+[.)]\s*)?({_TASK_VERBS})\b|\b({_TASK_VERBS})\b)", re.I | re.M)


def _has_task(prompt: str) -> bool:
    """Whether the prompt actually asks for something, rather than merely presenting text."""
    return bool(_TASK_SIGNAL.search(prompt or ""))

_FURNITURE_BAN = (
    "NEVER reference the book itself or its apparatus: no 'according to the text', no "
    "'in this section', no 'the author', and no references to numbered tables, figures, "
    "steps, or listings ('Table 2-1', 'step 3'). Ask about the SUBJECT, as if the learner "
    "had studied the material and lost the book.\n"
    "The item must be SELF-CONTAINED. The learner sees your prompt and NOTHING else — not "
    "the section, not the surrounding items. Whenever the task acts on a specific sentence, "
    "claim, formula, query, snippet or dataset, quote it in full inside the prompt. Never "
    "write 'the quoted sentence', 'the original claim', 'the statement above' or any other "
    "pointer to material the prompt does not itself contain: a prompt with a hole where its "
    "subject should be cannot be worked at all.\n"
    "But the prompt is a TASK, never a passage. Quoted material SUPPORTS an instruction and "
    "never replaces it: every prompt must ask the learner to do something or answer "
    "something. A prompt that is only a quotation, with nothing asked of it, is not an item.\n"
)

RETRIEVE_SYSTEM = (
    "You write KNOWLEDGE-RETRIEVAL questions for one section of a textbook. You are given "
    "the section's text and, when available, the key concepts extracted from it. Ground "
    "everything ONLY in that material — never invent facts.\n\n"
    "Each question must be answerable from understanding the subject: definitions applied, "
    "distinctions drawn, guarantees stated, consequences named. Each answer is a concise "
    "model answer (1-3 sentences) the learner compares their own recall against.\n\n"
    + _FURNITURE_BAN
    + "NEVER write a question about the document's own structure or purpose. If the section "
    "is front matter or contains nothing teachable, return an EMPTY list — refusing is a "
    "correct answer.\n"
    "Write 2 or 3 questions. No markdown headers, no preamble."
)

# Lifted from the validated step-2 spike (scripts/spike_problem_items.py) with the
# furniture ban spelled out against the tells both spikes actually produced.
PROBLEM_SYSTEM = (
    "You write PRACTICE PROBLEMS for one section of a textbook. You are given the section's "
    "heading and its full text. Ground everything ONLY in that text.\n\n"
    "A practice problem asks the learner to DO something and produce work: derive a result, "
    "apply a rule to a specific case, construct an example or counterexample, decide whether "
    "a claim holds and justify it, or carry out a procedure step by step.\n\n"
    "For each problem give:\n"
    "- prompt: the task. It must have a specific, checkable target — not 'discuss' or "
    "'explain the importance of'. It must carry, in full, every input the learner works "
    "on: if the task is to formalize a claim, the claim's words go in the prompt; if it "
    "is to rewrite a query, the query goes in the prompt.\n"
    "- answer: the WORKED SOLUTION, showing the steps, not just the final result. This is "
    "what the learner compares their own work against.\n"
    "- rubric: one sentence naming what a correct answer must contain, so a learner can "
    "grade themselves honestly.\n\n"
    "NEVER write a problem that can be answered by restating a definition or naming a term. "
    + _FURNITURE_BAN
    + "If the section is purely descriptive, a tutorial walkthrough, or contains nothing "
    "that can be worked from knowledge of the subject, return an EMPTY list rather than "
    "inventing a task — refusing is a correct answer.\n"
    "Write 2 or 3 problems. No markdown headers, no preamble."
)


def _author_model(override: str | None = None) -> str | None:
    """request model → LEARN_PRACTICE_MODEL → LEARN_EXTRACT_MODEL → llm.py's default."""
    return (
        override
        or os.environ.get("LEARN_PRACTICE_MODEL")
        or os.environ.get("LEARN_EXTRACT_MODEL")
        or None
    )


def _has_furniture(text: str) -> bool:
    """Whether a prompt points outside itself — at the book's apparatus, or at material it
    never carries. Either way the learner cannot work it from the prompt alone."""
    text = text or ""
    return any(rx.search(text) for rx in _FURNITURE_TELLS + _DEIXIS_TELLS)


def _section_concept_lines(src: str, section_key: str) -> str:
    """The section's extracted concepts as grounding lines for retrieval authoring."""
    with db() as conn:
        rows = conn.execute(
            "SELECT name, signal, source FROM ext_concepts "
            'WHERE doc_id = %(d)s AND section_key = %(s)s ORDER BY "order"',
            {"d": src, "s": section_key},
        ).fetchall()
    return "\n".join(
        f"- {r['name']}: {r.get('signal') or ''}" for r in rows if r.get("name")
    )


def _author_section(
    kind: str, heading: str, text: str, concept_lines: str, model: str | None
) -> tuple[list[dict[str, Any]], int]:
    """Author one section's items of one kind → (kept items, dropped-by-filter count).
    An empty list with zero drops is a refusal, which the prompts allow."""
    passage = text[:_MAX_PASSAGE]
    if kind == "retrieve":
        user = f"Section: {heading}\n\n<section_text>\n{passage}\n</section_text>"
        if concept_lines:
            user += f"\n\n<key_concepts>\n{concept_lines}\n</key_concepts>"
        obj, err = ollama_structured_completion(
            [{"role": "system", "content": RETRIEVE_SYSTEM}, {"role": "user", "content": user}],
            RetrieveSet, temperature=0.3, model=model,
        )
        raw = [
            {"prompt": q.get("q"), "answer": q.get("a"), "rubric": None}
            for q in ((obj or {}).get("questions") or [])
        ]
    elif kind == "problem":
        user = f"Section: {heading}\n\n<section_text>\n{passage}\n</section_text>"
        obj, err = ollama_structured_completion(
            [{"role": "system", "content": PROBLEM_SYSTEM}, {"role": "user", "content": user}],
            ProblemSet, temperature=0.3, model=model,
        )
        raw = list((obj or {}).get("problems") or [])
    else:
        return [], 0
    if err or obj is None:
        raise RuntimeError(f"{kind} authoring failed: {err}")

    kept: list[dict[str, Any]] = []
    dropped = 0
    for it in raw:
        prompt = repair_model_text(it.get("prompt")).strip()
        answer = repair_model_text(it.get("answer")).strip()
        rubric = repair_model_text(it.get("rubric")).strip() or None
        if not prompt or not answer:
            continue
        # Two ways an item fails to be workable, both counted as drops so the receipt
        # shows them: it points outside itself, or it asks nothing at all.
        if _has_furniture(prompt) or not _has_task(prompt):
            dropped += 1
            continue
        kept.append({"kind": kind, "prompt": prompt, "answer": answer, "rubric": rubric})
    return kept, dropped


def author_practice_sync(
    doc: str | None,
    scope: str | None,
    on_progress=None,
    kinds: list[str] | None = None,
    model: str | None = None,
    regenerate: bool = False,
) -> dict[str, Any]:
    """Author practice items for every section in scope that has none of that kind yet.
    Synchronous so the build queue runs it as a ledgered job. ``regenerate`` first clears
    the scope's UNTOUCHED rows (edited_at IS NULL) of the requested kinds — edited items
    survive by construction. Returns an {authored, dropped, refused, total} receipt."""
    doc = resolve_doc_id(doc)
    if not doc:
        return {"error": "no document found"}
    src = source_id_of(doc)
    kinds = [k for k in (kinds or list(DEFAULT_KINDS)) if k in DEFAULT_KINDS]
    sections = load_section_blocks(doc, scope=scope, coalesce=True)
    src_keys = [s.source_section_key for s in sections]

    if regenerate and src_keys:
        with db() as conn:
            conn.execute(
                "DELETE FROM ext_practice WHERE doc_id = %(d)s AND edited_at IS NULL "
                "AND section_key = ANY(%(ks)s::text[]) AND kind = ANY(%(kinds)s::text[])",
                {"d": src, "ks": src_keys, "kinds": kinds},
            )
    with db() as conn:
        existing = {
            (r["section_key"], r["kind"])
            for r in conn.execute(
                "SELECT DISTINCT section_key, kind FROM ext_practice WHERE doc_id = %(d)s",
                {"d": src},
            ).fetchall()
        }

    authored = dropped = refused = 0
    total_calls = len(sections) * len(kinds)
    done = 0
    for s in sections:
        concept_lines = _section_concept_lines(src, s.source_section_key)
        for kind in kinds:
            done += 1
            if (s.source_section_key, kind) in existing:
                continue
            items, n_dropped = _author_section(kind, s.heading, s.markdown, concept_lines, _author_model(model))
            dropped += n_dropped
            if not items and not n_dropped:
                refused += 1  # an empty list is the prompt's sanctioned answer, not an error
            for i, it in enumerate(items):
                with db() as conn:
                    conn.execute(
                        "INSERT INTO ext_practice (key, doc_id, structure_id, section_key, kind, "
                        'prompt, answer, rubric, payload, "order", created_at) '
                        "VALUES (%(k)s, %(d)s, (SELECT id FROM raw_structure WHERE id = %(sid)s), "
                        "%(sk)s, %(kind)s, %(p)s, %(a)s, %(r)s, %(pl)s, %(o)s, now())",
                        {
                            "k": uuid.uuid4().hex,
                            "d": src,
                            "sid": f"{src}::{s.source_section_key}",
                            "sk": s.source_section_key,
                            "kind": it["kind"],
                            "p": it["prompt"],
                            "a": it["answer"],
                            "r": it["rubric"],
                            "pl": Json(it["payload"]) if it.get("payload") is not None else None,
                            "o": i,
                        },
                    )
                authored += 1
            if on_progress:
                on_progress(done, total_calls, s.heading)
    return {"authored": authored, "dropped": dropped, "refused": refused, "total": total_calls}


def fetch_practice(doc: str | None, scope: str | None) -> dict[str, Any]:
    """The scope's practice items, inherited through the version's blocks (concept_filter —
    a bare raw read of the book is the recurring bug this call shape prevents). Item
    sectionKeys come back translated onto THIS version's outline."""
    try:
        doc = resolve_doc_id(doc)
        if not doc:
            return {"docId": None, "items": []}
        span = scope_section_keys(doc, scope) if scope else None
        pred, binds = concept_filter(doc, list(span) if span is not None else None)
        with db() as conn:
            rows = conn.execute(
                'SELECT key, section_key AS "sectionKey", kind, prompt, answer, rubric, payload, '
                '"order", extract(epoch from created_at)::float8 AS "createdAt", '
                'extract(epoch from edited_at)::float8 AS "editedAt" '
                f'FROM ext_practice WHERE {pred} ORDER BY section_key, kind, "order", created_at',
                binds,
            ).fetchall()
        # Items carry the BOOK's section keys; the UI renders the version's outline.
        by_source = version_sections_by_source(doc)
        for r in rows:
            vks = by_source.get(r["sectionKey"])
            if vks:
                r["sectionKey"] = vks[0]
        return {
            "docId": doc,
            "scope": scope,
            "items": rows,
            "staleSections": _stale_sections(doc),
        }
    except Exception as exc:  # noqa: BLE001
        return {"docId": doc, "items": [], "error": str(exc)}


def _stale_sections(doc_id: str) -> list[str]:
    """Version sections whose material changed after their items were authored — derived
    from timestamps, never stored (same rule as editing.stale_sections)."""
    try:
        src = source_id_of(doc_id)
        with db() as conn:
            rows = conn.execute(
                "SELECT COALESCE(vs.section_key, c.section_key) AS ver_key, "
                "  max(extract(epoch from COALESCE(vb.edited_at, c.edited_at))) AS edited, "
                "  min(extract(epoch from ep.created_at)) AS built "
                "FROM version_blocks vb "
                "JOIN raw_content c ON c.key = vb.content_key "
                "LEFT JOIN raw_structure vs ON vs.id = vb.structure_id "
                "JOIN ext_practice ep ON ep.doc_id = %(src)s AND ep.section_key = c.section_key "
                "WHERE vb.version_id = %(d)s "
                "  AND COALESCE(vb.edited_at, c.edited_at) IS NOT NULL "
                "GROUP BY 1",
                {"d": doc_id, "src": src},
            ).fetchall()
        return sorted(
            r["ver_key"] for r in rows if r.get("edited") and r.get("built") and r["edited"] > r["built"]
        )
    except Exception:  # noqa: BLE001 — staleness is decoration, never a failure
        return []


def practice_status(doc: str | None, scope: str | None) -> dict[str, Any]:
    """How much of the scope has items yet ({total, authored} sections + per-kind counts
    + running flag) — the prepare poller's shape, per guide_status."""
    doc = resolve_doc_id(doc)
    if not doc:
        return {"total": 0, "authored": 0, "byKind": {}, "running": False}
    src = source_id_of(doc)
    sections = load_section_blocks(doc, scope=scope, coalesce=True)
    src_keys = [s.source_section_key for s in sections]
    by_kind: dict[str, int] = {}
    covered: set[str] = set()
    if src_keys:
        with db() as conn:
            for r in conn.execute(
                "SELECT section_key, kind, count(*) AS n FROM ext_practice "
                "WHERE doc_id = %(d)s AND section_key = ANY(%(ks)s::text[]) GROUP BY 1, 2",
                {"d": src, "ks": src_keys},
            ).fetchall():
                covered.add(r["section_key"])
                by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + int(r["n"])
    running = False
    try:
        from app.gateways import list_builds

        running = any(
            j.get("scope") == (scope or "") and j.get("status") in ("queued", "running")
            for j in list_builds(doc, kind="practice").get("builds", [])
        )
    except Exception:  # noqa: BLE001
        pass
    return {"total": len(sections), "authored": len(covered), "byKind": by_kind, "running": running}


# --------------------------------------------------------------------------- #
# Curation writes — create / edit / delete. Editing an item marks it YOURS
# (edited_at) and no regeneration will ever overwrite it.
# --------------------------------------------------------------------------- #


def create_item(doc: str | None, section_key: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Hand-author one item. ``section_key`` is THIS version's key; stored against the
    book's. edited_at is set at insert — hand-written items are never regenerable."""
    doc = resolve_doc_id(doc)
    if not doc:
        return {"error": "no document found", "status": 404}
    kind = str(fields.get("kind") or "").strip()
    prompt = str(fields.get("prompt") or "").strip()
    answer = str(fields.get("answer") or "").strip()
    if not kind or not prompt or not answer:
        return {"error": "kind, prompt and answer are required", "status": 400}
    src = source_id_of(doc)
    from app.process.content import source_sections

    src_keys = source_sections(doc, [section_key]) or [section_key]
    key = uuid.uuid4().hex
    with db() as conn:
        conn.execute(
            "INSERT INTO ext_practice (key, doc_id, structure_id, section_key, kind, prompt, "
            'answer, rubric, payload, "order", created_at, edited_at) '
            "VALUES (%(k)s, %(d)s, (SELECT id FROM raw_structure WHERE id = %(sid)s), %(sk)s, "
            "%(kind)s, %(p)s, %(a)s, %(r)s, %(pl)s, 0, now(), now())",
            {
                "k": key, "d": src, "sid": f"{src}::{src_keys[0]}", "sk": src_keys[0],
                "kind": kind, "p": prompt, "a": answer,
                "r": (str(fields.get("rubric")).strip() or None) if fields.get("rubric") else None,
                "pl": Json(fields["payload"]) if fields.get("payload") is not None else None,
            },
        )
    return {"created": key}


def update_item(key: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Edit an item's curatable fields; stamps edited_at so regeneration spares it."""
    patch = {k: v for k, v in (patch or {}).items() if k in EDITABLE_FIELDS}
    if not patch:
        return {"error": f"no editable fields; allowed: {sorted(EDITABLE_FIELDS)}", "status": 400}
    sets, params = [], {"key": key}
    for f, v in patch.items():
        sets.append(f'"{f}" = %({f})s')
        params[f] = Json(v) if f == "payload" and v is not None else v
    with db() as conn:
        row = conn.execute(
            f"UPDATE ext_practice SET {', '.join(sets)}, edited_at = now() "
            "WHERE key = %(key)s RETURNING key",
            params,
        ).fetchone()
    if row is None:
        return {"error": f"item {key} not found", "status": 404}
    return {"updated": key, "fields": sorted(patch)}


def delete_item(key: str) -> dict[str, Any]:
    """Remove one item and its review schedule (the study-row cascade concepts also do)."""
    with db() as conn:
        row = conn.execute("SELECT kind FROM ext_practice WHERE key = %(k)s", {"k": key}).fetchone()
        if row is None:
            return {"error": f"item {key} not found", "status": 404}
        conn.execute("DELETE FROM ext_practice WHERE key = %(k)s", {"k": key})
    try:
        from app.supplemental.study import delete_concept_reviews, practice_review_key

        delete_concept_reviews(practice_review_key(key))
    except Exception:  # noqa: BLE001 — an orphaned review row is inert, never block a delete
        pass
    return {"deleted": key, "kind": row.get("kind")}
