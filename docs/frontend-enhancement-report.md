# txt2kg Frontend — Enhancement Report

**Scope:** `assets/frontend` (Next.js 15 / React 19 / Tailwind / Radix).
**Goal:** find bugs, issues, and bloat; raise front-end design quality; optimize for a **learning** context.
**Date:** 2026-06-24
**Method:** Read core surfaces directly + three breadth audits (bloat, Learn-UX, design system) + grep verification of high-value claims + best-practice research. Every claim below is tagged **[verified]** (I confirmed it by grep/read) or **[review]** (flagged by audit, not yet confirmed — check before acting). I deliberately downgraded several "P0" claims that turned out to be false on inspection.

---

## 0. TL;DR

The Learn-first app has a **genuinely good foundation** — calm GitHub-dark theme, Inter/Georgia pairing, a standout warm-paper reading mode, Radix primitives, thoughtful concept-highlight system. The problems are not the core; they're **accumulated sediment**:

1. **Incomplete rebrand.** The brand is now Channel blue (`#4da3ff`), but the token is still named `--nvidia-green`, and literal NVIDIA-green `#76b900` / `rgba(118,185,0)` survives in shipping components. **[verified]**
2. **Large dead/legacy layer.** A whole graph-viz + cloud-DB + remote-GPU stack (neo4j, pinecone, qdrant, arangodb, s3, pygraphistry, webgpu/webrtc, 3d-force-graph/three/d3) sits below the Learn UI, unused — including a single **110 KB** component. **[verified]**
3. **Duplicate sources of truth.** `styles/globals.css` (dead), `hooks/use-toast` vs `components/ui/use-toast` (13 vs 5 importers), `hooks/use-mobile` vs `ui/use-mobile`. **[verified]**
4. **Real but smaller-than-claimed bug surface.** Mostly missing fetch-cancellation flags, list keys by index, and missing empty/loading/error states — not crashes. The audit's "SSR localStorage crash" P0s are **false** (client-only, in `useEffect`, try/catch'd). **[verified false]**
5. **Design maturity ≈ 6.5/10.** Mostly polish + consistency away from 8: finish the rebrand, harden a couple of contrast pairs, tidy mobile, prune motion.

**Design rating: 6.5 / 10** — solid and learning-appropriate, not yet cohesive.

---

## 1. Best-practice lens (what "good" means here)

For a focus-oriented **learning** tool the literature is consistent on a few priorities; I'm using these as the yardstick for the recommendations below:

