<!-- Produced 2026-07-15 by a 66-agent audit workflow (9 area analyzers + 4 cross-cutting
lenses + a dedicated organizing-framework evaluator; removal claims adversarially verified with
Next.js-convention awareness). Plan only — nothing applied yet. Companion to docs/module-hubs.md
and docs/backend-lean-audit.md. -->

# Learn Hub Frontend: Organizing Framework & Cleanup Plan

## 1. State of the frontend

The 2026-07-14 feature partition did its job: the layout is already a clean `app/ → features/{learn,documents,process} → components/lib` shape, the dependency graph is a genuine DAG (process → learn → documents, zero cycles, zero `lib/server` leaks into client code), and API discipline is real — exactly one raw `fetch()` exists outside the api layer in the whole tree. What's missing is **enforcement**: nothing stops the next deep import (app/ pages already reach into ~20 feature-internal paths, and 2 shared-kit files import feature internals), and two eras of retired features (knowledge-graph, deep-explanations, hash-tabs, reading-guide) left ~900 LOC of verified-dead code behind. The single worst offender is `deep-chapter.tsx` — 1,672 lines, 31 useState / 21 useEffect, ~8 concerns, importing 8 of the 12 api modules. Honest totals from 13 verified audits: **~900 LOC deletable outright, ~500–700 LOC collapsible via dedup, ~2,500 LOC relocatable into testable modules** (net-zero but the payoff is legibility).

---

## 2. The organizing framework

**Pick: keep the current bulletproof-react layout exactly as is, and layer the backend's module-hub *contract* on top — enforced by `frontend/scripts/check-hubs.mjs`, a rule-for-rule mirror of `scripts/check_hubs.py`.**

**Why this and not something heavier.** FSD's 6-layer taxonomy would force re-sorting ~176 import edges in a 3-feature app where one feature is 85% of the code — taxonomy cost with no payoff. Route colocation regresses against measured sharing (`use-course-data` and `course-guard` each feed 7 routes). And a literal port of the backend (one fat `index.ts` barrel per feature) collides with your deliberate 2026-07-14 no-barrel decision *and* with JS-specific costs Python doesn't have: Next dev-mode compiles the full module graph per entry, and mixed client/server barrels were the trigger class of the RSC-manifest bug you already fixed once. The insight from the framework evaluation: **the hub is the boundary contract, not necessarily one file.**

### Target tree (moves only, no restructure)

```
frontend/
  app/                          # routes + wiring ONLY
    _chrome/                    # NEW: app-nav, breadcrumbs, user-menu, shortcuts-help
    api/learn/…                 # thin proxies (all via lib/server/learn-proxy)
  features/
    learn/
      index.ts                  # NEW HUB: fronts components+hooks+lib (~17 symbols)
      api/<domain>.ts           # 12 modules — SANCTIONED SUB-HUBS, directly importable
      components/  hooks/  lib/ # internal; deep relative imports stay
    documents/index.ts          # NEW HUB (Document type, useDocuments, DocumentProvider, UploadTab)
    process/
      index.ts                  # NEW HUB (ProcessTab)
      api/pipeline.ts           # NEW: process-owned slice moved out of learn (see §4)
  components/                   # feature-agnostic kit ONLY (ui/ = shadcn-managed, exempt from doc rule)
  lib/  lib/server/             # lib/server poisoned with `import 'server-only'`
  scripts/check-hubs.mjs        # the CI gate
```

### The import contract (what the script checks)

1. **Cross-boundary imports into a feature target its hub or its api sub-hubs only.** From outside `features/learn`, legal targets are `@/features/learn` and `@/features/learn/api/<domain>` — never `components/`, `hooks/`, or `lib/` internals.
2. **Dependency direction:** `lib ← components ← features ← app`. Upward imports fail. `components/**` may never import `@/features/*` (zero exceptions once `_chrome/` lands).
3. **Cross-feature edges are allowlisted explicitly:** `{process → learn, learn → documents}` — the two real, documented couplings. Anything else fails until added deliberately.
4. **Server fence:** `@/lib/server/*` importable only from `app/**` and `lib/server/**`; plus `server-only` imports in `pg.ts`/`auth*.ts`/`user-db.ts` so a `'use client'` violation becomes a *build* error (pg.ts embeds a fallback DSN — this is the cheapest real security win in the plan).
5. **Facade hygiene:** each `index.ts` opens with a backend-style doc header (Owns / Public surface / Depends on) and contains only re-exports.
6. `--report` and hard-fail modes; runs in the **same CI workflow** as the backend's `check_hubs.py`, so both halves of the repo carry the identical mechanical contract.

