"""Server-side, section-aware KG extraction: context-rich propositions + SPO triples.

Replaces the old client-side per-512-char extraction. For each TOC section of a stored
document we read its ``section_content`` markdown (a whole heading-delimited span, not a
fragment) and run Ollama with a domain-aware prompt + JSON-schema structured output to
extract (a) propositions — self-contained claims with their verbatim source sentence —
and (b) normalized triples. Everything is tagged with ``{docId, sectionKey, pageStart,
pageEnd}``: propositions in a new ``propositions`` collection, content edges with
``sectionKeys[]``/page provenance. Structural (``has_subsection``) and ``section_mentions``
edges are produced here too (they used to come from the frontend).

The parse/normalize/assemble/provenance logic is pure (unit-tested); the Ollama call and
ArangoDB writes are thin wrappers around it.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
from dataclasses import dataclass

from app.arango_content import _clean_heading_markup, fetch_latest_document, is_ancestor_section_key
from app.arango_learn import triple_id
from app.arango_tree import connect_arango, get_toc_tree
from app.llm import ollama_structured_completion

ENTITIES = "entities"
RELATIONSHIPS = "relationships"
PROPOSITIONS = "propositions"
SECTION_CONTENT = "section_content"

HAS_SUBSECTION = "has_subsection"
SECTION_MENTIONS = "section_mentions"
TOC_ROOT = "toc:root"

_NUMERIC = re.compile(r"^\d+(?:\.\d+)*$")
_MIN_SECTION_BODY_CHARS = 80  # skip heading-only / structural blocks with no real content
# Front-matter noise that the splitter mis-detects as a heading (copyright URLs, ISBNs).
_JUNK_HEADING = re.compile(r"(https?://|www\.|isbn|cambridge\.org|\b\d{9,}\b)", re.IGNORECASE)

_DEFAULT_DOMAIN = "a mathematics / causal-inference textbook"

EXTRACTION_SYSTEM_PROMPT = (
    "You are a knowledge extractor for a personal study tool. You are given one section "
    "of {domain}. Extract the *teachable claims* of the section as structured data.\n\n"
    "Extract two things:\n\n"
    "1. PROPOSITIONS — each a single, self-contained statement of one definition, claim, "
    "theorem, property, or relation the section asserts. Each proposition must:\n"
    "   - be understandable on its own, with no \"this\", \"it\", \"the above\", \"we\", "
    "\"the author\", or section/page references;\n"
    "   - name its concepts in full (write \"conditional independence\", not \"it\");\n"
    "   - quote, verbatim, the source sentence or span it came from.\n\n"
    "2. TRIPLES — for each proposition, the normalized subject-predicate-object facts it "
    "encodes. Subjects and objects are canonical concept names (noun phrases, singular); "
    "predicates are short verb phrases (e.g. \"is defined as\", \"implies\", \"is a special "
    "case of\", \"is denoted by\"). A proposition may yield one or several triples.\n\n"
    "Rules:\n"
    "- Cover ONLY the section's substantive content. Skip running heads, page numbers, "
    "figure/table captions with no claim, bibliographic citations, exercise numbering, and "
    "cross-references (\"see Chapter 3\").\n"
    "- Do not invent facts not stated in the text.\n"
    "- Canonicalize: collapse \"Conditional Independence\", \"conditionally independent\", "
    "\"cond. indep.\" to one name \"conditional independence\".\n"
    "- Single-letter variables (X, Y, Z) are kept only when the section defines them; "
    "otherwise prefer the concept they denote.\n"
    "- Return ONLY data conforming to the schema. No commentary."
)

EXTRACTION_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "propositions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "proposition_text": {"type": "string"},
                    "source_sentence": {"type": "string"},
                    "triples": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "subject": {"type": "string"},
                                "predicate": {"type": "string"},
                                "object": {"type": "string"},
                            },
                            "required": ["subject", "predicate", "object"],
                        },
                    },
                },
                "required": ["proposition_text", "source_sentence", "triples"],
            },
        }
    },
    "required": ["propositions"],
}


# --------------------------------------------------------------------------- #
# Dataclasses
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class SectionExtractInput:
    doc_id: str
    section_key: str
    heading: str
    page_start: int | None
    page_end: int | None
    markdown: str


@dataclass(frozen=True)
class ExtractedTriple:
    subject: str
    predicate: str
    object: str


@dataclass(frozen=True)
class ExtractedProposition:
    text: str
    source_sentence: str
    triples: tuple[ExtractedTriple, ...]


@dataclass(frozen=True)
class SectionExtraction:
    doc_id: str
    section_key: str
    page_start: int | None
    page_end: int | None
    propositions: tuple[ExtractedProposition, ...]
    triples: tuple[ExtractedTriple, ...]  # deduped union across this section's propositions


# --------------------------------------------------------------------------- #
# Pure functions (unit-testable; no LLM, no DB)
# --------------------------------------------------------------------------- #

def _domain() -> str:
    return os.environ.get("LEARN_EXTRACT_DOMAIN") or _DEFAULT_DOMAIN


def build_system_prompt() -> str:
    return EXTRACTION_SYSTEM_PROMPT.format(domain=_domain())


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


def normalize_entity(name: object) -> str:
    return _clean_heading_markup(str(name or "")).strip()


def _norm_part(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def normalize_triple(subject: object, predicate: object, object_: object) -> ExtractedTriple | None:
    s, p, o = normalize_entity(subject), _norm_part(predicate), normalize_entity(object_)
    if not s or not p or not o:
        return None
    return ExtractedTriple(subject=s, predicate=p, object=o)


def parse_extraction_response(obj: object) -> list[dict]:
    """Validate the model's structured output into raw proposition dicts (drop malformed)."""
    if not isinstance(obj, dict):
        return []
    props = obj.get("propositions")
    if not isinstance(props, list):
        return []
    out: list[dict] = []
    for p in props:
        if not isinstance(p, dict):
            continue
        text = _norm_part(p.get("proposition_text"))
        if not text:
            continue
        triples: list[ExtractedTriple] = []
        for t in p.get("triples") or []:
            if isinstance(t, dict):
                nt = normalize_triple(t.get("subject"), t.get("predicate"), t.get("object"))
                if nt is not None:
                    triples.append(nt)
        out.append(
            {"text": text, "source_sentence": _norm_part(p.get("source_sentence")), "triples": triples}
        )
    return out


