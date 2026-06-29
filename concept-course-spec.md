# Concept-Course processing — spec

Status: draft for review · Date: 2026-06-17
Replaces: the triple-extraction pipeline (old client-side path + the recent server-side
triple/proposition extraction as a *product*).

## Goal & decisions

Processing's product is a **self-study course**, not a knowledge graph. The unit is an
**atomic Concept** (one definition / theorem / principle / result). Each concept is a
lesson carrying four parts:

- **signal** — a distilled, self-contained explanation (what you need to know);
- **source** — the verbatim passage it came from (the "expand context" / T_noise);
- **questions** — 1-3 retrieval-practice Q&A to test it;
- **prereqs** — the concepts you should learn first.

Locked decisions:
- Concept grain = **atomic** (per named definition/theorem/result).
- Graph kept = **concept → prerequisite only** (drives the learning path). **No SPO triple
  graph as a product.**
- Study modes (deck, quiz, mastery) **replace**: they re-point to concepts + their questions.
  Socratic grounds on a concept's `source`.

## Data model (ArangoDB)

New `concepts` (document collection):
```jsonc
{
  "_key": "<sha256(docId|sectionKey|name)[:16]>",   // deterministic → idempotent re-extract
  "docId": "...", "sectionKey": "toc:1.2.3",
  "pageStart": 41, "pageEnd": 53,
  "name": "d-separation",
  "kind": "definition | theorem | principle | result | method",
  "signal": "A set Z d-separates X from Y when Z blocks every path between them…",
  "source": "Definition 1.2.3 (d-Separation). A path p is said to be blocked by …",
  "questions": [ { "q": "When does a set Z d-separate X and Y?", "a": "When Z blocks every path…" } ],
  "prereqNames": ["path", "collider", "conditional independence"],  // raw LLM names (pre-resolution)
  "order": 12, "createdAt": 0
}
```
New `concept_prereq` (edge): `{ _from: concepts/A, _to: concepts/B, type: "prerequisite" }`
(A requires B). Built by resolving `prereqNames` to concept `_key`s within the document
(match on normalized `name`; unresolved names are dropped, not invented).

Dropped as a product: writing `entities`/`relationships` triple soup. (Collections can stay
for now; extraction simply stops populating them. `has_subsection` for the TOC tree is kept —
it's structural, cheap, already server-owned.)

Mastery: `study_events` gains `concept_key`; mastery computed **per concept** (coverage =
concepts answered / concepts in section; accuracy = Beta posterior over a concept's question
answers; decay unchanged). Section/chapter mastery = rollup over its concepts.

## Extraction (pivot `app/extract.py`)

Reuse wholesale: chapter-scope (`_blocks_in_scope`), Ollama **structured output**
(`ollama_structured_completion`), background jobs (`start_extraction`/`extraction_status`),
provenance plumbing, the bounded orchestrator, the deterministic-key + write-path patterns.

Change: the **schema + prompt + write target**. Per section the model returns
```jsonc
{ "concepts": [ {
    "name": "...", "kind": "...",
    "signal": "...", "source_sentence": "...",
    "questions": [ {"q": "...", "a": "..."} ],
    "prerequisites": ["concept name", ...]
} ] }
```
Prompt: "From this section, extract each atomic concept it *teaches* (a definition, theorem,
principle, result, or method). For each: a short canonical name; its kind; a self-contained
distilled explanation (no deixis, full concept names); the verbatim source sentence; 1-3
questions that test understanding; and the names of concepts a learner must already know.
Skip narrative, citations, page furniture." Same no-deixis / canonicalization rules as today.

Write: `concepts` rows (deterministic key) + resolve `prerequisites` → `concept_prereq`
edges (second pass, after all of a doc's concepts exist). Keep `has_subsection`.

Endpoints stay (`POST /api/extract?scope=`, status) but now build **lessons**, not triples.
The per-chapter "Extract" button becomes "Build this chapter's lessons."

## Study rewire (replace triple-based study)

- `arango_learn.py` deck/quiz triple queries → **concept queries** (`concepts_for_section`).
- `quiz_gen.py`: build MCQs from `concept.questions` (correct answer = `a`; distractors from
  *other concepts'* answers in the section — KGGDG-style plausible-but-wrong). Keep the
  deterministic + optional-LLM split.
- `mastery.py`: per-concept coverage×accuracy×decay; `content_triples_for_section` denominator
  → `concepts_for_section`.
- Flashcards: front = concept name / a question; back = `signal` (+ "expand" → `source`).
- Socratic: context = the section's concept `signal`+`source` instead of triples.
- New read endpoints: `GET /api/section/{key}/concepts`, `GET /api/concept/{key}`,
  `GET /api/path?doc=` (prereq-ordered learning path).

## Frontend

- **Delete** the old client extraction entirely: `processDocumentsImpl` extraction half,
  `utils/toc-processing.ts` extraction, `/api/extract-triples`, `lib/arangodb.ts importTriples`
  use for PDFs, the LangChain path, the prompt-config UI, the triple-viewer-as-product.
- Learn tab becomes the course: chapter → **concept lessons** (signal, expand→source,
  questions inline) ordered by prereqs; the syllabus tree shows per-concept mastery; the
  "Extract" button reads "Build lessons." Quiz/flashcards pull from concepts.
- "Process Documents" tab → removed (convert stays on Upload; "build lessons" lives in Learn).

## Phasing (incremental, each verifies on one chapter)

1. **Concept extraction + storage** — pivot `extract.py` schema/prompt/write to `concepts` +
   `concept_prereq`; `GET /api/section/{key}/concepts`. Verify a chapter: concepts have
   signal/source/questions/prereqs + provenance; prereq edges resolve.
2. **Study rewire** — deck/quiz/mastery/Socratic → concepts; new read endpoints. Verify a
   quiz from concept questions records mastery.
3. **Frontend course** — lessons UI + study-from-concepts; delete the old client path & Process tab.
4. **Cleanup/migration** — stop writing triples; optionally drop the old noisy `entities`/
   `relationships` for re-built docs.

## Reuse / delete summary
- Reuse: `extract.py` engine, `ollama_structured_completion`, page/section provenance,
  background jobs, `mastery.py` math shape, `quiz_gen.py` MCQ assembly, Socratic plumbing.
- Delete: client extraction, `/api/extract-triples`, `toc-processing.ts` extraction,
  `importTriples` (PDF path), LangChain, prompt-config UI, triple-as-product.

## Open questions
- Prereq resolution across documents (cross-book concepts) — defer to the later concept-
  resolution layer (`concept-layer-spec.md`); v1 resolves within a document only.
- Same concept taught in multiple sections → keep distinct rows (provenance) or merge? v1: keep
  distinct (deterministic key includes sectionKey); merge later at the resolution layer.
