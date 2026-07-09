# A Philosophy of Software Design — full codebase review (2026-07-09)

Four parallel reviews (Python backend, frontend components, frontend lib + API routes,
cross-cutting seams) graded the repo against Ousterhout's principles: deep vs shallow
modules, information hiding, change amplification, pull-complexity-downward,
define-errors-out-of-existence, comments, naming, together-vs-apart.

## Verdict

**Overall: B− — a well-designed modern product (the concept-era Learn Hub) buried under
an undead legacy stratum (the triple/KG playbook era) that is roughly a third of the repo.**

The live code follows the book unusually well at the micro level. Almost every
cross-cutting inconsistency, config conflict, and dead wire belongs to the legacy layer.
The single highest-leverage move is not new abstraction — it is finishing the amputation
that `cleanup/remove-graph-triple-infra` started (that branch removed the graph
*visualization*; the graph *ingestion/query* layer survived in full).

### Prunable dead code (deduplicated estimate)

| Area | ~LOC | What |
| --- | --- | --- |
| frontend lib/ | 6,900 | 15 of 31 files dead: text-processor, llm-service, backend-service, remote-backend, arangodb, neo4j, qdrant, rag, langchain-service (0 importers), graph-db-*, query-logger, toc-llm, toc-preview-helpers |
| frontend api routes | 3,200 | ~35 non-learn route groups with zero live callers (extract-triples, enhanced-query, graph-query-llm, query-log, metrics, embeddings, vector-db, most of ollama/vllm) |
| frontend utils/ | 1,900 | toc-processing.ts (1,597 LOC — only live reference is an unused import), most of text-processing.ts |
| frontend components | 3,800 | embeddings-generator.tsx (1,504, orphan) + its private chain (model-selector, toc-preview-dialog, toc-section-selector, advanced-options, prompt-configuration ≈ 1,100), settings-modal Neo4j/S3/Qdrant tabs (~450), database-connection legacy halves (~400), documents-table triple dialog (~200), s3-upload (~240), api-key-prompt (~130) |
| document-context.tsx legacy | 450 | triple CRUD, extractTriplesFromChunk, processDocumentsLegacy, CSV/JSON parsing; incl. a fetch to `/api/graph-db/check-document` — a route that does not exist (permanent 404) |
| Python backend | 1,400 | dead triple pipeline: extract_document (0 callers), quiz_gen.py, triple study surfaces in study_routes, most of arango_learn.py, never-invoked concept_resolve pass, legacy template pages |
| deploy/scripts | 4,000+ | gnn_model + vllm service dirs (no active compose ref), 3 inactive compose files, orphaned init scripts, assets/scripts (gnn/, benchmarks, setup-pinecone.js), assets/examples |
| **Total** | **~20,000 (~35–40% of the repo)** | |

### Area grades

- **Python backend (services/learn/app): B−.** Strong micro (pure tested functions, deep
  llm.py, good why-comments); weak macro (scope resolution has no home module, 4 parallel
  job systems, dead triple pipeline, one silent-failure trap).
- **Frontend components: B−** (an A− learn/ layer on a D+ legacy layer). Main live sins:
  deep-chapter.tsx 1,675 LOC god-component; 5 copies of the MCQ state machine; 18-prop
  CourseHome.
- **Frontend lib + api routes: C+** (live core B+, fossil layer D−). 61 of 64 learn routes
  are pure pass-through stubs; ~60% of the layer is dead.
- **Cross-cutting seams: B−.** One good proxy + one client SDK + a model-citizen MCP
  server; but the wire contract is hand-restated 2–4× per endpoint with nothing enforcing
  agreement, and config defaults conflict across files.

## Top findings (merged, priority order)

### P0 — deletions (no behavior change, biggest complexity payoff)

1. **Finish the triple/KG amputation** — everything in the table above under frontend
   lib/routes/utils/components + document-context legacy + backend triple pipeline +
   deploy leftovers. Evidence of rot while it lingers: a fetch to a nonexistent route,
   3 window events emitted with no listener anywhere, 2 unused imports in
   document-context, dead code reading localStorage keys only dead code writes.
2. **Delete langchain-service.ts today** (322 LOC, zero importers) — the free square.

### P1 — high-impact refactors in live code

3. **Backend: create `app/scope.py`.** Scope resolution (what sections a TOC scope spans)
   is the system's central concept and has no module: `extract.py`'s _private_ helpers are
   imported by 10 modules, 3 modules wrap them differently, an upward lazy import dodges a
   cycle (arango_content.py:813). One deep `sections_in_scope(db, doc_id, scope)`
   dissolves ~8-site change amplification AND the import cycles.
4. **Backend: `persist_document` swallows every failure** (arango_content.py:693
   `except Exception: return None`) → ingest reports "done" with docId null. Let it raise;
   mark the job error. Worst unknown-unknown in the repo.
5. **Backend: finish the build_queue migration.** build_queue.py declares itself "the ONE
   registry"; extract.py and audiobook.py still run copied in-memory _JOBS blocks
   (invisible to the Process tab, unpausable, uncancellable), plus a third _inflight
   pattern in 3 artifact modules. Route extract + audiobook through enqueue_build; delete
   both _JOBS blocks (~70 LOC of verbatim copy).
6. **Frontend: split deep-chapter.tsx (1,675 LOC).** 6 fetches, 2 polling loops, DOM
   mutation passes, scroll persistence, narration player, 7-way drawer router in one
   closure. Extract useChapterData / useScrollMemory / useNarration hooks + NarrationBar /
   StudyDrawer children; drawer switch at :1633 is the natural seam.