def assemble_section_extraction(inp: SectionExtractInput, raw_props: list[dict]) -> SectionExtraction:
    """Build the section extraction: propositions keep their own triples; the section's
    ``triples`` are the case-insensitive dedupe union, with provenance attached."""
    propositions: list[ExtractedProposition] = []
    seen: dict[tuple[str, str, str], ExtractedTriple] = {}
    for rp in raw_props:
        trips = tuple(rp["triples"])
        propositions.append(
            ExtractedProposition(text=rp["text"], source_sentence=rp["source_sentence"], triples=trips)
        )
        for t in trips:
            key = (t.subject.lower(), t.predicate.lower(), t.object.lower())
            seen.setdefault(key, t)
    return SectionExtraction(
        doc_id=inp.doc_id,
        section_key=inp.section_key,
        page_start=inp.page_start,
        page_end=inp.page_end,
        propositions=tuple(propositions),
        triples=tuple(seen.values()),
    )


def section_mention_entities(extraction: SectionExtraction) -> list[str]:
    """Distinct subject/object names (first-seen order) — the section's mentioned entities."""
    seen: set[str] = set()
    out: list[str] = []
    for t in extraction.triples:
        for name in (t.subject, t.object):
            k = name.lower()
            if k not in seen:
                seen.add(k)
                out.append(name)
    return out


def structural_subsection_triples(section_keys: list[str]) -> list[ExtractedTriple]:
    """Numeric-prefix ``has_subsection`` chain (toc:root→toc:1→toc:1.2→…), deduped.

    Mirrors the frontend ``numberPrefixChainTriples`` so ``get_toc_tree`` still renders.
    """
    seen: set[tuple[str, str]] = set()
    out: list[ExtractedTriple] = []
    for key in section_keys:
        if not key.startswith("toc:"):
            continue
        body = key[4:]
        if not _NUMERIC.match(body):
            continue
        parts = body.split(".")
        prev = TOC_ROOT
        for i in range(len(parts)):
            cur = "toc:" + ".".join(parts[: i + 1])
            pair = (prev, cur)
            if prev != cur and pair not in seen:
                seen.add(pair)
                out.append(ExtractedTriple(subject=prev, predicate=HAS_SUBSECTION, object=cur))
            prev = cur
    return out