The script is ~120 lines, zero-dep — imports are statically greppable because the alias is uniformly `@/*`. (An `eslint-plugin-boundaries` setup would also work, but the bespoke script matches the backend pattern you already trust and keeps the rules readable in one file.)

### How it resolves the learn/api no-barrel tension

The no-barrel decision governs **intra-feature** imports and stays fully intact: the 12 api modules keep importing each other and being imported deeply inside learn, `http.ts` stays naturally private, and the import line ("`api/review`", "`api/quiz`") stays live documentation of which backend domain a component talks to. The 12 modules are *already* per-backend-domain facades — so the check script states them as a named exception, exactly the way `check_hubs.py` states its `backend/tests` and `app/main.py` exceptions. The `features/learn/index.ts` hub carries only the ~17-symbol components/hooks/lib surface that `app/` measurably consumes today (CourseGuard, useCourseData, the page-level views, scope-url helpers…). No 120-export god-barrel, no HMR bloat, no re-litigating the decision.

**Migration is small and mechanical:** 3 facades (~150 lines), ~47 import-site repoints across ~15 files, 4 chrome-file moves, the script. Backend-proven order: write facades → repoint → `--report` → fix stragglers → hard fail.

**Why this matters (the learning point):** prose conventions decay; mechanical contracts don't. The backend's hubs work because a script fails CI, not because ARCHITECTURE.md asks nicely. Once this lands, splitting `deep-chapter.tsx` or reshuffling learn internals becomes a single-feature change that *cannot* break `app/` — that's the entire point of an import surface.

---

## 3. Quick wins (all adversarially verified, safe to delete)

| What | Files | LOC |
|---|---|---|
| 9 unused shadcn primitives + **5 radix deps** (`@radix-ui/react-{checkbox,collapsible,popover,tabs,tooltip}`; **keep** `@tailwindcss/forms` — it's an active global plugin) | `components/ui/{alert,badge,checkbox,collapsible,ollama-icon,popover,tabs,textarea,tooltip}.tsx`, `package.json` (delete files + deps in one commit) | 295 |
| Legacy hash-tab stylesheet, ~85% dead | `styles/build-typography.css` — inline the two survivors (`.build-card` + hover/dark variants, `.build-gradient-text`) into `globals.css`, delete file | ~200 |
| Retired reading-guide client chain (backend endpoints stay — MCP uses them directly) | `features/learn/api/reading.ts`, `app/api/learn/reading-guide/` (both routes) | 79 |
| Dead deep-prep chain: `fetchOrient`+`OrientResponse`, `prepareDeepChapter` + proxy routes (keep `DeepChapterStatus` and `countSections`) | `features/learn/api/chapter.ts:83-97,180-191`, `app/api/learn/orient/`, `app/api/learn/deep-chapter/prepare/` | 52 |
| Dead augment proxy (only `maxDuration` export in the tree — retired flow relic) | `app/api/learn/section/augment/[...key]/route.ts` | 21 |
| Ghost localStorage model override (no UI writes the keys) | `selectedOllamaModel()` in `features/learn/api/pipeline.ts:61-96` | 24 |
| Deep-explanation type residue: unread `augments/sections/pageStart/pageEnd` on `DeepChapterResponse`, phantom `totalConcepts` on `DeepChapterStatus`, orphaned docstring at `concepts.ts:22` | `features/learn/api/chapter.ts`, `concepts.ts` — **flag backend**: `deep_chapter.py:~191-202` runs a per-request SELECT to assemble `augments` nobody reads | 24 |
| KG-era UI relics: `chaptersOnly` prop (zero callers), no-op "Clear selection (study whole graph)" button, "into the graph" tooltip copy | `features/learn/components/home/syllabus-tree.tsx` | 32 |
| Dead props: LockInPanel's never-rendered "Up next" block, DrillView's `title` | `study/lockin-panel.tsx:84-97`, `study/drill-view.tsx` | 25 |
| Hash-tab shims in documents: `onTabChange` chain (3 files, incl. unused `useRouter` in `app/upload/page.tsx`), `clearDocuments`, dead `Document` fields (`extractedDate`, `Uploading` variant + constant Upload Status column, unreachable `Processing` branches — also kills `STATUS_BADGE.processing` in course-shelf) | `features/documents/**`, `features/learn/lib/courses.ts` | 78 |
| `process-tab.tsx` passthrough (+ stale "EmbeddingsGenerator" ghost comment); fold `upload-tab.tsx` JSX into its page | `features/process/components/process-tab.tsx`, `app/process/page.tsx`, `app/upload/page.tsx` | 40 |
| Micro-dedups: `MasteryDot`→`ConceptMasteryDot` (needs `mt-1` wrapper + `isRollup` prop), `generateUUID`→one `lib/utils.ts` copy, dead exports (`coverHue`, `stripText`, `descendantGroupIds`, `reducer`, `AUTH_SCHEMA`/`USERS_TABLE`, `flattenSections`, un-export `getSessionUser`), stale `ARANGODB_DB` comment in `middleware.ts:8` | various | ~75 |

**Quick-win subtotal: ~945 LOC deleted**, plus 5 npm deps. Each row is independently shippable; run `tsc --noEmit` + `next build` after (note: one *pre-existing* type error at `documents-table.tsx:192` will surface in strict builds — it's not caused by any of these).

---

## 4. Structural moves (in order)

**M1 — Pre-hub fixes (do first; each is a hub prerequisite).** Move `app-nav.tsx`, `breadcrumbs.tsx`, `user-menu.tsx` → `app/_chrome/` (all three are consumed only by `app/layout.tsx`; this makes "components never imports features" zero-exception). Move `shortcuts-help.tsx` (app-global "?" cheat-sheet, sole consumer `app/layout.tsx`) there too. Promote `cleanCourseTitle`+`META_SEG` → `lib/course-title.ts`. Rename `pipeline.ts`'s `CourseStatus` → `CoursePipelineStatus` (collides with `lib/courses.ts`'s union — must land before the hub re-export list). *Risk: trivial; all consumers enumerated and verified.*

**M2 — Cut the hubs + ship `check-hubs.mjs`** (§2). Decide `document-context`'s status here: keep it in `features/documents` but export it through the hub (fits the pattern; it's the source of all learn→documents edges). *Risk: low; mechanical repoints, script catches misses.*

