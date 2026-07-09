# Deep Chapter — Design Spec (v1, implemented)

> Status: **IMPLEMENTED 2026-07-01** on `feat/deep-chapter` (backend:
> `app/deep_chapter.py` + `/api/deep-chapter`; frontend:
> `components/learn/deep-chapter.tsx`, "Deep read" on the course home).
> Open decisions resolved: (1) briefing = **assemble** (no LLM fuse — can be
> upgraded later), (2) rollout = **parallel view** (existing modes untouched;
> retire-the-mode-flow is future work), (3) coordination moot — the langchain
> work had already landed as an ancestor of the integration branch.

## 0. Objective (locked)

Replace the current scattered, on-demand study panels with a single
**reading-first "Deep Chapter" surface**, and **eagerly pre-generate** its content
at document-processing time so opening a chapter is instant and rich.

Locked decisions:
- **Primary problem is flow/clunk.** Favor ONE calm, continuous surface with
  minimal panel-switching over adding features.
- **Pre-generation is EAGER**, at document/chapter-processing time, as a
  **non-destructive, idempotent** ArangoDB overlay. Frontend renders what's stored.
- **Keyless/local** (Ollama + sentence-transformers); batching honors
  `OLLAMA_NUM_PARALLEL=4`; resumable so re-processing never duplicates.

## 1. Key finding that reshaped the plan

The frontend and generated content are **far more mature than a greenfield read**.
The Learn UI already has ~9 study modes and much of the "content to pre-generate"
already exists:
- Briefing pieces: `chapter_orient` (objectives + watch-fors), `chapter_skeletons`
  (essences), `section_augment` (objectives + recap) — already generated/cached.
- Per-concept material: `concepts` carry `signal`, `source`, `questions[]`, plus
  author+critic `quizQuestions[]`.
- Inline intelligence substrate: the `ask` / `semantic-search` layer exists; the
  GuidedReader already injects "focus moments" + "check yourself."