def edge_provenance_merge(old: dict, new: dict) -> dict:
    """Merge content-edge provenance (the pure form of the UPSERT clause): union sectionKeys,
    min pageStart, max pageEnd, tolerating nulls."""
    keys = list(dict.fromkeys([*(old.get("sectionKeys") or []), *(new.get("sectionKeys") or [])]))
    starts = [v for v in (old.get("pageStart"), new.get("pageStart")) if v is not None]
    ends = [v for v in (old.get("pageEnd"), new.get("pageEnd")) if v is not None]
    return {
        "sectionKeys": keys,
        "pageStart": min(starts) if starts else None,
        "pageEnd": max(ends) if ends else None,
    }


def section_body_len(markdown: str) -> int:
    """Length of a section block's body (markdown minus its leading heading line)."""
    parts = (markdown or "").split("\n", 1)
    return len(parts[1].strip()) if len(parts) > 1 else 0


# --------------------------------------------------------------------------- #
# Deterministic keys (mirror lib/arangodb.ts importTriples + arango_learn.triple_id)
# --------------------------------------------------------------------------- #

def entity_key(name: str) -> str:
    return hashlib.md5(name.lower().strip().encode()).hexdigest()[:16]


def edge_key(from_key: str, predicate: str, to_key: str) -> str:
    return hashlib.md5(f"{from_key}|{predicate.lower().strip()}|{to_key}".encode()).hexdigest()[:16]


def proposition_key(doc_id: str, section_key: str, text: str) -> str:
    return hashlib.sha256(f"{doc_id}|{section_key}|{text}".encode()).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# ArangoDB write path (python-arango UPSERT, mirrors importTriples semantics)
# --------------------------------------------------------------------------- #

def ensure_kg_collections(db) -> None:
    if not db.has_collection(ENTITIES):
        db.create_collection(ENTITIES)
    if not db.has_collection(RELATIONSHIPS):
        db.create_collection(RELATIONSHIPS, edge=True)
    if not db.has_collection(PROPOSITIONS):
        col = db.create_collection(PROPOSITIONS)
        col.add_persistent_index(fields=["docId"])
        col.add_persistent_index(fields=["sectionKey"])


def upsert_entities(db, names: list[str], doc_id: str, batch: int = 1000) -> None:
    seen: set[str] = set()
    items: list[dict] = []
    for n in names:
        k = entity_key(n)
        if k in seen:
            continue
        seen.add(k)
        items.append({"_key": k, "name": n})
    doc_ids = [doc_id] if doc_id else []
    for i in range(0, len(items), batch):
        db.aql.execute(
            """
            FOR item IN @batch
              UPSERT { _key: item._key }
              INSERT MERGE(item, { docIds: @docIds })
              UPDATE { docIds: UNION_DISTINCT(NOT_NULL(OLD.docIds, []), @docIds) }
              IN entities
            """,
            bind_vars={"batch": items[i : i + batch], "docIds": doc_ids},
        )


def upsert_content_edges(
    db,
    triples: list[ExtractedTriple],
    doc_id: str,
    section_key: str,
    page_start: int | None,
    page_end: int | None,
    batch: int = 1000,
) -> None:
    seen: set[str] = set()
    edges: list[dict] = []
    for t in triples:
        fk, tk = entity_key(t.subject), entity_key(t.object)
        ek = edge_key(fk, t.predicate, tk)
        if ek in seen:
            continue
        seen.add(ek)
        edges.append({"_key": ek, "_from": f"entities/{fk}", "_to": f"entities/{tk}", "type": t.predicate})
    binds = {
        "docIds": [doc_id] if doc_id else [],
        "sectionKeys": [section_key] if section_key else [],
        "pageStart": page_start,
        "pageEnd": page_end,
    }
    for i in range(0, len(edges), batch):
        db.aql.execute(
            """
            FOR item IN @batch
              UPSERT { _key: item._key }
              INSERT MERGE(item, { docIds: @docIds, sectionKeys: @sectionKeys,
                                   pageStart: @pageStart, pageEnd: @pageEnd })
              UPDATE {
                docIds:      UNION_DISTINCT(NOT_NULL(OLD.docIds, []), @docIds),
                sectionKeys: UNION_DISTINCT(NOT_NULL(OLD.sectionKeys, []), @sectionKeys),
                pageStart:   MIN([NOT_NULL(OLD.pageStart, @pageStart), @pageStart]),
                pageEnd:     MAX([NOT_NULL(OLD.pageEnd, @pageEnd), @pageEnd])
              }
              IN relationships
            """,
            bind_vars={**binds, "batch": edges[i : i + batch]},
        )


