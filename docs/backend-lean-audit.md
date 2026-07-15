<!-- Produced 2026-07-15 by a 65-agent audit workflow (13 analyzers: one per package +
dependency/duplication/API-surface lenses; every removal claim adversarially verified against
all consumer surfaces; 89 findings survived, 1 refuted). Plan only — nothing here is applied yet. -->

# Learn Hub Backend — Reorganization Plan

## 1. State of the backend

The July refactor worked: the declared layering (`platform <- content <- domains <- {overview, pipeline} <- api`) has **zero upward violations**, most modules are genuinely deep, and the pure helpers are unit-tested. What remains is scar tissue from two pivots (Arango→Postgres, triple-KG→concepts): dead surfaces nothing calls (~600 lines), the same 4-line "latest document" resolver written ~12 times, and scope resolution — the single most load-bearing concept in the app — living as a kit of underscore-private functions that six call sites reassemble by hand, with one (`overview/coverage.py`) silently diverging. There are also four **real bugs** hiding behind blanket `except` clauses. Total realistic reduction: **~1,000 lines (~10% of the backend)** while making every concern single-owner.

---

## 2. Quick wins

### 2a. Fix first — these are broken *today* (small diffs, real bugs)

| Fix | Files | Why it matters |
|---|---|---|
| Add `from psycopg.types.json import Json` to reviews.py | `backend/app/study/reviews.py:55` | Every skeleton grade with a children snapshot 500s with `NameError`, swallowed by the blanket `except` at :407. One import line. |
| Fix the typed-rows SELECT to match the card builders | `backend/app/study/reviews.py:234-240` | `skeleton_card`/`figure_card` still read the Arango row shape (`_key`, `docId`, `children`, `figureOrder`) that the Postgres query never returns — due skeleton cards serve `conceptKey=None` and empty structure. Update `test_skeleton_reviews.py` fixtures too (they currently fixture the *old* shape, which is why this passed). |
| Stop the unconditional skeleton re-enqueue | `backend/app/extraction/skeleton.py:216-219` | `fetch_skeleton` hardcodes `stale=True` and enqueues a **full LLM regeneration on every page open**. Either store `SKELETON_PROMPT_VERSION` on the row and compare, or delete the constant and the enqueue-on-hit. |
| Let empty Docling output take the pymupdf fallback | `backend/app/ingestion/reader.py:408-421` | The empty-markdown check raises `PdfConvertError` which the `except PdfConvertError: raise` re-raises — bypassing the documented fallback and turning a friendly 400 into a raw 500 for scanned PDFs. |
| Fix or delete the broken tree-depth branch in scope | `backend/app/content/scope.py:39-44` | `getattr(n, "id")` on plain dicts is always `None`, so `tree_depth` is permanently empty and the docstring lies. Fix to `.get()` (2 lines) *or* delete the plumbing — the system has demonstrably run without it. Add a test either way. |

### 2b. Safe deletions (verified zero callers on every surface: backend, mcp/, frontend proxies, tests)

