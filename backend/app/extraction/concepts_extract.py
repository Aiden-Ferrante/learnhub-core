"""Concept-course extraction: turn a section of text into atomic concept-lessons.

The product is a *course*, not a triple graph. Each concept is one learnable idea
(definition / theorem / principle / result / method) carrying a self-contained lesson:
``signal`` (distilled explanation) and ``source`` (the verbatim passage that grounds it).

Section loading + scope resolution come from ``content.scope`` (the shared owner);
this module owns the prompts, the structured-output transport, the grounding gate,
and the write path. The pure parse/assemble/key functions are unit-tested without
LLM or DB.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

from app.content import resolve_doc_id
from psycopg.types.json import Json

from app.content import SectionExtractInput, load_section_blocks
from app.content import clean_heading_markup
from app.platform import db
from app.platform import ollama_structured_completion
from app.platform import ConceptResult

_KINDS = ("definition", "theorem", "principle", "result", "method")

_DEFAULT_DOMAIN = "a mathematics / causal-inference textbook"


def _domain() -> str:
    return os.environ.get("LEARN_EXTRACT_DOMAIN") or _DEFAULT_DOMAIN


def _extract_model() -> str | None:
    """Optional extraction-specific model (``LEARN_EXTRACT_MODEL``); else the default
    ``OLLAMA_MODEL`` is used. Lets the batch pick a faster/better model than the chat one."""
    return os.environ.get("LEARN_EXTRACT_MODEL") or None


def _norm_part(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def normalize_entity(name: object) -> str:
    return clean_heading_markup(str(name or "")).strip()


def build_user_prompt(inp: SectionExtractInput) -> str:
    if inp.page_start is None:
        pages = ""
    elif inp.page_end and inp.page_end != inp.page_start:
        pages = f", pages {inp.page_start}-{inp.page_end}"
    else:
        pages = f", page {inp.page_start}"
    return (
        f"Section: {inp.heading}  ({inp.section_key}{pages})\n\n"
        f"<section_markdown>\n{inp.markdown}\n</section_markdown>"
    )

# Grounding gate: a concept with no verbatim source_sentence is almost always manufactured
# from motivational/narrative prose (the observed failure mode). Requiring grounding doubles
# as the domain-specificity filter. Disable with LEARN_REQUIRE_SOURCE=0 to A/B.
_REQUIRE_SOURCE = os.environ.get("LEARN_REQUIRE_SOURCE", "1") != "0"

CONCEPT_SYSTEM_PROMPT = (
    "You are extracting the KEY CONCEPTS from {domain}. From ONE section of the text, list "
    "each ATOMIC CONCEPT the section TEACHES — a single definition, theorem, principle, "
    "result, or method.\n\n"
    "For every concept give:\n"
    "- name: a SHORT canonical term — a noun phrase of 1-4 words that names the idea "
    "(e.g. \"d-separation\", \"Bayes' rule\", \"foundation model\"). NOT a sentence, NOT a claim, "
    "NOT a statistic. If you can't name it in <=4 words, it's probably a fact, not a concept — skip it.\n"
    "- kind: one of definition | theorem | principle | result | method. Use `result` ONLY for a "
    "general, reusable finding that holds beyond this book's examples — never as a catch-all to "
    "launder a one-off observation, product metric, or opinion into a concept.\n"
    "- signal: a distilled, self-contained explanation in 1-3 sentences — exactly what a "
    "learner needs to know. It must EXPLAIN what the concept is or does, in the learner's terms; "
    "never merely restate the name or echo one source sentence verbatim (e.g. 'This approach is "
    "prompt engineering' is not an explanation). If the naming sentence is itself uninformative, "
    "draw the meaning from the neighbouring sentences (and cite them all in source_sentence). A "
    "vague umbrella claim ('X is powerful', 'X can do many tasks', 'X is important') teaches "
    "nothing — skip such a concept. No \"this\", \"it\", \"we\", \"the author\", no section/page "
    "references; name every concept in full.\n"
    "- source_sentence: copy VERBATIM the sentence(s) from the text that DEFINE or ASSERT this "
    "concept — the sentence a reader would underline to justify the signal, NOT one that merely "
    "mentions the term in passing or gives an example. Every claim in `signal` must appear in it.\n\n"
    "Rules:\n"
    "- One concept per atomic idea; never pack two ideas into one.\n"
    "- Extract only DURABLE, TEACHABLE concepts — a named idea that GENERALIZES beyond this book's "
    "examples, that a learner could be asked to define or apply elsewhere. SKIP anything that only "
    "reports what a specific tool, company, or person did, has, predicts, or prefers: one-off facts, "
    "statistics, dates, dollar amounts, revenue/adoption/popularity figures, product or tool "
    "mentions, benchmark numbers, expert quotes, forecasts and predictions, opinions, anecdotes, and "
    "motivational or historical prose (e.g. 'AI coding startups raised hundreds of millions', 'a CEO "
    "predicts AI will replace engineers', and 'AI is better at frontend than backend' are all facts "
    "or opinions, not concepts). A GENERIC name does not rescue a fact: if the sentence stating the "
    "concept is a statistic or a single study's measurement (e.g. 'developers were 25-50% more "
    "productive'), it is a fact — do not launder it into a concept by naming it generically "
    "(e.g. 'productivity improvement').\n"
    "- A section may legitimately contain ZERO concepts. If a section is narrative, a use-case tour, "
    "a market survey, or opinion, return an empty list — do NOT manufacture a concept to fill it.\n"
    "- Ground the signal in the source: if a claim in `signal` is not stated in source_sentence, "
    "delete that claim. Never add facts, numbers, or scope the source does not contain.\n"
    "- If the section only NAMES a concept without any sentence that states what it IS, SKIP it — a "
    "concept you can support only with a passing mention is noise, not a lesson.\n"
    "- Do not invent anything not stated. Canonicalize names (collapse variants to one).\n"
    "- Return ONLY data conforming to the schema."
)


# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class ExtractedConcept:
    name: str
    kind: str
    signal: str
    source: str


@dataclass(frozen=True)
class SectionConcepts:
    doc_id: str
    section_key: str
    page_start: int | None
    page_end: int | None
    concepts: tuple[ExtractedConcept, ...]


# --------------------------------------------------------------------------- #
# Pure functions (unit-testable)
# --------------------------------------------------------------------------- #

def build_concept_system_prompt() -> str:
    return CONCEPT_SYSTEM_PROMPT.format(domain=_domain())


def normalize_concept_name(name: object) -> str:
    return normalize_entity(name)


def parse_concepts_response(obj: object, stats: dict | None = None) -> list[ExtractedConcept]:
    """Validate the model's structured output into concepts (drop malformed).

    ``stats`` (optional dict) is updated with drop accounting — ``raw`` (items the model
    returned), ``malformed`` and ``gated`` (dropped by the source-grounding gate) — so a
    zero-concept section can say WHY it's empty instead of failing silently."""
    if not isinstance(obj, dict):
        return []
    items = obj.get("concepts")
    if not isinstance(items, list):
        return []
    if stats is not None:
        stats["raw"] = stats.get("raw", 0) + len(items)
    out: list[ExtractedConcept] = []
    for c in items:
        if not isinstance(c, dict):
            if stats is not None:
                stats["malformed"] = stats.get("malformed", 0) + 1
            continue
        name = normalize_concept_name(c.get("name"))
        signal = _norm_part(c.get("signal"))
        if not name or not signal:
            if stats is not None:
                stats["malformed"] = stats.get("malformed", 0) + 1
            continue
        source = _norm_part(c.get("source_sentence"))
        if _REQUIRE_SOURCE and not source:
            if stats is not None:
                stats["gated"] = stats.get("gated", 0) + 1
            continue  # ungrounded -> almost always prose/narrative noise (domain-specificity gate)
        kind = str(c.get("kind") or "").strip().lower()
        if kind not in _KINDS:
            kind = "result"
        out.append(ExtractedConcept(name=name, kind=kind, signal=signal, source=source))
    return out