**Therefore the work is ~70% consolidation, ~30% net-new generation.** The real
pain (user's words: "it's a front-end issue… clunky") is that the 9 modes render
as conditional components in one scroll area, **remounting on every switch**, and
the **reader is trapped in one mode** so you can't reference the text while
studying.

## 2. Current-state map (what to reuse)

### Backend (`assets/deploy/services/learn/app/`)
- Ingest → concepts: `extract_routes.py` → `extract.py::start_extraction` /
  `_run_job` → `concepts_extract.py::extract_concepts_document` (bounded via
  `asyncio.Semaphore(concurrency)`).
- **Hook point (confirmed):** in `extract_concepts_document`, AFTER
  `upsert_structural_edges(...)` (~line 458) and BEFORE the return.
- LLM client: `llm.py::ollama_structured_completion(messages, schema, temperature,
  model, timeout) -> (dict|None, err)` and `ollama_chat_completion(...)`.
  Default `OLLAMA_MODEL=llama3.1:8b`; per-purpose overrides
  (`LEARN_EXTRACT_MODEL`, `LEARN_QUIZ_AUTHOR_MODEL`, `LEARN_AUGMENT_MODEL`).
- Existing generation patterns to mirror: `augment.py` (objectives+recap, cached in
  `section_augment`), `skeleton.py` (essences → `chapter_skeletons`; objectives →
  `chapter_orient`), `concept_quiz_llm.py` (author+critic MCQs cached on concepts).
- Semantic search / ask: `semantic_search.py`, `search_routes.py`,
  `lc_embeddings.py`, `lc_vectorstore.py`. Vectors in `content_vectors` (ArangoDB,
  MiniLM 384-d via `sentence-transformers`), brute-force cosine in numpy, grounded
  answer via LangChain LCEL → ChatOllama with `[n]` citations. `ensure_index()` is
  idempotent and already auto-runs after extraction.
- Typed elements: `elements` collection (figure/table/equation/code, page + bbox +
  sectionKey), toggled by `LEARN_EXTRACT_ELEMENTS`.

### Frontend (`assets/frontend/`)
- Router: `components/tabs/LearnTab.tsx` (views: shelf|home|lesson|read|concepts|
  drill|dump|ask). Study surface: `components/learn/lesson-view.tsx` (9 conditional
  modes). Readers: `guided-reader.tsx`, `chapter-reader.tsx`, `book-reader.tsx`,
  `markdown-reader.tsx` (react-markdown + gfm + math + katex + highlight).
- Ask UI: `components/learn/ask-panel.tsx` (Ask ↔ Search); client helpers in
  `lib/learn-service.ts` (`askTextbook`, `semanticSearch`, `fetchSearchIndexStatus`,
  `buildSearchIndex`). Proxies under `app/api/learn/*`.
- **Clunk source:** modes are keyed conditional components → unmount/remount on
  switch; reader isolated to Read mode; scroll resets; find/scroll-spy tears down.

## 3. Target architecture — the Deep Chapter surface

One persistent chapter container, reading-first:
- **Reader is the spine** (reuse MarkdownReader/ChapterReader) — never unmounts.
- **Briefing on entry** — synthesized "what this teaches + how concepts connect,"
  from existing orient/skeleton/augment + concepts (optionally one light LLM fuse).
- **Inline concepts** — concept mentions in prose become live (hover/click →
  `signal` + `deepExplanation` + prereqs + a quick check from existing `questions[]`).
- **Select → "explain this"** — reuse `ask`/`semantic-search` as a hook.
- **Progressive zoom + study actions in-place** — quiz/exam/review become
  **drawers over the same surface**, not full-screen remounting modes. Reuse the
  existing panels' logic; change only their framing.

## 4. Backend — overlay data model + generation

New batched pass `generate_deep_chapter_artifacts(db, doc_id, scope, section_keys,
model, concurrency)` inserted at the hook point above. Reuses
`asyncio.Semaphore(concurrency)` + `ollama_structured_completion`; error-isolated
per item.

Non-destructive, idempotent artifacts:
- **`deep_chapter_briefing`** (new collection): `_key = sha256(docId|scope)[:16]`;
  fuse orient+skeleton+augment+top-concepts into cohesive prose. UPSERT / replace.
- **`concepts.deepExplanation`** (extend existing concept doc): 1–2 paragraph
  expansion from `signal`+`source`+prereqs. Idempotent on concept `_key`.
- **Quick checks: reuse existing `concepts.questions[]` / `quizQuestions[]`** — do
  NOT regenerate.
- Also flip existing augment/skeleton/`ensure_index` from lazy/on-view to **eager**
  within this same post-extraction pass, so "ready on open" holds.

Idempotency mirrors existing pipeline: REMOVE-per-scope + replace; safe re-process.

## 5. API — one thin assembler endpoint

`GET /api/learn/deep-chapter?doc=&scope=` → assembles `{briefing, sections:
[{content, concepts:[{...signal, deepExplanation, checks}], elements}]}` in a
single call (fewer round-trips = part of the de-clunk). Reuse existing
section/content, section/concepts, semantic-search, ask, review/queue as-is.

## 6. Frontend — Deep Chapter component

New `components/learn/deep-chapter.tsx` surface (initially a new view in LearnTab):
- Reader spine (reuse MarkdownReader render path).
- Inline concept spans: match concept names in prose → popover (signal +
  deepExplanation + prereqs + a quick check).
- Text selection → explain: `window.getSelection()` → `askTextbook`/`semanticSearch`
  (extract ask-panel logic into a shared hook).
- Progressive zoom via in-place expanders (no route changes).
- Quiz/exam/review folded in as in-place drawers; retire the mode-switch flow last.
- Single `deep-chapter` fetch → no per-mode reload thrash.

## 7. Explicitly NOT changing

PDF→markdown conversion (`reader.py`/Docling); concept-extraction logic itself; the
semantic-search backend (reuse as-is); nothing revives the deleted graph/triple viz;
existing panels' logic is refactored into embedded pieces, not rewritten.

## 8. Build order (incremental, explain-every-diff)

1. Backend: `deep_chapter_briefing` + `concepts.deepExplanation` in the
   post-extraction hook; make augment/skeleton/index eager.
2. Backend: `/api/learn/deep-chapter` assembler endpoint.
3. Frontend: Deep Chapter surface — reader spine + briefing + inline concept
   popovers (read + shallow depth).
4. Frontend: select→explain (reuse ask) + progressive zoom + embedded quick-checks.
5. Frontend: fold quiz/exam/review in as drawers; retire the mode-switch flow.
6. Verify keyless/local end-to-end; re-run census.

## 9. Verification

A processed chapter → artifacts persisted in `deep_chapter_briefing` /
`concepts.deepExplanation` → the surface renders with **no visible generation
wait**; a session flows on one surface with few/no panel switches; any concept goes
shallow→deep in place. Verify no cloud/API-key dependency introduced.

## 10. OPEN DECISIONS (blockers — owner must resolve)

1. **Briefing:** *assemble* from existing orient/skeleton/augment (no new
   generation, cheapest) — or *fuse* with one new LLM pass (more cohesive)?
2. **Rollout:** build Deep Chapter as a **new parallel view first** (safe,
   side-by-side compare) — or **replace** the lesson-view mode-flow outright?
3. **Coordination:** `feat/learn-hub-langchain` is being actively edited by a
   parallel session; this feature lives in those exact files. Wait for it to
   settle/merge, or branch off a specific base commit? (Guardrail: rebase onto it,
   do not conflict.)
