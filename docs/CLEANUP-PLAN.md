# txt2kg Cleanup Plan

_Census date: 2026-06-25 · tools: scc (size), knip (frontend reachability), vulture (Python dead code), import-graph tracing._

## Baseline & method
- Repo: `main`, work committed (via GitHub Desktop); only `lib/learn-proxy.ts` + `assets/stop.sh` uncommitted at census time. **Clean baseline.**
- Frontend: 229 TS files / ~30K code lines. Learn backend: 48 Python / 8.4K lines (vulture: ~no dead functions — already tight).
- **Do all removal on a `cleanup/*` branch, with a build + smoke-test gate after each phase** (`docker compose build app && up -d app`; `docker compose build learn && up -d learn`; `next build` is lint/type-ignored so rely on `tsc --noEmit` + the live app).

---

## TIER 1 — Safe dead code (no behavior change, low risk)

### 1a. Delete unused files (20)  — knip "unused files", minus operational scripts
**Unused shadcn UI primitives (never imported):**
`components/ui/{avatar,pagination,radio-group,separator,sheet,sidebar,slider,spinner,table,toggle-group,toggle,use-mobile}.tsx`
**Unused hooks:** `hooks/{use-concept-highlights.ts,use-mobile.tsx,use-read-sections.ts,use-text-annotations.ts}`
**Superseded Learn components:** `components/learn/inline-check.tsx`, `components/learn/section-reader.tsx` (replaced by ChapterReader)
**Misc:** `app/.static/3d-force-graph-mock.js` (KG viz), `styles/nvidia-build-typography.css` (old NVIDIA brand)
**KEEP (operational, run manually — not dead):** `scripts/backfill-doc-ids.mjs`, `scripts/backfill-study-events.mjs`, `scripts/seed-user.mjs`

### 1b. Remove unused npm deps (`package.json`) — 13 + 1 devDep
`3d-force-graph`, `three`, `@types/three`, `d3`, `@types/d3` (KG 3D viz) · `react-hook-form`, `@hookform/resolvers` (forms, unused) · `@radix-ui/react-{radio-group,separator,slider,toggle,toggle-group}` (match deleted UI) · `next-themes` (verified: imported nowhere) · devDep `@types/katex`.
**ADD:** `postcss-load-config` to devDependencies (currently used by `postcss.config.mjs` but unlisted).
→ Then `npm install` to prune `node_modules`.

### 1c. Trim dead exports — ONLY in files that stay (skip files Tier 2 deletes wholesale)
- `lib/learn-service.ts`: `fetchSectionAugment`, `fetchDeck`, `startQuizSession`, `submitQuizAnswer`, `sendChatMessage`, `countEntityLeaves` + dead types `Flashcard`, `DeckResponse`, `QuizSessionResponse`, `QuizAnswerResponse`, `ChatMessage`, `ChatResponse`, `SectionAugment` (old triple-era study endpoints, superseded by concept-study).
- `utils/toc-processing.ts` (**file stays** — live for TOC preview): drop `tocStructuralTriples`, `TOC_SUBSECTION_PREDICATE`, `SECTION_MENTIONS_PREDICATE` (dead triple emitters) + verify `detectOutlineFromHeadings`/`parseTextbookTocLine`/`stripTocLineTrailers` are truly unused before removing.
- `lib/utils.ts`: `downloadTextAsFile` · `lib/course-groups.ts`: `descendantGroupIds` · `lib/toc-preview-helpers.ts`: `LLM_TOC_FALLBACK_STORAGE_KEY` · `lib/toc-llm.ts`: `llmSectionsToTocBlock`, `llmSectionsToAnalysis`.
- Skip the ~25 unused re-exports in `components/ui/*` primitives (vendored; harmless, low value).

**Tier 1 estimate:** ~20 files, ~13 deps, ~20 exports. Pure subtraction, no feature change.

---

## TIER 2 — Retire the old NVIDIA KG/RAG/vector/S3 shell (product decision, ~14K LOC ≈ half the frontend)

This machinery is **wired but vestigial** — reachable through the **Configure tab** and the **`/rag` page**, both superseded by the concept-Learn hub.