def upsert_structural_edges(db, triples: list[ExtractedTriple], doc_id: str, batch: int = 1000) -> None:
    """has_subsection / section_mentions edges (docIds provenance only). Ensures endpoints exist."""
    names: set[str] = set()
    for t in triples:
        names.add(t.subject)
        names.add(t.object)
    if names:
        upsert_entities(db, list(names), doc_id, batch)
    seen: set[str] = set()
    edges: list[dict] = []
    for t in triples:
        fk, tk = entity_key(t.subject), entity_key(t.object)
        ek = edge_key(fk, t.predicate, tk)
        if ek in seen:
            continue
        seen.add(ek)
        edges.append({"_key": ek, "_from": f"entities/{fk}", "_to": f"entities/{tk}", "type": t.predicate})
    doc_ids = [doc_id] if doc_id else []
    for i in range(0, len(edges), batch):
        db.aql.execute(
            """
            FOR item IN @batch
              UPSERT { _key: item._key }
              INSERT MERGE(item, { docIds: @docIds })
              UPDATE { docIds: UNION_DISTINCT(NOT_NULL(OLD.docIds, []), @docIds) }
              IN relationships
            """,
            bind_vars={"batch": edges[i : i + batch], "docIds": doc_ids},
        )


def write_propositions(db, extraction: SectionExtraction, batch: int = 500) -> None:
    rows = []
    for p in extraction.propositions:
        tids = [
            triple_id({"subject": t.subject, "predicate": t.predicate, "object": t.object})
            for t in p.triples
        ]
        rows.append(
            {
                "_key": proposition_key(extraction.doc_id, extraction.section_key, p.text),
                "docId": extraction.doc_id,
                "sectionKey": extraction.section_key,
                "pageStart": extraction.page_start,
                "pageEnd": extraction.page_end,
                "text": p.text,
                "sourceSentence": p.source_sentence,
                "tripleIds": tids,
                "createdAt": int(time.time()),
            }
        )
    if rows:
        db.collection(PROPOSITIONS).import_bulk(rows, on_duplicate="replace")


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

_CHAPTER_HEADING = re.compile(r"(?i)^\s*chapter\s+\d+\b")


def _is_chapter_marker(sk: str, heading: str) -> bool:
    return sk.startswith("toc:chapter-") or bool(_CHAPTER_HEADING.match(heading or ""))


def _walk_tree_depths(nodes, depth: int, out: dict[str, int]) -> None:
    for n in nodes or []:
        nid = getattr(n, "id", None)
        if nid:
            out.setdefault(nid, depth)
        _walk_tree_depths(getattr(n, "children", None), depth + 1, out)


def _section_level_fn(db, doc_id: str):
    """Build ``level_of(sectionKey, heading)`` — a 1-based outline level where chapters are
    level 1. Robust across numbering schemes:
      - numeric keys ``toc:1.2`` → numeric depth;
      - ``toc:chapter-*`` keys or "CHAPTER N" headings → level 1;
      - otherwise the node's TOC-tree depth (root=level 1) if known, else a deep leaf level.
    The TOC tree only partially nests slug books, so the chapter-marker signal is what makes a
    chapter scope expand to the whole chapter."""
    tree_depth: dict[str, int] = {}
    try:
        forest = get_toc_tree(doc_id)[0]
        _walk_tree_depths(forest, 0, tree_depth)
    except Exception:  # noqa: BLE001 — tree is a best-effort signal; markers carry the rest
        tree_depth = {}

    def level_of(sk: str, heading: str = "") -> int:
        body = sk[4:] if sk.startswith("toc:") else sk
        if _NUMERIC.match(body):
            return body.count(".") + 1
        if _is_chapter_marker(sk, heading):
            return 1
        d = tree_depth.get(sk)
        if d is not None:
            return d + 1
        return 99

    return level_of