def assemble_section_concepts(
    doc_id: str, section_key: str, page_start: int | None, page_end: int | None,
    concepts: list[ExtractedConcept],
) -> SectionConcepts:
    return SectionConcepts(
        doc_id=doc_id,
        section_key=section_key,
        page_start=page_start,
        page_end=page_end,
        concepts=tuple(concepts),
    )


def concept_key(doc_id: str, section_key: str, name: str) -> str:
    return hashlib.sha256(f"{doc_id}|{section_key}|{name.lower()}".encode()).hexdigest()[:16]


def match_renamed_concepts(
    old: list[tuple[str, str]], new: list[tuple[str, str]], threshold: float = 0.75
) -> dict[str, str]:
    """Greedy best-match of RENAMED concepts by name similarity: ``old``/``new`` are
    ``(key, name)`` pairs; returns ``{old_key: new_key}``, each new key used at most once.

    The identity contract (docs/concept-identity.md): a concept's key is a hash of its
    name, so an unchanged name keeps its key and never enters this matcher. This handles
    the rename case — 'LLM' → 'Large language model' — so a re-extraction that improves
    a name carries the learner's review history forward instead of orphaning it."""
    def norm(s: str) -> str:
        return " ".join((s or "").lower().split())

    scored: list[tuple[float, str, str]] = []
    for ok, on in ((k, norm(n)) for k, n in old):
        for nk, nn in ((k, norm(n)) for k, n in new):
            r = SequenceMatcher(None, on, nn).ratio()
            if r >= threshold:
                scored.append((r, ok, nk))
    scored.sort(key=lambda t: (-t[0], t[1], t[2]))  # best ratio first; ties deterministic
    used_old: set[str] = set()
    used_new: set[str] = set()
    out: dict[str, str] = {}
    for _r, ok, nk in scored:
        if ok in used_old or nk in used_new:
            continue
        used_old.add(ok)
        used_new.add(nk)
        out[ok] = nk
    return out