- **Reduce extraneous cognitive load** — consistent color/type/spacing/button patterns; one way to do each thing; remove anything that doesn't serve the current task. ([Reducing Cognitive Load in UI Design](https://www.ijraset.com/research-paper/reducing-cognitive-load-in-ui-design), [mobile-learning ECL study, NIH](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11422584/))
- **Clear visual hierarchy** — size/weight/color guide attention to the one important thing per screen. ([Webstacks](https://www.webstacks.com/blog/ui-design-best-practices), [Netguru](https://www.netguru.com/blog/best-practices-ui-web-design))
- **Progressive disclosure** — reveal depth on demand; don't show the whole machine at once. Especially apt here: the pipeline/graph machinery should stay tucked behind "Manage material." ([FRAM e-learning UX](https://framcreative.com/insights/latest-trends-best-practices-and-top-experiences-in-ui-ux-design-for-e-learning))
- **Feedback** — every action (quiz answer, mark-read, grade) gets a visible, immediate response.
- **Reading comfort** — 60–75ch measure, ~1.6–1.75 line-height, calm contrast, minimal motion. (The paper reader already nails most of this.)
- **Accessibility** — WCAG AA contrast, keyboard paths, never color-only signals.

The throughline: **subtract before you add.** The single highest-leverage move for this app is removing the dead graph/cloud layer so the Learn experience is the whole product, not a tab on top of an NVIDIA demo.

---

## 2. Bugs & correctness issues

Calibrated. The breadth audit produced ~18 items; I verified the load-bearing ones and dropped/over-rode the false ones.

### Confirmed / high-confidence
- **Redundant tab-state writes** `app/page.tsx:59-77` **[verified]** — `handleHashChange` calls `handleTabChange(hash)` (which sets hash + state) and *then* `setActiveTab(hash)` again; the `<Tabs onValueChange>` and each `TabsTrigger onClick` also both set state. Three overlapping mechanisms for one piece of state. Works, but fragile and a scroll-jump risk (`window.location.hash =` jumps to `#learn`). *Fix: drive tabs purely off `value`/`onValueChange`; sync hash in one `useEffect`.*
- **List keys by array index** `concepts-view.tsx`, `section-concepts-panel.tsx` **[review]** — `key={i}` on concept lists; when sorted by mastery the cards re-mount and lose open/expanded state. *Fix: `key={c.conceptKey ?? c.name}`.*
- **Fetches without a cancel flag** in `review-panel.tsx`, `course-shelf.tsx`, `section-panel.tsx`, `syllabus-tree.tsx` extraction polling **[review]** — rapid section/scope switches can let a stale response overwrite fresh state or set state after unmount. *Fix: the `let active = true; … if (!active) return; return () => { active = false }` pattern (already used correctly in some siblings — make it uniform).*
- **`<style dangerouslySetInnerHTML>` for `.model-dropdown`** `app/page.tsx:32-40,82` **[verified]** — injects global CSS for a `.model-dropdown` rule used in exactly one place. Belongs in `globals.css` or deleted. Minor, but it's the kind of thing that signals "unfinished."

### Downgraded / corrected (do **not** treat as P0)
- ~~"SSR crash: localStorage without window guard" in `use-reading-prefs.ts` / `use-reading-theme.ts`~~ **[verified FALSE]** — both are `"use client"` and touch `localStorage` only inside `useEffect`/event callbacks, wrapped in try/catch. No SSR execution path. Safe as written.
- "Stale closure in `use-keyboard-shortcuts`" **[review, likely minor]** — depends on how callers pass handlers; worth a glance but not a confirmed defect.

**Net:** no confirmed crashers. The real theme is *consistency of the async/lifecycle pattern* and *list-key stability* — cheap, worth doing.

---

## 3. UX gaps for a learning context

These are where the product, not the code, can level up. Prioritized P1 (do) → P2 (polish).

**P1**
- **First-run / empty states.** `LearnTab` and `course-home` render blank while courses/tree/mastery fetch. A learner's first impression can be an empty screen. *Add skeletons + a "No courses yet → Upload your first PDF" call-to-action that deep-links to the Upload tab.* This is the single biggest "feels unfinished" fix.
- **Feedback after a quiz/flashcard answer.** `concept-quiz-panel` records the answer but gives no toast/animation/mastery-delta cue. Learners need to *feel* the loop close. *Add a brief "Recorded · mastery 62%→68%" confirmation.*
- **Error recovery.** `course-home` shows a terminal error string when ArangoDB is down with no Retry. *Add a Retry button (and ideally a friendlier "backend is starting…" message, since this is a local service that may still be booting).*
- **Mode switching is "toggle off," not "switch."** `section-panel` mode buttons toggle a mode to `null` rather than switching between Read / Concepts / Review, so getting between them takes two clicks and reads as "did I break it?" *Make them a single-select segmented control.*
- **Default reading size is `"sm"`** (`use-reading-prefs.ts:12`) **[verified]** — small by default for a reading-first app. *Consider `"base"` as the default.*

**P2**
- **Progress visibility.** Scroll position is persisted but section/course completion isn't surfaced prominently. A learner should always see "where am I / what's next." The study-heatmap is a good start — pull mastery/next-due to the top of the Learn surface.
- **Virtualize large concept lists** (`concepts-view`) if a document yields 100+ concepts. **[review]**
- **Debounce `use-read-sections` localStorage writes** — currently `JSON.stringify`+write on every toggle. **[review]** Negligible unless marking many at once.

---

## 4. Design system & visual quality

Foundation is good; the gaps are coherence and finish.

### Brand consistency (finish the rebrand) — highest design ROI
- **Misleading token name** `globals.css:148-151` **[verified]** — `--nvidia-green` now holds Channel blue. Every `text-nvidia-green` reads green, renders blue. *Rename to `--brand-accent` / `--channel-accent`; alias the old name during migration.*
- **Literal NVIDIA-green still shipping** **[verified]** —
  - `components/nvidia-icon.tsx:20,26,30` (`fill="#76b900"`) — and `nvidia-icon` **is used** on `/rag`, `/graph`, `/login`, `/rag/metrics`. So real green leaks into live secondary pages.
  - `components/fallback-graph.tsx` (6× `rgba(118,185,0,…)`).
  - `components/force-graph-wrapper.tsx` (9× `#76b900`).
  - `globals.css:358,361` `.animate-glow` keyframes (`rgba(118,185,0,…)`).
  *Fix: replace literals with `hsl(var(--brand-accent))` / `#4da3ff`. Most live in code that's a deletion candidate anyway (§5), so deleting may resolve it for free.*
- **Product naming** — header/metadata still say "txt2kg". Fine if intentional, but decide: is the user-facing name "txt2kg" or the Channel brand? Pick one.

### Contrast (WCAG AA)
- **`--muted-foreground` 65% L on `--muted` 12% L** ≈ 4.2:1 **[review]** — passes AA for normal text only by a hair, fails for the many small/secondary labels using it. *Bump to ~72–75% L, or use `text-foreground/60`.*
- **Warm-paper link color `#9a4a2f` on `#f4efe6`** ≈ 4:1 **[review]** — borderline. *Darken to ~`#8b3e1e`.* Body ink on paper is fine (~9:1).
- `.gradient-text` has no solid-color fallback — add `color: hsl(var(--brand-accent))` underneath.

### Typography & reading
- Type scale (clamp-based, `nvidia-build-typography.css`) and Inter/Georgia pairing are good. Measure presets `60/75/90ch` are sensible.
- Reading-first default size is `sm` — see §3.
- Consider a small mobile prose down-scale so `xl` isn't oversized on phones. **[review]**

### Layout / responsive
- **`.container` has no horizontal padding below 1024px** `globals.css:22-34` **[verified]** — content goes edge-to-edge on tablet/phone. *Add `padding: 0 1rem` default, `1.5rem md`, `2rem lg`.*
- **Header packs 6 controls** (RAG, Learn, Info, Settings, Theme, UserMenu) with no mobile collapse. *Move secondary items behind a "more" menu under `sm`.*

### Component consistency & motion
- **Two competing tab systems** — `.startup-tab*` (dead, 0 refs **[verified]**) vs `.nvidia-build-tab*` (live). *Delete `.startup-tab*`.*
- **Focus-ring inconsistency** — some `ring-ring`, some `ring-nvidia-green`. *Standardize on one (`ring-[--brand-accent]`).*
- **Motion for a focus tool** — `.animate-glow` is an infinite pulse (and wrong color); reserve pulsing for alerts only. Shimmer/skeleton/hover-lift are tasteful — keep. **[verified glow unused except 1 ref]**

---

## 5. Bloat & dead code (verified counts)

The audit's per-file KB figures were estimated; these are grep-verified facts.

### Truly dead — safe to delete now **[verified]**
- **`styles/globals.css`** — imported nowhere (`app/globals.css` is canonical). Delete.
- **Dead CSS blocks in `globals.css`** — `0` tsx references each: `.startup-tab*`, `.gradient-bg`, `.gradient-border`, `.modern-table`, `.status-pulse`. Delete (~90 lines). (`.glass-card` = 5 refs, `.animate-glow` = 1, `.model-dropdown` = 1 → keep/relocate, don't blind-delete.)
- **Duplicate hooks** — standardize on one path, delete the other:
  - `use-toast`: `@/hooks/use-toast` (13 importers) vs `@/components/ui/use-toast` (5). Pick the shadcn path or the hooks path, migrate the minority, delete the dupe.
  - `use-mobile`: `hooks/use-mobile.tsx` vs `components/ui/use-mobile.tsx` (near-zero divergence).

### Dead *layer* — bigger decision, big payoff
The entire **graph-visualization + cloud-DB + remote-GPU** stack is unused by the Learn-first UI. `force-graph-wrapper.tsx` alone is **110 KB [verified]**, reachable only via `enhanced-graph-visualization` + `webgpu-3d-viewer`, which are themselves orphaned from the nav. Candidates, pending your call on whether the concept-prerequisite-DAG idea will reuse any of it:
- Components: `force-graph-wrapper`, `enhanced-graph-visualization`, `webgpu-3d-viewer`, `webrtc-graph-viewer`, `remote-gpu-viewer`, `unified-gpu-viewer`, `pygraphistry-viewer`, `dynamic-graph`, `fallback-graph`, `triple-editor`, `neo4j-connection`, `pinecone-connection`, `s3-*`, `nemotron-model-hook`. **[review — confirm each import-count before deleting]**
- API routes: the `pygraphistry/*`, `remote-webgpu*`, `unified-gpu/*`, `neo4j/*`, `pinecone-diag/*`, `vector-db/*` (partly used), `store-documents`, `test-proxy`, `ollama/batch|test` clusters. **[review]**
- Heavy deps that go away with them: `three`, `d3`, `3d-force-graph`, `neo4j-driver`, `arangojs`(?), `@qdrant/*`, `@aws-sdk/*`. Removing the first three alone drops ~1+ MB of JS from the dependency graph. **[review — verify no live importer first]**

> ⚠️ Caveat: this contradicts the project memory that some graph code is *kept on disk to repurpose for the concept prerequisite DAG* (`app/page.tsx:27-29`). Recommendation: **move it to a `legacy/` folder or a branch**, not `rm`, so the Learn build is clean but the code is recoverable.

This also matters because several brand-literal `#76b900` leaks (§4) live in exactly these files — deleting the layer cleans the brand for free.

---

## 6. Suggested roadmap (when you're ready to act)

Sequenced for compounding wins; each phase is independently shippable.

**Phase 1 — Finish the rebrand (½ day, high visible ROI).**
Rename `--nvidia-green → --brand-accent` (+ alias); replace shipping `#76b900`/`rgba(118,185,0)` in `nvidia-icon`, `fallback-graph`, `.animate-glow`; delete `.startup-tab*` + dead CSS; delete `styles/globals.css`; consolidate the duplicate hooks. Pure cleanup, no behavior change.

**Phase 2 — Learn-surface UX (1–2 days, highest learner-felt ROI).**
Empty/first-run states + skeletons; quiz/flashcard answer feedback; error Retry; segmented Read/Concepts/Review control; default reading size → `base`. Make the async-cancel + stable-key patterns uniform.

**Phase 3 — Contrast & responsive polish (½ day).**
Bump `--muted-foreground`; darken paper links; `.container` mobile padding; header "more" menu; one focus-ring token.

**Phase 4 — Prune the dead layer (1 day, big repo-health ROI — decide first).**
Move graph/cloud/GPU components + routes to `legacy/`; drop `three`/`d3`/`3d-force-graph` etc. from `package.json` after confirming no live importer. Measure the bundle before/after.

I haven't changed any files — this is the report you asked for. Tell me which phase to start and I'll implement it (I'd suggest Phase 1: it's safe, fast, and the brand inconsistency is the most visible problem).

---

---

## IMPLEMENTATION STATUS (all phases shipped, build-verified)

Each phase was verified with `tsc` + a full `next build` (which passes — `next.config` sets `ignoreBuildErrors`, so the repo's pre-existing type errors are the baseline, not regressions).

**A recurring correction:** the breadth audits over-flagged. The real code was already high quality — rich inline quiz feedback, one-click mode switching, excellent first-run empty states, skeletons, cancel flags, AAA-level dark contrast all already existed. I verified every claim and **declined to manufacture work**; several reported "bugs"/"gaps" were false and skipped.

### ✅ Phase 1 — Rebrand cleanup
- `--brand-accent` is now canonical (theme-aware); `--nvidia-green` aliases it; added a `brand` Tailwind color for new code. No churn to 51 legacy call-sites.
- Removed literal NVIDIA-green from all live surfaces: `.animate-glow` recolored, `fallback-graph.tsx` (6 canvas literals) recolored, `NvidiaIcon` → Channel `BrandMark` on login + graph (+ dead imports removed from RAG pages); `nvidia-icon.tsx` deleted.
- Deleted dead CSS (`.startup-tab*`, `.gradient-bg`, `.gradient-border`, `.modern-table`, `.status-pulse`) and the unimported, conflicting `styles/globals.css`.
- Consolidated `use-toast` (5 importers → `@/hooks/use-toast`; `components/ui/use-toast.ts` deleted).

### ✅ Phase 2 — Learn-surface UX (small by design — surface was already strong)
- Default reading size `sm` → `base`.
- `course-home` error state gained a **Retry** button (`onRetry` threaded from `LearnTab`) + "backend may still be starting" copy.
- `review-panel` queue fetch gained a cancel flag (the one real stale-overwrite race).
- `concepts-view` "ready" pills: `key={i}` → `key={c.conceptKey}`.

### ✅ Phase 3 — Contrast & a11y (scoped to what was real)
- Added global **`prefers-reduced-motion`** support (was entirely absent; 4 infinite animations) — WCAG 2.3.3, matters for long study sessions.
- Paper-reading link `#9a4a2f` → `#8a3c1e` (~5.4:1 → ~6.8:1 AAA reading comfort).
- *Skipped* (verified NOT real): `.container` padding (every call-site already has `px-*`), `muted-foreground` bump (measured 7.8:1 dark / 4.6:1 light — already AA/AAA).

### ✅ Phase 4 — Prune dead layer (moved to `legacy/`, deps kept)
- Computed true import-reachability from all 96 Next.js entry points; **33 provably-unreachable files** moved to `legacy/` (paths mirrored for trivial restore): graph-viz, GPU/remote viewers, cloud-DB connection panels, triple editor/viewer, nemotron, the paused `EditTab`/`VisualizeTab`, superseded learn panels (`flashcards`/`quiz`/`socratic`), and dead-only helpers.
- `legacy/` added to `tsconfig` exclude → inert. `package.json` untouched (per your call).
- **Side benefit:** tsc errors dropped 71 → 48 (the dead layer carried ~23 of them). Build still green.
- **Kept on purpose:** 14 unused `ui/*` shadcn primitives + `use-mobile` dup — harmless design kit, not the target layer. Restore any `legacy/` file by moving it back to its mirrored path.

---

### Confidence notes
- **[verified]** items: confirmed by grep/file read during this audit.
- **[review]** items: surfaced by breadth audits over many files; correct in spirit but confirm the exact file:line before editing (sub-agent line numbers and KB sizes were sometimes approximate).
- I explicitly **rejected** the "SSR localStorage crash" P0s after reading the hooks — calibrate trust in any remaining un-verified audit claims accordingly.

**Sources (best practices):** [Reducing Cognitive Load in UI Design](https://www.ijraset.com/research-paper/reducing-cognitive-load-in-ui-design) · [Mobile-learning extraneous-cognitive-load study (NIH)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11422584/) · [UI Design Best Practices 2025 (Webstacks)](https://www.webstacks.com/blog/ui-design-best-practices) · [UI Web Design Best Practices (Netguru)](https://www.netguru.com/blog/best-practices-ui-web-design) · [E-Learning UI/UX Trends (FRAM)](https://framcreative.com/insights/latest-trends-best-practices-and-top-experiences-in-ui-ux-design-for-e-learning)