def _blocks_in_scope(rows: list[dict], scope: str, level_of=None) -> list[dict]:
    """All section_content rows under a chapter/section ``scope``, by reading-order span:
    from the scope's first block to the next block at the SAME-OR-SHALLOWER outline level.

    Captures the scope's subsections AND interspersed slug blocks (theorems, definitions,
    untitled prose) that a pure numeric-descendant match would miss — and works for books
    keyed by chapter slugs, not just ``toc:1.2`` numbering.
    """
    ordered = sorted(rows, key=lambda r: r.get("order", 0))
    start_idx = next(
        (i for i, r in enumerate(ordered) if is_ancestor_section_key(scope, r.get("sectionKey", ""))),
        None,
    )
    if start_idx is None:
        return []
    if level_of is None:
        level_of = lambda sk, h="": (sk[4:].count(".") + 1) if (sk.startswith("toc:") and _NUMERIC.match(sk[4:])) else 99  # noqa: E731
    scope_lvl = level_of(scope, ordered[start_idx].get("heading", ""))
    # A block sitting right after a chapter marker is the chapter title → treat it as a chapter.
    if start_idx > 0:
        prev = ordered[start_idx - 1]
        if _is_chapter_marker(prev.get("sectionKey", ""), prev.get("heading", "")):
            scope_lvl = min(scope_lvl, 1)
    end_idx = len(ordered)
    for j in range(start_idx + 1, len(ordered)):
        r = ordered[j]
        sk = r.get("sectionKey", "")
        if sk == scope or is_ancestor_section_key(scope, sk):
            continue
        if level_of(sk, r.get("heading", "")) <= scope_lvl:
            end_idx = j
            break
    return ordered[start_idx:end_idx]


def _scope_keys_from_outline(db, doc_id: str, scope: str) -> set[str] | None:
    """Section keys under ``scope`` via the outline's ``listDepth`` nesting — ``scope`` plus
    everything nested beneath it until a same-or-shallower (sibling) entry. Key-scheme-agnostic:
    works when a numbered chapter (``toc:2``) contains slug sub-sections (``toc:modeling``) that
    aren't numeric descendants of the chapter. Returns None if ``scope`` isn't an outline entry
    (caller falls back to the reading-order span)."""
    try:
        rows = list(
            db.aql.execute(
                "FOR d IN documents FILTER d._key == @doc RETURN d.outline", bind_vars={"doc": doc_id}
            )
        )
    except Exception:  # noqa: BLE001
        return None
    outline = rows[0] if rows else None
    if not outline:
        return None
    idx = next((i for i, e in enumerate(outline) if e.get("sectionKey") == scope), None)
    if idx is None:
        return None
    base = int(outline[idx].get("listDepth") or 0)
    keys = {scope}
    for e in outline[idx + 1 :]:
        if int(e.get("listDepth") or 0) <= base:
            break
        if e.get("sectionKey"):
            keys.add(e["sectionKey"])
    return keys


def _load_section_blocks(
    db, doc_id: str, section_keys: list[str] | None = None, scope: str | None = None
) -> list[SectionExtractInput]:
    rows = list(
        db.aql.execute(
            "FOR b IN section_content FILTER b.docId == @d SORT b.order RETURN b",
            bind_vars={"d": doc_id},
        )
    )
    if scope:
        okeys = _scope_keys_from_outline(db, doc_id, scope)
        if okeys is not None:
            rows = [r for r in rows if r.get("sectionKey") in okeys]
        else:
            rows = _blocks_in_scope(rows, scope, _section_level_fn(db, doc_id))
    wanted = set(section_keys) if section_keys else None
    out: list[SectionExtractInput] = []
    for r in rows:
        sk = r.get("sectionKey")
        if wanted is not None and sk not in wanted:
            continue
        md = r.get("markdown") or ""
        if section_body_len(md) < _MIN_SECTION_BODY_CHARS:
            continue
        if _JUNK_HEADING.search(r.get("heading") or ""):
            continue
        out.append(
            SectionExtractInput(
                doc_id=doc_id,
                section_key=sk,
                heading=r.get("heading") or sk,
                page_start=r.get("pageStart"),
                page_end=r.get("pageEnd"),
                markdown=md,
            )
        )
    return out


