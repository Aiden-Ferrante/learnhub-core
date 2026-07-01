"""Concept-course extraction: turn a section of text into atomic concept-lessons.

The product is a *course*, not a triple graph. Each concept is one learnable idea
(definition / theorem / principle / result / method) carrying a self-contained lesson:
``signal`` (distilled explanation), ``source`` (verbatim passage), ``questions``
(retrieval practice) and ``prereqNames`` (concepts to learn first). Concepts link by a
``concept_prereq`` edge into a learning path.

Reuses the extraction engine from ``app.extract`` (section loading + chapter scope, the
domain-aware user prompt, the per-section model, structured-output transport, the
structural ``has_subsection`` edges) and only swaps the schema / system prompt / write
target. The pure parse/assemble/key/prereq functions are unit-tested without LLM or DB.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import time
from dataclasses import dataclass

from app.arango_content import fetch_latest_document
from app.arango_tree import connect_arango
from app.extract import (
    _domain,
    _extract_model,
    _load_section_blocks,
    _norm_part,
    normalize_entity,
    structural_subsection_triples,
    upsert_structural_edges,
)
from app.llm import ollama_structured_completion
from app.llm_schemas import ConceptResult

CONCEPTS = "concepts"
CONCEPT_PREREQ = "concept_prereq"

_KINDS = ("definition", "theorem", "principle", "result", "method")

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
class ConceptQuestion:
    q: str
    a: str


@dataclass(frozen=True)
class ExtractedConcept:
    name: str
    kind: str
    signal: str
    source: str
    questions: tuple[ConceptQuestion, ...]
    prereq_names: tuple[str, ...]


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


def _name_norm(name: str) -> str:
    return normalize_concept_name(name).lower()


def parse_concepts_response(obj: object) -> list[ExtractedConcept]:
    """Validate the model's structured output into concepts (drop malformed)."""
    if not isinstance(obj, dict):
        return []
    items = obj.get("concepts")
    if not isinstance(items, list):
        return []
    out: list[ExtractedConcept] = []
    for c in items:
        if not isinstance(c, dict):
            continue
        name = normalize_concept_name(c.get("name"))
        signal = _norm_part(c.get("signal"))
        if not name or not signal:
            continue
        source = _norm_part(c.get("source_sentence"))
        if _REQUIRE_SOURCE and not source:
            continue  # ungrounded -> almost always prose/narrative noise (domain-specificity gate)
        kind = str(c.get("kind") or "").strip().lower()
        if kind not in _KINDS:
            kind = "result"
        questions: list[ConceptQuestion] = []
        for q in c.get("questions") or []:
            if isinstance(q, dict):
                qq, aa = _norm_part(q.get("q")), _norm_part(q.get("a"))
                if qq and aa:
                    questions.append(ConceptQuestion(q=qq, a=aa))
        prereqs = []
        seen: set[str] = set()
        for p in c.get("prerequisites") or []:
            pn = normalize_concept_name(p)
            if pn and pn.lower() not in seen and pn.lower() != name.lower():
                seen.add(pn.lower())
                prereqs.append(pn)
        out.append(
            ExtractedConcept(
                name=name,
                kind=kind,
                signal=signal,
                source=source,
                questions=tuple(questions),
                prereq_names=tuple(prereqs),
            )
        )
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


def resolve_prereq_pairs(
    concepts: list[tuple[str, str, list[str]]]
) -> list[tuple[str, str]]:
    """``concepts`` = ``(key, name, prereq_names)`` for all of a document's concepts.
    Returns ``(from_key, to_key)`` prerequisite pairs for names that resolve to a concept
    (unresolved prereq names are dropped, not invented). ``from`` requires ``to``."""
    by_name: dict[str, str] = {}
    for key, name, _prereqs in concepts:
        by_name.setdefault(_name_norm(name), key)
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for key, _name, prereqs in concepts:
        for pn in prereqs:
            to = by_name.get(_name_norm(pn))
            if to and to != key and (key, to) not in seen:
                seen.add((key, to))
                pairs.append((key, to))
    return pairs