7. **Frontend: one `useMcqSession` + `useNumberKeyAnswers` hook.** 5 copies of the MCQ
   session machine (concept-quiz-panel, exam-panel, drill-view, section-concepts-panel,
   dump/lockin) and 5 keydown handlers that have already drifted.
8. **Collapse the 61 pass-through route stubs** into one catch-all
   `app/api/learn/[...path]/route.ts` (~590 LOC and 61 files deleted; keep the 3 binary
   streaming proxies + a rewrite table for ~4 non-identity paths; the X-User-Db header is
   the ONLY value this layer adds — it lives in learn-proxy, keep it).

### P2 — seams and conventions

9. **Write the wire contract once.** Backend returns bare JSONResponse(dict) everywhere;
   learn-service.ts hand-mirrors it in 79 TS types. Add Pydantic request/response models
   to the Python routes (llm_schemas.py proves the team knows how), then optionally
   generate TS types via openapi-typescript. Also unifies the error dialect: {"error"}
   (53 sites) vs HTTPException {"detail"} (16 sites in ingest_routes/study_routes),
   currently absorbed by parseJsonResponse.
10. **One config module per side.** Ollama base URL defaulted in 10 files with two
    conflicting hosts (localhost vs ollama — the localhost fallbacks are wrong in Docker);
    default model has 3 different values in code (llama3.1:8b ×5, qwen3:1.7b ×6, real
    default nemotron-3-nano:30b only in compose); document-context.tsx contains both
    stale defaults 68 lines apart. Most of the sprawl dies with the P0 purge; a small
    config.ts/config.py catches the rest.
11. **Backend: one `resolve_doc_id`** (defined 7×, plus 17 inline latest-doc fallbacks
    that each pull the entire book markdown from Arango to read a 16-char key) and one
    `SessionStore` (4 in-memory TTL stores; exam.py and drill.py have no lock and are racy).
12. **Backend: artifact status API.** build_queue's chapters_coverage imports privates
    (_bkey, _key, SKELETONS) from six modules and re-computes their freshness rules. Each
    artifact module should export `status(db, doc_id, scope)`; coverage composes them.
    (skeleton._key and deep_chapter._bkey are literally the same sha256 function.)
13. **Grade-handler triplication** (concept_study_routes.py:366-568): skeleton/figure/
    concept grading are 3 copy-pastes of one sequence (~180→~60 LOC via an item-type
    registry); the queue route mirrors it with 3 card shapers + a hardcoded
    `NOT IN ['skeleton','figure']` AQL filter.
14. **learn-proxy.ts:23 leaks consumer shapes** — generic GET error body includes
    `tree: [], cards: []` (two specific endpoints' empty states in shared infra).
    Consumers own their empty states. Related rule: "proxy owns the query string, stubs
    never touch it" (the doubled-query-string audiobook bug at learn-proxy.ts:55-59).
15. **Frontend fetch/poll boilerplate**: 16 files hand-roll alive-flag fetch guards,
    5 hand-roll setInterval polling. One useAsyncData + usePoll pair (~300 LOC saved,
    one place to fix the stale-response race). Plus small dedups: KIND_COLOR vs
    KIND_STYLES (already diverged: sky-400 vs blue-400), nextNightEpoch ×2,
    MasteryRing ≈ MiniRing, localStorage keys under two brand prefixes (txt2k: / txt2kg_)
    → one lib/local-settings.ts.

### Repo hygiene

- Root spec files (concept-course-spec, concept-layer-spec, deep-chapter-spec) describe
  shipped work → move to docs/. README.md is still half NVIDIA-playbook framing.
- main.py legacy template pages (/tree /flashcards /quiz /socratic) duplicate the real UI.
- Comments narrating change history ("the rebuild existed but was never invoked") are
  commit messages embedded in code — keep the why/invariant comments, drop archaeology.

## What's GOOD — do not break

- **llm.py** — textbook deep module: two functions with a stable (result, error) contract
  hiding LangChain, the native-vs-/v1 quirk, the num_ctx foot-gun (its docstring is
  exactly the comment APoSD asks for).
- **srs.py + mastery.py pure math** — append-only event floor + view-time recomputation
  is genuine define-errors-out-of-existence design.
- **audiobook.py checkpoint/resume** — per-chunk checkpoints + pinned manifest +
  TTS gate absorb the "hours-long GPU job dies" problem below the API.
- **The pure/impure split + tests** — page provenance, outline assignment, quiz gates are
  pure and unit-tested at exactly the right layer.
- **build_queue's worker model** — ledger, restart-requeue, cooperative cancel, notBefore
  scheduling. Only its adoption is incomplete.
- **learn-proxy.ts + learn-service.ts** — one proxy chokepoint, one client SDK; zero
  components fetch /api/learn directly (verified). parseJsonResponse is the single error
  translation point.
- **mcp/server.py** — best seam in the repo: one _req() helper owns HTTP/headers/errors;
  30 tools of 1–4 lines each; no duplicated backend logic.
- **Comment culture in learn/** — why-comments carrying non-obvious knowledge
  (scroll-clamp trap, wipe-guard, double-encoding bug post-mortem).

## Suggested sequencing

1. **Prune week** (pure deletion, no behavior change): P0 items. ~20k LOC out.
   Verify with the existing test suite + a manual pass of the live UI surfaces.
2. **Backend structure day**: scope.py, resolve_doc_id, persist_document raise,
   build_queue migration, SessionStore.
3. **Frontend structure day(s)**: deep-chapter split, MCQ/fetch/poll hooks,
   catch-all proxy route.
4. **Contract afternoon**: Pydantic models on Python routes; unify error dialect;
   config modules; optionally generate TS types.

---

*Full per-area reports (with every file:line finding) follow.*

<!-- The four detailed agent reports are preserved in the session transcript;
     regenerate or expand any section on request. -->