**M3 — Split `pipeline.ts` along its measured ownership line.** Six of its 13 exports (`fetchCoverage`, `fetchJobsLedger`, `fetchSystemStatus`, `setQueuePaused`, `fetchLearnDocuments`, `fetchChapterBuilds` + their types) each have exactly one consumer, and it's a process component — move them to `features/process/api/pipeline.ts` (give the moved slice its own `parseJsonResponse` or export it via the hub). `enqueueChapterBuild`/`cancelChapterBuild`/readiness stay in learn (4 consumers each, cross-feature via allowlist). *Risk: low; full consumer census verified. This kills most process→learn deep imports.*

**M4 — Rehome the pure chapter/TOC algebra.** `chapter-reader.tsx:341-444` exports five pure tree functions + the `Chapter` type that an app page and two siblings import *from a component file*. Move to `features/learn/lib/toc.ts` (lib, not `api/outline.ts` — avoids a type cycle, per verification), export `numberKeyOf` (used by both the helpers and the component), keep the two `normHeading` variants as *two named exports* (they differ in punctuation stripping, not just numbering — a flag is not behavior-preserving). Delete `Chapter` in favor of `CourseChapter`. `chapter-reader.tsx` drops to ~340 lines of pure component. *Risk: low-medium; the normHeading nuance is the one trap.*

**M5 — Split `deep-chapter.tsx` (the big one, own entry).** 1,672 lines, one export, one consumer — so the split is *low blast-radius but high internal risk*. Create `reader/deep-chapter/` with `index.ts` as the folder's import surface (the hub pattern at micro scale) and extract along the seams that already exist: `use-deep-chapter-data.ts` (fetch + prepare/build polling + readiness, ~170), `use-chapter-path.ts` (stage machine, ~110), `use-reader-scroll.ts` (persist/spy/progress — shared with chapter-reader, whose copy has drifted: rAF vs no-rAF; take deep-chapter's hidden-tab-safe version as canonical), `concept-annotations.tsx` (regex engine + mastery tinting + DOM dedupe, ~230), `outline-rail.tsx`, `margin-notes.tsx`, `briefing-card.tsx`, `narration-bar.tsx`, `study-drawer.tsx`, popovers. Orchestrator lands ~420-500 lines. **Risk notes:** (a) the margin-note/dedupe DOM pass is an *impure layout effect feeding the outline rail's state* — it must move together with the rail or stay in the shell, not into the "pure" lib; (b) `deepChapters()` depends on the M4 helpers, so M4 must land first; (c) cross-concern couplings are only 3-4 values (readiness→reload, scroll→markStage, building→poll) — wire them as hook returns, don't share refs. Do it mechanically, no behavior change, one concern per commit.