def orient_prereq_edges(
    pairs: list[tuple[str, str]],
    ranks: dict[str, int],
    texts: dict[str, str],
    names: dict[str, str],
) -> list[tuple[str, str, int]]:
    """Give each model-proposed prerequisite pair a DIRECTION from reading order, and a
    mention-based RefD confidence.

    The model is good at saying two concepts are *related* but unreliable about which comes
    first; within a single text the concept introduced earlier is the prerequisite (RefD
    intuition). Orienting every edge from the later concept to the earlier one both enforces
    that direction and guarantees an acyclic graph (a strict reading-order rank can't cycle).

    ``pairs`` = ``(dependent_key, prereq_key)`` as named by the model. ``ranks`` = global
    reading rank per concept key; ``texts`` = lowercased signal+source per key; ``names`` =
    normalized lowercased name per key. Returns deduped ``(from_key, to_key, refd)`` where the
    edge means ``from`` (later) requires ``to`` (earlier). ``refd`` ∈ {-1,0,1}: +1 = the
    dependent's text references the prerequisite (strong signal), -1 = only the reverse."""

    def mentions(of_key: str, in_key: str) -> bool:
        n = names.get(of_key, "")
        return len(n) > 2 and n in texts.get(in_key, "")

    oriented: dict[tuple[str, str], int] = {}
    for a, b in pairs:
        if a == b:
            continue
        ra, rb = ranks.get(a), ranks.get(b)
        if ra is not None and rb is not None and ra != rb:
            later, earlier = (a, b) if ra > rb else (b, a)
        else:
            later, earlier = a, b  # no order signal — keep the model's direction (a requires b)
        refd = int(mentions(earlier, later)) - int(mentions(later, earlier))
        edge = (later, earlier)
        if edge not in oriented or refd > oriented[edge]:
            oriented[edge] = refd
    return [(f, t, r) for (f, t), r in oriented.items()]


# --------------------------------------------------------------------------- #
# ArangoDB write path
# --------------------------------------------------------------------------- #

def ensure_concept_collections(db) -> None:
    if not db.has_collection(CONCEPTS):
        col = db.create_collection(CONCEPTS)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["sectionKey"])
    if not db.has_collection(CONCEPT_PREREQ):
        col = db.create_collection(CONCEPT_PREREQ, edge=True)
        col.add_persistent_index(fields=["docId"])
    # The structural TOC tree (has_subsection) is written by upsert_structural_edges into
    # entities/relationships so get_toc_tree still renders. Ensure they exist — on a fresh
    # DB (no prior triple run) they otherwise wouldn't, and the structural write would throw.
    if not db.has_collection("entities"):
        db.create_collection("entities")
    if not db.has_collection("relationships"):
        db.create_collection("relationships", edge=True)


def write_section_concepts(db, sc: SectionConcepts, batch: int = 500) -> None:
    # Re-extraction must be idempotent: clear this section's existing concepts first, else
    # concepts the new run no longer produces (renamed/dropped) linger (import_bulk only
    # overwrites same-key rows, never deletes).
    db.aql.execute(
        "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey == @s REMOVE c IN concepts",
        bind_vars={"d": sc.doc_id, "s": sc.section_key},
    )
    rows = []
    for idx, c in enumerate(sc.concepts):
        rows.append(
            {
                "_key": concept_key(sc.doc_id, sc.section_key, c.name),
                "docId": sc.doc_id,
                "sectionKey": sc.section_key,
                "pageStart": sc.page_start,
                "pageEnd": sc.page_end,
                "name": c.name,
                "kind": c.kind,
                "signal": c.signal,
                "source": c.source,
                "questions": [{"q": q.q, "a": q.a} for q in c.questions],
                "prereqNames": list(c.prereq_names),
                "order": idx,
                "createdAt": int(time.time()),
            }
        )
    if rows:
        db.collection(CONCEPTS).import_bulk(rows, on_duplicate="replace")


def _concept_reading_ranks(db, doc_id: str, rows: list[dict]) -> dict[str, int]:
    """Global reading rank per concept: section reading order, then within-section order.
    A strict unique rank makes the oriented prereq graph provably acyclic."""
    sec_order: dict[str, int] = {}
    for r in db.aql.execute(
        "FOR s IN section_content FILTER s.docId == @d RETURN {k: s.sectionKey, o: s.order}",
        bind_vars={"d": doc_id},
    ):
        k, o = r.get("k"), r.get("o") or 0
        if k is not None and (k not in sec_order or o < sec_order[k]):
            sec_order[k] = o
    ordered = sorted(
        rows,
        key=lambda r: (sec_order.get(r["sk"], 1_000_000), r.get("ord") or 0, r["key"]),
    )
    return {r["key"]: i for i, r in enumerate(ordered)}