# --------------------------------------------------------------------------- #
# Write path
# --------------------------------------------------------------------------- #

def write_section_concepts(sc: SectionConcepts, batch: int = 500) -> None:
    # Re-extraction must be idempotent: clear this section's existing concepts first, else
    # concepts the new run no longer produces (renamed/dropped) linger.
    rows = []
    for idx, c in enumerate(sc.concepts):
        rows.append(
            {
                "key": concept_key(sc.doc_id, sc.section_key, c.name),
                "doc_id": sc.doc_id,
                "section_key": sc.section_key,
                "page_start": sc.page_start,
                "page_end": sc.page_end,
                "name": c.name,
                "kind": c.kind,
                "signal": c.signal,
                "source": c.source,
                "order": idx,
            }
        )
    new_keys = {r["key"] for r in rows}
    with db() as conn, conn.transaction():
        # Review continuity across renames: before wiping the old rows, re-key the SM-2
        # review row (and the study-event history) of any REVIEWED concept whose name —
        # and therefore key — changed, onto its best-matching successor. A re-extraction
        # that improves names must not punish past study time (docs/concept-identity.md).
        old = conn.execute(
            "SELECT key, name FROM concepts WHERE doc_id = %(d)s AND section_key = %(s)s",
            {"d": sc.doc_id, "s": sc.section_key},
        ).fetchall()
        old_keys = {o["key"] for o in old}
        vanished = [o for o in old if o["key"] not in new_keys]
        if vanished and rows:
            reviewed = {
                r["key"]
                for r in conn.execute(
                    "SELECT key FROM concept_reviews WHERE key = ANY(%(ks)s::text[])",
                    {"ks": [o["key"] for o in vanished]},
                ).fetchall()
            }
            carried = match_renamed_concepts(
                [(o["key"], o["name"]) for o in vanished if o["key"] in reviewed],
                [(r["key"], r["name"]) for r in rows if r["key"] not in old_keys],
            )
            for old_key, new_key in carried.items():
                moved = conn.execute(
                    "UPDATE concept_reviews SET key = %(n)s WHERE key = %(o)s "
                    "AND NOT EXISTS (SELECT 1 FROM concept_reviews WHERE key = %(n)s)",
                    {"n": new_key, "o": old_key},
                ).rowcount
                if moved:
                    conn.execute(
                        "UPDATE study_events SET concept_key = %(n)s WHERE concept_key = %(o)s",
                        {"n": new_key, "o": old_key},
                    )
        conn.execute(
            "DELETE FROM concepts WHERE doc_id = %(d)s AND section_key = %(s)s",
            {"d": sc.doc_id, "s": sc.section_key},
        )
        if rows:
            conn.cursor().executemany(
                'INSERT INTO concepts (key, doc_id, section_key, page_start, page_end, name, kind, '
                'signal, source, "order", created_at) VALUES (%(key)s,%(doc_id)s,%(section_key)s,'
                '%(page_start)s,%(page_end)s,%(name)s,%(kind)s,%(signal)s,%(source)s,%(order)s, now()) '
                "ON CONFLICT (key) DO UPDATE SET doc_id=EXCLUDED.doc_id, section_key=EXCLUDED.section_key, "
                "page_start=EXCLUDED.page_start, page_end=EXCLUDED.page_end, name=EXCLUDED.name, "
                "kind=EXCLUDED.kind, signal=EXCLUDED.signal, source=EXCLUDED.source, "
                '"order"=EXCLUDED."order", created_at=EXCLUDED.created_at',
                rows,
            )


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def _max_section_chars() -> int:
    """Safety chunk threshold — sections longer than this are split on paragraph
    boundaries and extracted per chunk (results merged). With OLLAMA_NUM_CTX at 32K
    tokens this is rarely hit, but a monster section must not silently truncate."""
    try:
        return int(os.environ.get("LEARN_EXTRACT_MAX_CHARS") or 60_000)
    except ValueError:
        return 60_000