**M6 — The two shared primitives + the duplication families.** Add `hooks/use-polling.ts` (~30 ln: cancelled flag, visibility pause, optional adaptive interval) and `hooks/use-async-data.ts` — then migrate opportunistically: 9 polling loops in 4 idioms across 8 files, 14 hand-rolled alive-flag effects, course-home's 5 back-to-back fetch effects. Extract `useCourseChapters(docId, tree)` to end the chapter-resolution triplication (`chapter.ts` literally documents "every chapter list must come from here so surfaces cannot drift" — and `app/reader/page.tsx` has *already drifted*: it skips the canonical fetch, so adopting the hook there is a deliberate behavior fix). Consolidate the quiz machines: `useConceptQuizSession` + shared `<QuizChoiceList>` (ConceptQuickCheck is a byte-identical copy of ConceptQuizPanel, including a listener-re-registration bug), `useMcqRun` for exam/drill, one `grade-scale.tsx`, one `useStudyHotkeys` (six keydown handlers, four inconsistent input guards), one token-based concept-kind palette with badge/border/chip variants (three diverged copies; migrate KIND_STYLES' 3 importers — a naive delete breaks the build). Also: `nextNightEpoch`/schedule formatting → `lib/schedule.ts` (a drift in the 2AM rule would silently split "tonight" behavior across three surfaces). *Est. ~500-650 LOC net reduction + the consistency payoff.*

**M7 — Proxy layer hygiene.** Add `proxyLearnBinary(path, req, {range?, cacheControl?})` to `learn-proxy.ts` (3 copy-pasted streaming routes → ~6 lines each), point both `convert-pdf` routes at `getLearnServiceBaseUrl()` (the fallback host currently lives in 3 places), drop the `{tree:[], cards:[]}` endpoint-specific error shape from `proxyLearnGet`, standardize GETs on searchParams pass-through. **Optional bolder step** (verified feasible, medium confidence): one `app/api/learn/[...path]/route.ts` catch-all replaces ~52 trivial files (~480 LOC) — keep pdf/figure/audiobook-file plus the two `section/*` key-reordering routes dedicated, and map `search-index`→`/api/search/index`. Do the helper consolidation now; take the catch-all only if the boilerplate keeps annoying you. Also fix `frontend/ARCHITECTURE.md`'s three stale statements (hash-router description, phantom `learn-tab.tsx`, "~40 proxies").

---

## 5. Deliberately NOT recommended

- **react-query/SWR.** Measured pain doesn't justify it: per-route remounts bound staleness, backend is localhost, single user. The one real stale read (app-nav due badge, wrong up to 5 min after grading) is fixed with the custom-event pattern already proven in `use-reading-theme.ts`. Two 30-line hooks beat a dependency here.
- **Feature-Sliced Design / route colocation.** Both would churn the week-old partition for negative value (see §2).
- **A barrel for `features/learn/api/`.** The no-barrel decision was right; the hub contract makes it unnecessary. Sub-hub exception, stated once, done.
- **Merging `chapter-reader` and `deep-chapter`.** They're different products (plain reading vs. study surface). Merge the *plumbing* (M4-M6), keep the surfaces separate.
- **Folding `features/process` into learn.** The allowlisted-edge rule + M3's api split gets the same hygiene without pretending the build console isn't its own screen.
- **Toast stack replacement (sonner) and `use-shift-select` trimming.** Real but low-value; both work. Batch them into whenever those files are next touched.
- **Merging `use-reading-prefs`+`use-reading-theme`.** The asymmetry is deliberate and documented (theme has a separate writer component; prefs are parent-owned) — a merge as originally proposed would have missed the theme's sole writer. If touched at all, the right fix is narrower: add a storage listener to prefs for the popped-out reader window.

---

**Totals:** ~945 LOC deleted in quick wins, ~500-650 more via M6 dedup, optional ~480 via the proxy catch-all → **~1,450-2,050 LOC net reduction**, plus ~2,500 LOC relocated out of god-files into testable hooks/libs, 5 npm deps dropped, and — the actual centerpiece — a CI-enforced import contract that makes the frontend legible the same way the backend now is.