def rebuild_prereq_edges(db, doc_id: str, min_refd: int | None = None) -> int:
    """Recompute ``concept_prereq`` edges from all of a document's concepts' prereqNames.

    The model names *related* concepts; we resolve those to keys, then orient each edge by
    reading order (RefD intuition — earlier concept is the prerequisite), which enforces
    direction and guarantees acyclicity, and attach a mention-based ``refd`` confidence.
    ``min_refd`` (env ``LEARN_PREREQ_MIN_REFD``, default -1 = keep all) drops weaker edges.
    Idempotent: clears the doc's existing prereq edges first."""
    db.aql.execute(
        "FOR e IN concept_prereq FILTER e.docId == @d REMOVE e IN concept_prereq",
        bind_vars={"d": doc_id},
    )
    rows = list(
        db.aql.execute(
            "FOR c IN concepts FILTER c.docId == @d RETURN {key: c._key, name: c.name, "
            "sk: c.sectionKey, ord: c.order, prereqs: c.prereqNames, signal: c.signal, "
            "source: c.source, canon: c.canonicalKey}",
            bind_vars={"d": doc_id},
        )
    )
    ranks = _concept_reading_ranks(db, doc_id, rows)
    names = {r["key"]: _name_norm(r["name"]) for r in rows}
    texts = {r["key"]: f"{r.get('signal') or ''} {r.get('source') or ''}".lower() for r in rows}
    triples = [(r["key"], r["name"], list(r.get("prereqs") or [])) for r in rows]

    # Collapse onto canonical concepts (within-doc dedup): edges between duplicate concepts
    # become edges between their canonical representatives; self-loops after collapse drop out.
    canon = {r["key"]: (r.get("canon") or r["key"]) for r in rows}
    pairs = resolve_prereq_pairs(triples)
    pairs = [(canon.get(a, a), canon.get(b, b)) for a, b in pairs]
    pairs = [(a, b) for a, b in pairs if a != b]
    edges = orient_prereq_edges(pairs, ranks, texts, names)
    if min_refd is None:
        env = os.environ.get("LEARN_PREREQ_MIN_REFD")
        min_refd = int(env) if env not in (None, "") else -1
    edges = [e for e in edges if e[2] >= min_refd]
    if edges:
        db.collection(CONCEPT_PREREQ).import_bulk(
            [
                {
                    "_key": hashlib.md5(f"{a}|{b}".encode()).hexdigest()[:16],
                    "_from": f"concepts/{a}",
                    "_to": f"concepts/{b}",
                    "type": "prerequisite",
                    "refd": r,
                    "docId": doc_id,
                }
                for a, b, r in edges
            ],
            on_duplicate="replace",
        )
    return len(edges)


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def _extract_one_section_concepts(inp, model: str | None = None) -> tuple[SectionConcepts | None, str | None]:
    from app.extract import build_user_prompt  # reuse the templated user message

    messages = [
        {"role": "system", "content": build_concept_system_prompt()},
        {"role": "user", "content": build_user_prompt(inp)},
    ]
    # Precedence: the request's model (UI picker) > LEARN_EXTRACT_MODEL > OLLAMA_MODEL.
    use_model = model or _extract_model()
    last_err: str | None = None
    for _ in range(3):
        obj, err = ollama_structured_completion(
            messages, ConceptResult, temperature=0.2, model=use_model
        )
        if obj is not None:
            concepts = parse_concepts_response(obj)
            return assemble_section_concepts(
                inp.doc_id, inp.section_key, inp.page_start, inp.page_end, concepts
            ), None
        last_err = err
    return None, last_err


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
    db = connect_arango()
    if doc_id is None:
        doc = (fetch_latest_document() or {}).get("document")
        doc_id = doc.get("id") if doc else None
    if not doc_id:
        return {"error": "no document found"}

    ensure_concept_collections(db)
    sections = _load_section_blocks(db, doc_id, section_keys=section_keys, scope=scope)
    if not sections:
        return {"docId": doc_id, "scope": scope, "sections": 0, "concepts": 0, "errors": ["no sections with content"]}

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
            sc, err = await asyncio.to_thread(_extract_one_section_concepts, inp, model)
            if err:
                errors.append(f"{inp.section_key}: {err}")
            elif sc is not None:
                results.append(sc)
            # Safe under asyncio: the increment runs on the event loop, not in the thread.
            done += 1
            if on_progress:
                on_progress(done, total, inp.section_key)

    await asyncio.gather(*(run(s) for s in sections))
    if on_progress:
        on_progress(total, total, "finalizing")

    total_concepts = 0
    total_questions = 0
    for sc in results:
        write_section_concepts(db, sc)
        total_concepts += len(sc.concepts)
        total_questions += sum(len(c.questions) for c in sc.concepts)

    # Keep the structural TOC tree (drives the syllabus view).
    upsert_structural_edges(db, structural_subsection_triples([s.section_key for s in sections]), doc_id)

    # Eagerly pre-generate the Deep Chapter overlay (assembled briefing + per-section
    # recaps + per-concept deep explanations) so opening the chapter is instant.
    # Idempotent and error-isolated: a failure here never fails the extraction.
    if os.environ.get("LEARN_DEEP_PREGEN", "1") != "0":
        try:
            from app.deep_chapter import generate_deep_chapter_artifacts

            if on_progress:
                on_progress(total, total, "deep chapter overlay")
            deep = await asyncio.to_thread(
                generate_deep_chapter_artifacts,
                db, doc_id, scope, [s.section_key for s in sections], model,
            )
            for k in ("briefingError", "explainError"):
                if deep.get(k):
                    errors.append(f"deep-chapter: {deep[k]}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"deep-chapter: {exc}")

    # Basic mode: no embedding-based dedup (resolution) and no prerequisite graph. Each section
    # just contributes its key concepts (name + kind + grounded signal). The read path groups by
    # canonicalKey OR the concept's own key, so concepts still render without a resolve pass.

    return {
        "docId": doc_id,
        "scope": scope,
        "sections": len(sections),
        "extracted": len(results),
        "concepts": total_concepts,
        "questions": total_questions,
        "canonicalConcepts": total_concepts,
        "mergedConcepts": 0,
        "prereqEdges": 0,
        "seconds": round(time.time() - t0, 1),
        "errors": errors,
    }


def fetch_section_concepts(section_key: str, doc_id: str | None = None) -> dict:
    """Stored concept-lessons for a section (the course view + verification).

    A chapter scope spans ALL its descendant sub-sections (mirrors the reading view via
    the shared level-aware span), not just concepts attached to the exact heading block —
    so a chapter shows every concept it teaches, ordered in reading order. Falls back to
    the exact section key when there's no ``section_content`` to span over.
    """
    try:
        db = connect_arango()
        if not db.has_collection(CONCEPTS):
            return {"sectionKey": section_key, "concepts": []}
        if doc_id is None:
            doc = (fetch_latest_document() or {}).get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"sectionKey": section_key, "concepts": []}

        # Expand the scope to every section key within it (chapter -> all sub-sections) and
        # record each section's reading-order rank + heading so concepts come back in
        # document order and the UI can group them under sub-section headers.
        scope_keys = [section_key]
        section_rank: dict[str, int] = {section_key: 0}
        section_titles: dict[str, str] = {}
        try:
            if db.has_collection("section_content"):
                blocks = list(
                    db.aql.execute(
                        "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
                        bind_vars={"d": doc_id},
                    )
                )
                from app.extract import _blocks_in_scope, _section_level_fn  # avoid import cycle

                matched = _blocks_in_scope(blocks, section_key, _section_level_fn(db, doc_id))
                ranked: dict[str, int] = {}
                for b in matched:
                    sk = b.get("sectionKey")
                    if sk and sk not in ranked:
                        ranked[sk] = b.get("order", len(ranked))
                        if b.get("heading"):
                            section_titles[sk] = b["heading"]
                if ranked:
                    scope_keys = list(ranked.keys())
                    section_rank = ranked
        except Exception:
            scope_keys = [section_key]
            section_rank = {section_key: 0}
            section_titles = {}

        rows = list(
            db.aql.execute(
                "FOR c IN concepts FILTER c.docId == @d AND c.sectionKey IN @ks "
                "RETURN { conceptKey: c._key, name: c.name, kind: c.kind, signal: c.signal, "
                "source: c.source, questions: c.questions, prereqNames: c.prereqNames, "
                "sectionKey: c.sectionKey, order: c.order, "
                "pageStart: c.pageStart, pageEnd: c.pageEnd }",
                bind_vars={"d": doc_id, "ks": scope_keys},
            )
        )
        # Reading order across the span: by section position, then within-section order.
        rows.sort(
            key=lambda c: (
                section_rank.get(c.get("sectionKey"), 1_000_000),
                c.get("order") if c.get("order") is not None else 0,
            )
        )
        # Ordered list of the sub-sections actually carrying concepts, for UI grouping.
        present = {c.get("sectionKey") for c in rows}
        sections = [
            {"sectionKey": sk, "title": section_titles.get(sk, "")}
            for sk in sorted(present, key=lambda k: section_rank.get(k, 1_000_000))
            if sk
        ]
        # Attach each sub-section's one-line essence + relative depth from the cached chapter
        # skeleton, so the guided concept walk can show "where you are" per subsection.
        try:
            from app.skeleton import SKELETONS, _attach_depths, _key as _skel_key

            if db.has_collection(SKELETONS):
                skel = db.collection(SKELETONS).get(_skel_key(doc_id, section_key))
                if skel and skel.get("sections"):
                    skel_secs = _attach_depths(db, doc_id, skel["sections"])
                    by_key = {s.get("sectionKey"): s for s in skel_secs}
                    for sec in sections:
                        s = by_key.get(sec["sectionKey"])
                        if s:
                            sec["essence"] = s.get("essence") or ""
                            sec["depth"] = s.get("depth", 0)
        except Exception:  # noqa: BLE001 — essence is supplementary
            pass
        return {
            "sectionKey": section_key,
            "docId": doc_id,
            "concepts": rows,
            "sections": sections,
        }
    except Exception as exc:
        return {"sectionKey": section_key, "concepts": [], "error": str(exc)}