def _split_markdown_chunks(md: str, limit: int) -> list[str]:
    """Split on blank lines into chunks of at most ``limit`` chars (a single oversized
    paragraph becomes its own chunk rather than being dropped)."""
    chunks: list[str] = []
    cur: list[str] = []
    size = 0
    for para in md.split("\n\n"):
        plen = len(para) + 2
        if cur and size + plen > limit:
            chunks.append("\n\n".join(cur))
            cur, size = [], 0
        cur.append(para)
        size += plen
    if cur:
        chunks.append("\n\n".join(cur))
    return chunks


def _extract_one_section_concepts(
    inp, model: str | None = None
) -> tuple[SectionConcepts | None, str | None, dict]:
    """Extract one section's concepts. Returns ``(section_concepts, error, meta)`` where
    ``meta`` carries drop accounting (raw/gated/malformed) and the chunk count."""
    # Precedence: the request's model (UI picker) > LEARN_EXTRACT_MODEL > OLLAMA_MODEL.
    use_model = model or _extract_model()
    meta: dict = {}
    limit = _max_section_chars()
    parts = _split_markdown_chunks(inp.markdown, limit) if len(inp.markdown) > limit else [inp.markdown]
    if len(parts) > 1:
        meta["chunks"] = len(parts)

    merged: list[ExtractedConcept] = []
    seen_names: set[str] = set()
    last_err: str | None = None
    for part in parts:
        piece = inp if len(parts) == 1 else replace(inp, markdown=part)
        messages = [
            {"role": "system", "content": build_concept_system_prompt()},
            {"role": "user", "content": build_user_prompt(piece)},
        ]
        obj = None
        for _ in range(3):
            obj, err = ollama_structured_completion(
                messages, ConceptResult, temperature=0.2, model=use_model
            )
            if obj is not None:
                break
            last_err = err
        if obj is None:
            if len(parts) == 1:
                return None, last_err, meta
            continue  # a failed chunk shouldn't sink the section's other chunks
        for c in parse_concepts_response(obj, stats=meta):
            if c.name.lower() in seen_names:
                continue
            seen_names.add(c.name.lower())
            merged.append(c)

    return (
        assemble_section_concepts(inp.doc_id, inp.section_key, inp.page_start, inp.page_end, merged),
        None,
        meta,
    )