| Deletion | Files | Est. LOC |
|---|---|---|
| `seedling_client.py` + its test + `VAULTWRITER_URL` env line | `platform/seedling_client.py`, `tests/test_seedling_client.py`, `deploy/compose/docker-compose.yml:74-78` | −121 |
| LangChain wrapper layer: `lc_vectorstore.py` + `lc_embeddings.py`. `ask()` never uses the retriever — it duplicates `semantic_search()`'s SQL byte-for-byte. Extract one `_top_matches()` helper in `semantic_search.py`, keep the prompt-chain, fix the lying docstring. Preserve the graceful `embedder unavailable` path and citation numbering. | `search/lc_vectorstore.py`, `search/lc_embeddings.py`, `search/semantic_search.py` | −110 |
| Three dead routes + orphaned helpers: `/api/lifecycle`, `/api/page/{page_no}`, `/api/convert-pdf/health` → strands `document_state` (lifecycle.py), `fetch_page` (store.py), `pdf_convert_health` (pdf_convert.py + pipeline re-export). Also drop the redundant `PageBlock.section_keys` column (byte-copy of `section_path`). | `api/build_routes.py:26`, `main.py:154`, `api/ingest_routes.py:27`, `pipeline/lifecycle.py`, `content/store.py`, `ingestion/pdf_convert.py` | −110 |
| Retired canonical-dedup machinery: `fetch_document_concepts` groups against a hardcoded `NULL AS canon` — every group is a singleton. Flatten to a straight SELECT (keep `conceptKey`, MCP depends on it); drop `canonicalConcepts`/`mergedConcepts` from the summary. | `extraction/concept_store.py:145-196`, `extraction/concepts_extract.py:447-448` | −35 |
| Dead `prepare_guides` + the un-ledgered daemon-thread authoring path; replace the lazy backfill with `enqueue_build(kind='guides')` (the `_enqueue_refresh` pattern in skeleton.py). Guard the backfill enqueue (only when authored < total) and re-derive `guide_status.running` from the ledger. | `extraction/reading_guide.py:45-47, 127-167` | −40 |
| Finish the deepExplanation/'explained' retirement (backend + frontend in one change): drop the `deepExplanation=None` injection, the `explained` mirrors in `deep_status` and coverage/plan, the tautological frontend checks, and the type fields. | `extraction/deep_chapter.py:176-205`, `overview/coverage.py:58-60`, `overview/plan.py:128`, `frontend/features/learn/components/reader/deep-chapter.tsx`, `.../api/chapter.ts`, `pipeline.ts` | −25 |
| Dead LLM helper `ollama_chat_completion` + the unreachable assistant-role branch; update the stale "Socratic" docstring | `platform/llm.py:96-114` | −22 |
| Arango table-name constants + unused imports across extraction and overview (8 constants, `Json`/`time` imports, `SKELETON_PROMPT_VERSION` if the fix above deletes it) | `extraction/{skeleton,deep_chapter,reading_guide,augment,concept_store}.py`, `overview/coverage.py:18-23` | −20 |
| Triple-KG vestiges in study: dead `EVENTS_COLLECTION`/`GRADED_KINDS`/`CONCEPTS`/`REVIEWS` constants, the always-`None` `tid` param on `record_quiz_event` (6 call sites), `triple_id` select/insert, `id_field` default | `study/mastery.py`, `reviews.py`, `cards.py`, `exam.py`, `drill.py`, `quiz_session.py` + `test_mastery.py` fixtures | −20 |
| Legacy `/v1` suffix on `OLLAMA_BASE_URL`: redefine as native root in compose, collapse `_ollama_base`/`_ollama_native_base` into one **public** `ollama_base_url()` (keep one defensive strip — stale `.env.local` values exist), delete tts_orpheus's duplicate strip | `platform/llm.py:28-39`, `media/tts_orpheus.py:33-37`, `deploy/compose/docker-compose.yml:24,60` | −18 |
| Dead "reserved" data fields: `elements.embedding` (always NULL, search shipped on `content_vectors`), `Element.text`, `ConvertResult.markdown` (caller re-reads from documents), ledger-side `hasPageProvenance` (second, weaker definition of the store's flag — keep only `outputFilename/pageCount/docId`, which the frontend reads) | `content/elements.py:114`, `content/store.py`, `ingestion/reader.py:73`, `ingestion/pdf_convert.py:59,127` | −15 |
| `pipeline/ingest.py` re-export shim: have `ingest_routes.py` import `find_existing_ingest`/`converter_health` from their owners; hoist the needless lazy `lifecycle` import; delete `pdf_convert_health` pass-through; while there, move `find_existing_ingest` into `content/documents.py` (it's a documents-table read) and log its swallowed exception | `pipeline/ingest.py`, `api/ingest_routes.py`, `ingestion/pdf_convert.py:40-54` | −10 |
| Vestigial `db` first param on every job runner (always `None`; in audiobook.py it even shadows the real `db` import — a live footgun). New contract: `runner(job, ctx)`. | `platform/jobs.py:384`, `pipeline/{registry,ingest,build}.py`, `media/audiobook.py` | −8 |
| KG/Arango prose + wire vocabulary: rename `edgeCount`→`sectionCount`, delete `mentionEdgeCount` (4 frontend touchpoints: `outline.ts`, `use-course-data.ts`, `courses/[courseId]/page.tsx`, `course-home.tsx` — TS will catch them); fix the "ArangoDB" comments in `main.py:49` and `mcp/server.py:6,11` + `mcp/README.md`; delete dead `TOC_ROOT_KEY` and the unreachable `'/'`-path ancestor branch | `main.py`, `content/sections.py:14`, `content/scope.py:32`, frontend files above | −18 |
| Dead frontend proxy `frontend/app/api/learn/audiobook/list/route.ts` (backend endpoint stays for MCP) | frontend | −8 |
| Estimated-timeline compat shim: 8 pre-sidecar MP3s remain on disk — regenerate them, then delete the `exact:false` branch, `estimate_weights`, its test, and the frontend weight-scaling mode. If deferring: derive `gap_sec` from `_GAP` so estimates can't drift. | `media/audiobook.py:285-289, 526-563`, `tests/test_audiobook.py`, `frontend/.../audiobook.ts` | −45 |

**Quick-win subtotal: ~625 LOC deleted.**

---

## 3. Structural moves

Sequenced so each move makes the next one easier. The unifying idea (worth internalizing as a design lesson): **a shared operation should have one public owner at the lowest layer that can legally hold it** — when a helper is copy-pasted or imported by its underscore name across packages, that's the codebase telling you the operation lives in the wrong place or under the wrong name.

### Move 1 — `content.documents.resolve_doc_id()` (do first; everything touches it)

The "default to latest document" fallback exists **6 verbatim copies + ~12 inline repeats**, and three packages import someone else's *private* copy (`study/drill.py` and `exam.py` from `extraction.skeleton`, `api/audiobook_routes.py` from `media.audiobook`, `overview/coverage.py` from `platform.jobs`). Worse, every no-arg resolve calls `fetch_latest_document()`, which SELECTs the **full book markdown** just to read one id.

- Add `resolve_doc_id(doc_id: str | None) -> str | None` to `content/documents.py` as a cheap `SELECT key FROM documents ORDER BY created_at DESC NULLS LAST LIMIT 1` (copy `toc_tree.py:43-54`, the one variant that does it right). Use falsy `if not doc_id`, not `is None`.
- Delete the 6 copies and inline repeats; repoint the three cross-package private imports.
- **Keep `platform/jobs.py`'s injected `_doc_resolver`** — platform can't import content; that seam is deliberate dependency inversion. Just wire `pipeline/registry.py:45` to inject the new function.

Why: content is below every consumer in the dependency order, so it's the lowest legal owner. Est. **−45 LOC**, plus a real perf win. Risk: near zero — no test, MCP, or frontend reference exists.

### Move 2 — Make `content/scope.py` the deep module it claims to be

Its docstring says "the ONE answer to what's inside chapter X," but it exports only underscore privates, and the outline-first→span-fallback composition is hand-rebuilt in **6+ places** — with `overview/coverage.py:48` and `concept_store.py:78` *skipping the outline-first step*, so readiness concept counts can disagree with the reader on mixed-keyspace chapters. This is exactly the bug class the module exists to prevent.

- Promote public `scope_section_keys(doc, scope)` and add `scope_blocks(doc_id, scope, rows=None)` that owns the SQL + composition. The `rows=None` param matters: `chapters.chapter_units` and both coverage functions batch one fetch across many scopes — without a preloaded-rows form they'd regress to N queries.
- Move `_load_section_blocks` (+ `SectionExtractInput`, `section_body_len`, the junk-heading/min-body filters) from `extraction/extract.py` into content as public `load_section_blocks`. It's built entirely from content/scope primitives and is imported by **media, study, and extraction** — extraction is acting as an undeclared lower layer. `extract.py` then dissolves (fold the prompt helpers into `concepts_extract.py`; drop the dead `batch` param, the `normalize_entity` alias, the one-call `assemble_section_concepts` wrapper).
- Rewrite the six call sites (`store.fetch_section_content`, `chapters.has_content`, `concept_store`, both coverage functions, scope itself) on the public API. Make the remaining privates genuinely private. Re-point `tests/test_extract.py` imports.
- Also switch `exam.py`/`drill.py` from `_load_section_blocks`-as-key-enumerator to `scope_section_keys` — today they load full markdown and inherit extraction's junk filter just to enumerate keys, and can disagree with the review queue about a chapter's extent.

Why: this concentrates the app's most subtle invariant (chapter extent) in one owner and fixes a verified behavioral divergence for free. Est. **−100 LOC** across scope/extract/coverage/exam/drill. **Risk: this is a behavior *unification*** — coverage and concept_store gain the outline-first step (that's the fix, but verify chapter counts on a slug-keyed book after). Note also: rename must be scoped — `deep_chapter.py:47` and `audiobook.py:145` define unrelated local functions with the same `_scope_section_keys` name.

### Move 3 — API layer at one altitude: dismantle `admin_routes.py`, empty `main.py`

`admin_routes.py` (464 ln, 4x any other router) is a domain in disguise: its own chapter resolution (a *third* parallel implementation, contradicting scope.py's contract), a keyword-search engine, a 14-table delete cascade, concept mutations that bypass `concept_store` (two write paths to the concepts table), and course-status aggregation whose regex `chapter_key_of` provably disagrees with scope resolution on mixed keyspaces. `main.py` moonlights as a 13-route router.

- Push each block to its owner: chapter assembly → `content/chapters.py` (on the new `scope_blocks`); keyword search → `search/keyword_search.py`; concept PATCH/DELETE/questions → `extraction/concept_store.py`; document DELETE cascade + listing → `content/documents.py`; course-status → `overview/coverage.py` (straight move — reuse its `chapter_entries` derivation and scope-based mapping, delete `chapter_key_of`, but preserve the `exists:false`/404 contract and keep it cheap — don't derive from the heavyweight `chapters_coverage`). Keep the `~N`-suffix stripping the regex had. Re-point `test_admin_helpers.py`.
- Extract `api/content_routes.py` (8 content reads) and `api/mastery_routes.py` (5 study rollups) from `main.py`; fold `/api/mistakes` in and retire `study_routes.py` (move its SQL into study/); move `ensure_worker()` from `build_routes.py:23` import-time side effect to `main.py` next to `install_job_runners()`. `main.py` becomes a ~75-line composition root.

Why: URL paths are unchanged (frontend proxies and MCP address paths, not modules), so risk is mechanical. The payoff for a reader is huge: "every route is thin, every algorithm has a domain home" becomes true instead of 85% true. Est. **−105 LOC**.

### Move 4 — One job kind: normalize `build` → `extract`

Two kinds run the identical runner, but enqueue sites disagree (`lifecycle.py` autochains `extract`, `/api/extract` enqueues `build`) and readers filter on `build` only — so **autochained post-upload extraction is invisible to the status poller and readiness ladder**, and the divergent dedup keys let the same work queue twice.

- Normalize at the enqueue boundary (one line), make `list_builds`/`_bkey` treat them as one kind (keep the legacy hash for old rows per `test_build_queue_kinds.py`), register a single runner.
- Then rename jobs.py's Python surface (`enqueue_job`/`list_jobs`; REST paths and the `chapter_builds` table stay). Frontend can migrate from posting `kind='build'` later, since the server normalizes — do **not** drop the alias server-side alone.

Est. **−22 LOC**; fixes two observable inconsistencies. Risk: low, but test the status poller against an autochained upload.

### Move 5 — Study package: one owner per concern

- Move the stage/progress ledger (`GRADE_VALUE`, `get_chapter_progress`, `update_stage`, `record_skeleton_grade`) out of `extraction/skeleton.py:317-370` into `study/chapter_progress.py` — it's learner state, not extraction, and it's why study imports extraction internals.
- Deduplicate the three parallel in-memory session stores + grading loops (`exam.py`, `drill.py`, `quiz_session.py`): one TTL'd session-store helper **with the lock quiz_session has and the other two lack** (a real thread-safety gap under uvicorn), one shared `grade_answers()`. Est. −70.
- Merge the ~55-line `_grade_skeleton_item`/`_grade_figure_item` twins in `reviews.py` and replace the `.replace(" FROM concept_reviews", ...)` SQL string surgery with an explicit column-list variant. Est. −55. (Do *after* the 2a bug fixes so you're refactoring working code.)

Risk: moderate — this is the one area where tests fixture the wrong shapes, so fix tests first.

### Move 6 — Platform-level tidies

- `platform/embeddings.py`: move `embed_texts` + `_EMBED_URL` (+ `_cosine` deletion) out of the misnamed `search/concept_resolve.py`; `_sig_tokens`/`_GENERIC_NAME_TOKENS` move into their only consumer, `study/cards.py`. Kills the study→search edge; `concept_resolve.py` disappears. Est. −17.
- `platform/inflight.py` with `start_once(sig, fn)`/`is_running(sig)` replacing the tripled set+lock+daemon-thread guard (`concept_quiz_llm`, `reading_guide` — mostly deleted in quick wins, `deep_chapter`). Keep response shapes (`running: true`). Est. −32.
- One app-level exception handler + tiny `respond()` helper replacing ~21 try/except→JSONResponse copies and the 6-way status-code split (pick 503 — failures are Postgres/Ollama dependencies). Convert `ingest_routes`' three `HTTPException`s to the `{error}` envelope and delete the frontend's `detail`-vs-`error` bridge. Est. −50. Verify the proxies tolerate 503 on previously-unwrapped routes.
- Move `queue_summary()`'s doc/chapter-title decoration from `platform/jobs.py:300-314` up to `api/system_routes.py` (sole caller; wire shape unchanged) — the one place platform knows a content table.
- Hoist the 23 function-local `from app.*` imports to module top (only `pipeline/ingest.py:79` guards a real cycle — and quick win 2b removes even that). Where a top-level import feels uncomfortable, that discomfort is design signal — leave it visible.
- Adopt the rule and add it to `ARCHITECTURE.md`: **an underscore name may only be imported within its own package** (after Moves 1-2, a grep for cross-package `import _` should return only tests), and fix the documented chain to `platform <- content <- domains <- {overview, pipeline} <- api` — overview and pipeline are siblings; the current doc describes a chain that doesn't exist.

**Structural subtotal: ~−400 LOC.**

## Total estimated reduction: ~1,000 LOC (~10% of the 10.6k backend), plus 5 real bug fixes and the end of cross-package private imports.

---

## 4. Deliberately NOT recommended

- **Dropping the `build` job-kind alias server-side.** The frontend still actively POSTs `kind='build'` (`pipeline.ts:182-188`). Normalize at the boundary; migrate the frontend separately.
- **Mechanically swapping every derivative scope helper for the canonical one.** Verified counter-example: `pipeline/build.py:42-44` uses key-emptiness as an *error guard* ("no readable content in this scope"); the canonical resolver's `{scope}` fallback would silently turn that failure into a zero-concept "success" on the job ledger. Unify the others; give build.py an explicit resolved-empty signal.
- **Folding the inflight-guarded backfills onto the jobs ledger in one big move.** The `reading_guide` conversion is verified safe (do it); converting `deep_chapter.prepare` and `concept_quiz_llm` to job kinds is a behavioral change (Process-grid visibility, dedup semantics) — take the shared guard first, convert opportunistically.
- **Deleting the `set_doc_resolver` injection in `platform/jobs.py`.** It looks like a redundant 7th copy but it's the dependency-inversion seam keeping platform below content; importing content from platform would create the exact cycle the architecture forbids.
- **Renaming REST paths or the `chapter_builds` table.** Frontend proxies, MCP server, and stored rows address them; the Python-surface renames deliver the readability win at zero migration cost.
- **Merging `overview/` and `pipeline/` or forcing them into the documented chain.** Both earn their place as composition layers with real callers; the fix is one line of documentation, not a package move.
- **Centralizing the sha256 key *strings*.** Add a tiny `digest_key(*parts)` for the hashing recipe if you like (−6), but keep each module's one-line key function — these are **persisted row keys**; the exact input strings (`'ALL'` sentinels, jobs' legacy-key branch, reviews' `skel-`/`fig-` prefixes) must not drift or stored rows become unaddressable.
- **Re-wiring `seedling_client.py` instead of deleting it.** The vault-seedling synergy was real intent, but code with zero callers protected by its own test is a lie in the codebase. Delete now; re-add from git history when a real call site (e.g. review completion) exists.
- **A generic repository/DAO layer over Postgres.** The camelCase-aliased SQL-in-owner-module pattern is consistent and shallow; an abstraction layer would add indirection to solve a problem (multiple datastores) you just finished deleting.