def fetch_document_concepts(doc_id: str | None = None) -> dict:
    """Document-level CANONICAL concept list (within-doc dedup applied): one entry per
    canonicalKey, in reading order, each carrying the merged provenance of where it appears
    (``appearsIn`` = every section/page the concept — or a duplicate of it — was taught in)."""
    try:
        db = connect_arango()
        if not db.has_collection(CONCEPTS):
            return {"docId": doc_id, "concepts": []}
        if doc_id is None:
            doc = (fetch_latest_document() or {}).get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"docId": None, "concepts": []}
        rows = list(
            db.aql.execute(
                "FOR c IN concepts FILTER c.docId == @d RETURN {key: c._key, canon: c.canonicalKey, "
                "name: c.name, kind: c.kind, signal: c.signal, source: c.source, questions: c.questions, "
                "prereqNames: c.prereqNames, sectionKey: c.sectionKey, pageStart: c.pageStart, "
                "pageEnd: c.pageEnd, order: c.order}",
                bind_vars={"d": doc_id},
            )
        )
        if not rows:
            return {"docId": doc_id, "concepts": []}
        ranks = _concept_reading_ranks(
            db, doc_id, [{"key": r["key"], "sk": r["sectionKey"], "ord": r["order"]} for r in rows]
        )
        by_key = {r["key"]: r for r in rows}
        groups: dict[str, list[dict]] = {}
        for r in rows:
            groups.setdefault(r.get("canon") or r["key"], []).append(r)
        out: list[dict] = []
        for canon_key, members in groups.items():
            rep = by_key.get(canon_key) or min(members, key=lambda m: ranks.get(m["key"], 10**9))
            members_sorted = sorted(members, key=lambda m: ranks.get(m["key"], 10**9))
            out.append(
                {
                    "_rank": ranks.get(rep["key"], 10**9),
                    "conceptKey": rep["key"],
                    "name": rep["name"],
                    "kind": rep["kind"],
                    "signal": rep["signal"],
                    "source": rep.get("source"),
                    "questions": rep.get("questions") or [],
                    "prereqNames": rep.get("prereqNames") or [],
                    "sectionKey": rep["sectionKey"],
                    "pageStart": rep.get("pageStart"),
                    "pageEnd": rep.get("pageEnd"),
                    "appearsIn": [
                        {"sectionKey": m["sectionKey"], "pageStart": m.get("pageStart"), "pageEnd": m.get("pageEnd")}
                        for m in members_sorted
                    ],
                    "aliasCount": len(members) - 1,
                }
            )
        out.sort(key=lambda c: c["_rank"])
        for c in out:
            c.pop("_rank", None)
        return {"docId": doc_id, "concepts": out}
    except Exception as exc:  # noqa: BLE001
        return {"docId": doc_id, "concepts": [], "error": str(exc)}