def _extract_model() -> str | None:
    """Optional extraction-specific model (``LEARN_EXTRACT_MODEL``); else the default
    ``OLLAMA_MODEL`` is used. Lets the batch pick a faster/better model than the Socratic one."""
    return os.environ.get("LEARN_EXTRACT_MODEL") or None


def _extract_one_section(inp: SectionExtractInput, retries: int = 2) -> tuple[SectionExtraction | None, str | None]:
    messages = [
        {"role": "system", "content": build_system_prompt()},
        {"role": "user", "content": build_user_prompt(inp)},
    ]
    last_err: str | None = None
    for _ in range(retries + 1):
        obj, err = ollama_structured_completion(
            messages, EXTRACTION_JSON_SCHEMA, temperature=0.2, model=_extract_model()
        )
        if obj is not None:
            return assemble_section_extraction(inp, parse_extraction_response(obj)), None
        last_err = err
    return None, last_err


async def extract_document(
    doc_id: str | None = None,
    section_keys: list[str] | None = None,
    scope: str | None = None,
    concurrency: int = 3,
) -> dict:
    """Extract propositions + triples for a document into the KG.

    ``scope`` (e.g. ``toc:1``) extracts one chapter/section and everything under it —
    the intended "one chapter at a time" batch. ``section_keys`` extracts an exact set.
    Neither → the whole document. Bounded concurrency (Ollama is the bottleneck); a
    failed section is isolated and recorded in ``errors[]``.
    """
    t0 = time.time()
    db = connect_arango()
    if doc_id is None:
        doc = (fetch_latest_document() or {}).get("document")
        doc_id = doc.get("id") if doc else None
    if not doc_id:
        return {"error": "no document found"}

    ensure_kg_collections(db)
    sections = _load_section_blocks(db, doc_id, section_keys=section_keys, scope=scope)
    if not sections:
        return {"docId": doc_id, "sections": 0, "propositions": 0, "triples": 0, "errors": ["no sections with content"]}

    sem = asyncio.Semaphore(max(1, concurrency))
    extractions: list[SectionExtraction] = []
    errors: list[str] = []

    async def run(inp: SectionExtractInput) -> None:
        async with sem:
            ext, err = await asyncio.to_thread(_extract_one_section, inp)
            if err:
                errors.append(f"{inp.section_key}: {err}")
            elif ext is not None:
                extractions.append(ext)

    await asyncio.gather(*(run(s) for s in sections))

    total_props = 0
    total_triples = 0
    for ext in extractions:
        mentions = section_mention_entities(ext)
        upsert_entities(db, mentions, doc_id)
        upsert_content_edges(db, list(ext.triples), doc_id, ext.section_key, ext.page_start, ext.page_end)
        mention_edges = [
            ExtractedTriple(subject=ext.section_key, predicate=SECTION_MENTIONS, object=e) for e in mentions
        ]
        upsert_structural_edges(db, mention_edges, doc_id)
        write_propositions(db, ext)
        total_props += len(ext.propositions)
        total_triples += len(ext.triples)

    # Document-wide has_subsection hierarchy (once, from every section key).
    upsert_structural_edges(db, structural_subsection_triples([s.section_key for s in sections]), doc_id)

    return {
        "docId": doc_id,
        "scope": scope,
        "sections": len(sections),
        "extracted": len(extractions),
        "propositions": total_props,
        "triples": total_triples,
        "seconds": round(time.time() - t0, 1),
        "errors": errors,
    }


# --------------------------------------------------------------------------- #
# Background jobs (extraction is 15-20 min — never block the HTTP request)
# --------------------------------------------------------------------------- #

_JOBS: dict[str, dict] = {}