### KEEP (the live Learn app + the ingestion it needs)
- **Learn:** `components/tabs/LearnTab.tsx`, all `components/learn/*`, `lib/{learn-service,learn-proxy,courses,learn-path,reading-progress}.ts`
- **Ingestion:** `components/tabs/UploadTab.tsx` (slimmed — see below), `components/{upload-documents,documents-table}.tsx`, `contexts/document-context.tsx`, `lib/convert-pdf.ts`, `utils/toc-processing.ts` (TOC preview only), API routes `app/api/{convert-pdf,convert-pdf/status,ollama/tags}` (model picker + conversion)
- **Auth/data:** `lib/user-data-db.ts`, `lib/auth*.ts`, API routes `app/api/{documents,courses,reading-progress,user-settings}` + `app/api/learn/*`

### REMOVE — clusters (verify each is unimported by the KEEP set before deleting)
1. **Configure tab** → `components/tabs/ConfigureTab.tsx`, `components/{embeddings-generator,model-selector,prompt-configuration}.tsx`; remove the `"configure"` `<TabsContent>` + import from `app/page.tsx`.
2. **RAG page** → `app/rag/page.tsx`, `components/rag-query.tsx`.
3. **Old Upload sub-features** → `components/{database-connection,s3-upload,s3-upload-container}.tsx`, `utils/s3-storage.ts`; drop their imports from `UploadTab.tsx` (keep `upload-documents` + `documents-table`).
4. **Old lib services (~6.3K)** → `lib/{rag,langchain-service,qdrant,arangodb,remote-backend,backend-service,llm-service,text-processor,query-logger,graph-db-service,graph-db-utils}.ts`, `utils/text-processing.ts`.
5. **Old API routes (~3.7K, ~35 routes)** → `app/api/{graph-db/*,vector-db/*,embeddings,sentence-embeddings,extract-triples,rag-query,graph-query-llm,enhanced-query,query,process-document,store-documents,query-log/*,fix-query-logs,metrics,infer-toc,vllm/*,stop-embeddings,stop-processing}` — **verify each individually** isn't called by `document-context` or any KEEP route.
6. **Deps freed afterward** → `arangojs`, the qdrant client, `langchain*`, AWS S3 SDK, etc. (run knip again post-removal to confirm).

### Risks / untangle points (handle, don't blind-delete)
- `contexts/document-context.tsx` still imports `extractDocumentWithOptionalToc` from `toc-processing` and `PreparedIngestFile` from `convert-pdf` — the **convert → concept-extract path must keep working**. Trace exactly what the live Process flow calls before cutting `toc-processing`/`text-processing` internals.
- `lib/arangodb.ts` is the OLD KG graph client (used only by `graph-db/*` routes); the live `/api/documents` uses `user-data-db` — so arangodb.ts is safe to drop **with** the graph-db routes, not before.
- After removing each cluster, `tsc --noEmit` will surface dangling imports — fix iteratively.

### Suggested phasing (build + smoke after each)
1. Remove Configure tab + RAG page + their exclusive components (self-contained UI). Build, confirm Learn/Upload still work.
2. Remove now-orphaned lib services + API routes (knip to confirm orphaned). Build.
3. Prune freed deps; `npm install`; final `next build` + live smoke (upload a PDF → process → study).

---

## Backend (learn) — light touch
- `app/seedling_client.py` is orphaned (refs=0) — but it's the **vaultwriter seam** for a planned synergy. **Decision needed:** keep for future use, or remove until then.
- Possibly-retired study modes: `quiz_gen.py` (old section quiz, gated off by `LEARN_QUIZ_LLM=0`), `exam.py`, `drill.py`, `recall.py`, `cards.py` — **verify** whether the frontend still calls their routes; retire any that are UI-dead. (Not confirmed dead yet — needs a route-usage check.)

## This session's additions — clean, no action
MCP server, `admin_routes.py`, `concept_quiz_llm.py` rewrite, `get_chapter`/`search` endpoints, and the `learn-proxy` double-query fix are all reachable and were written tight (knip/vulture flagged none). The proxy fix removed a latent bug class.

---

## Open questions (decide before Tier 2)
1. **Upload flow:** is the Upload tab how you add books? OK to slim it to just file-upload (drop the DB-connection + S3 panels)?
2. **Retire the `/rag` page and Configure tab entirely?** (You don't use them; confirm they're abandoned.)
3. **`seedling_client` / vault seam:** keep for the planned Obsidian synergy, or remove for now?
4. **Old backend study modes (exam/drill/recall/quiz_gen):** still used anywhere, or retire?

## Bottom line
- **Tier 1** is ~no-risk subtraction — worth doing now.
- **Tier 2** is the real win (~14K LOC, half the frontend) but is *retiring features*, not deleting dead code — needs the 4 answers above + careful per-cluster verification + phased build gates.