async def extract_concepts_document(
    doc_id: str | None = None,
    section_keys: list[str] | None = None,
    scope: str | None = None,
    concurrency: int = 3,
    model: str | None = None,
    on_progress=None,
) -> dict:
    """Build concept-lessons for a document (``scope=toc:1`` = one chapter). Background-job
    friendly; failures are isolated per section. ``model`` overrides the extraction model
    (the UI-selected Ollama model); falls back to LEARN_EXTRACT_MODEL / OLLAMA_MODEL.

    ``on_progress(done, total, current_section_key)`` is invoked (if given) as each section
    finishes, so a polling client can render a live progress bar."""
    t0 = time.time()
    doc_id = resolve_doc_id(doc_id)
    if not doc_id:
        return {"error": "no document found"}

    skipped: list[dict] = []
    sections = load_section_blocks(doc_id, section_keys=section_keys, scope=scope, skipped_out=skipped)
    outcomes: list[dict] = [
        {"sectionKey": s["sectionKey"], "heading": s["heading"], "status": "skipped", "reason": s["reason"]}
        for s in skipped
    ]
    if not sections:
        return {
            "docId": doc_id, "scope": scope, "sections": 0, "concepts": 0,
            "outcomes": outcomes, "errors": ["no sections with content"],
        }

    total = len(sections)
    done = 0
    if on_progress:
        on_progress(0, total, None)

    sem = asyncio.Semaphore(max(1, concurrency))
    results: list[SectionConcepts] = []
    errors: list[str] = []

    async def run(inp) -> None:
        nonlocal done
        async with sem:
            sc, err, meta = await asyncio.to_thread(_extract_one_section_concepts, inp, model)
            outcome = {"sectionKey": inp.section_key, "heading": inp.heading, **meta}
            if err:
                errors.append(f"{inp.section_key}: {err}")
                outcome.update(status="error", error=str(err)[:300])
            elif sc is not None:
                results.append(sc)
                # A zero-concept section now says WHY: nothing returned vs everything gated.
                outcome.update(status="ok" if sc.concepts else "empty", concepts=len(sc.concepts))
            outcomes.append(outcome)
            # Safe under asyncio: the increment runs on the event loop, not in the thread.
            done += 1
            if on_progress:
                on_progress(done, total, inp.section_key)

    await asyncio.gather(*(run(s) for s in sections))
    if on_progress:
        on_progress(total, total, "finalizing")

    total_concepts = 0
    for sc in results:
        write_section_concepts(sc)
        total_concepts += len(sc.concepts)

    # No embedding-based dedup (resolution): each section contributes its key concepts (name +
    # kind + grounded signal). The read path groups by canonicalKey OR the concept's own key,
    # so concepts still render without a resolve pass.

    # Reading-order outcomes read better than completion-order.
    outcomes.sort(key=lambda o: str(o.get("sectionKey") or ""))

    return {
        "docId": doc_id,
        "scope": scope,
        "sections": len(sections),
        "extracted": len(results),
        "concepts": total_concepts,
        "outcomes": outcomes,
        "seconds": round(time.time() - t0, 1),
        "errors": errors,
    }