def _job_key(doc_id: str, scope: str | None) -> str:
    return f"{doc_id}:{scope or 'ALL'}"


def _resolve_doc_id(doc_id: str | None) -> str | None:
    if doc_id:
        return doc_id
    doc = (fetch_latest_document() or {}).get("document")
    return doc.get("id") if doc else None


async def _run_job(
    key: str,
    doc_id: str,
    scope: str | None,
    concurrency: int,
    section_keys: list[str] | None,
    model: str | None = None,
) -> None:
    try:
        # Concept-course extraction is the product now (lazy import avoids a cycle).
        from app.concepts_extract import extract_concepts_document

        def on_progress(done: int, total: int, current: str | None) -> None:
            job = _JOBS.get(key)
            if job and job.get("status") == "running":
                job["progress"] = {"done": done, "total": total, "current": current}

        summary = await extract_concepts_document(
            doc_id=doc_id, section_keys=section_keys, scope=scope, concurrency=concurrency,
            model=model, on_progress=on_progress,
        )
        # Best-effort: refresh the semantic-search index so ask_textbook / semantic-search cover
        # the freshly-processed content. Never fail the extraction over indexing.
        try:
            import asyncio as _asyncio

            from app.arango_tree import connect_arango
            from app.semantic_search import ensure_index

            await _asyncio.to_thread(lambda: ensure_index(connect_arango(), doc_id))
        except Exception:  # noqa: BLE001
            pass
        _JOBS[key] = {"status": "done", "scope": scope, "docId": doc_id, "summary": summary}
    except Exception as exc:  # noqa: BLE001 — surface in status, never crash the loop
        _JOBS[key] = {"status": "error", "scope": scope, "docId": doc_id, "error": str(exc)}


def start_extraction(
    doc_id: str | None,
    scope: str | None,
    concurrency: int = 3,
    section_keys: list[str] | None = None,
    model: str | None = None,
) -> dict:
    """Kick off concept extraction as a background task and return immediately. Idempotent
    while a job for the same (doc, scope) slot is already running.

    ``section_keys`` extracts an exact set of sections (the TOC-preview selection); it is
    keyed under the ``scope`` slot, so the "Process documents" flow passes ``scope=None``
    (the per-document slot) while the syllabus tree uses ``scope=toc:N`` per chapter."""
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "error", "error": "no document found"}
    key = _job_key(doc_id, scope)
    current = _JOBS.get(key)
    if current and current.get("status") == "running":
        return {"status": "running", "scope": scope, "docId": doc_id, "alreadyRunning": True}
    _JOBS[key] = {"status": "running", "scope": scope, "docId": doc_id}
    asyncio.create_task(_run_job(key, doc_id, scope, concurrency, section_keys, model))
    return {"status": "running", "scope": scope, "docId": doc_id}


def extraction_status(doc_id: str | None, scope: str | None) -> dict:
    doc_id = _resolve_doc_id(doc_id)
    if not doc_id:
        return {"status": "idle", "scope": scope}
    return _JOBS.get(_job_key(doc_id, scope), {"status": "idle", "scope": scope, "docId": doc_id})


def fetch_section_propositions(section_key: str, doc_id: str | None = None) -> dict:
    """Stored propositions for a section (drill-down + verification)."""
    try:
        db = connect_arango()
        if not db.has_collection(PROPOSITIONS):
            return {"sectionKey": section_key, "propositions": []}
        if doc_id is None:
            doc = (fetch_latest_document() or {}).get("document")
            doc_id = doc.get("id") if doc else None
        if not doc_id:
            return {"sectionKey": section_key, "propositions": []}
        rows = list(
            db.aql.execute(
                "FOR p IN propositions FILTER p.docId == @d AND p.sectionKey == @s "
                "RETURN { text: p.text, sourceSentence: p.sourceSentence, "
                "pageStart: p.pageStart, pageEnd: p.pageEnd, tripleIds: p.tripleIds }",
                bind_vars={"d": doc_id, "s": section_key},
            )
        )
        return {"sectionKey": section_key, "docId": doc_id, "propositions": rows}
    except Exception as exc:
        return {"sectionKey": section_key, "propositions": [], "error": str(exc)}
