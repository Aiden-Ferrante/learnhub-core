# GUI redesign plan — polish the identity, keep the soul

Direction chosen 2026-07-14: **evolve the current GitHub-dark + Channel-blue identity**
(no rebrand), staged over milestones that each ship usable. Priorities: design system,
real routes, study UX, reader immersion.

## Current-state diagnosis (what "dated / cluttered" actually is here)

- **One page, hash tabs.** `app/page.tsx` switches `#learn/#upload/#configure`; course
  shelf ⇄ course home is component state inside `learn-tab.tsx`. No shareable URLs, no
  real back button, everything in one JS chunk (the 1,670-line deep-chapter loads on the
  shelf).
- **No shared primitives.** Stat tiles, progress rings, status pills, list rows, meters
  are hand-rolled per file (course-home, course-shelf, process-dashboard each have their
  own). Restyling anything means touching every copy.
- **Template leftovers.** `build-h1…build-body` clamp() typography and `.build-card`
  come from the NVIDIA template era; UI text sizes jump around; cards are sparse with
  centered content and don't use desktop width well.
- **Good bones:** real token system in `app/globals.css` (GitHub-dark palette,
  `--brand` #4da3ff, light+dark, radius 0.75rem), shadcn primitives in `components/ui`,
  `tailwindcss-animate`, reading-prefs/theme hooks already exist.

## Milestone 0 — land the Tailwind purge fix (tiny, first)

`tailwind.config.ts` now scans `features/**` (fix sitting uncommitted in the tree —
without it the deployed UI collapses to one column). Commit, rebuild `app` image.
Take before-screenshots of every surface as the baseline.

## Milestone 1 — the kit (design-system foundation) · size M

Everything later is assembly if this exists.

- **Tokens**: keep palette + brand; add a documented spacing scale, two elevation
  levels (border-only card = default, shadow card = overlay), status colors mapped to
  the domain: `mastered / ready / due / fading / building / error`.
- **UI type scale** (12/13/14/16/20/24, Inter) replaces `build-h*` for chrome; the
  reading surface gets its own scale in Milestone 4. Delete `styles/build-typography.css`
  when the last consumer dies.
- **Primitives** (new `components/patterns/`): `PageHeader` (title+desc+actions),
  `StatTile`, `ProgressRing` (the conic mastery ring, extracted), `MeterBar`,
  `StatusPill`, `ListRow`, `EmptyState`, `Skeleton` variants, `SectionCard`.
- **Motion baseline**: one duration/easing pair for hover/expand, skeletons instead of
  spinners, `prefers-reduced-motion` respected.
- **`/styleguide` dev route** rendering the whole kit — doubles as visual regression
  (would have caught the purge bug instantly).

## Milestone 2 — real routes + app shell · size M-L

- Promote hash tabs to routes: `/` (Today/home), `/courses`, `/courses/[doc]`,
  `/courses/[doc]/chapter/[scope]` (deep chapter), `/process`, `/upload`; keep `/reader`.
  Old `#learn` URLs redirect.
- Persistent shell: slim top nav (Learn · Process · Upload, due-count badge), breadcrumbs
  on course/chapter pages, per-route `loading.tsx` skeletons, real code-splitting.
- Course/scope selection moves from context+localStorage into the URL where it's
  navigation state (context stays for prefs). Risk: `learn-tab.tsx`'s view state machine
  is load-bearing — migrate it screen-by-screen behind the new routes.

## Milestone 3 — shelf + course home (the storefront) · size M

- **Shelf**: denser left-aligned cards in a width-filling grid; per-book identity via a
  generated cover strip (gradient hashed from title); title/author/progress bar/mastery %,
  due badge, last-opened; primary quick actions on the card (Continue · Review); groups
  as refined sidebar; real empty state.
- **Course home**: simplified hero (ring + one Continue CTA), stat tiles → compact
  StatTile strip, Practice rows → three action cards with due counts, heatmap sized
  properly, syllabus tree gets mastery heat + aligned numbering, Today plan pinned top.

## Milestone 4 — reader immersion · size L

- Typography pass on deep-chapter/chapter-reader/book-reader: ~68ch measure, optional
  serif for body (reading-prefs hook already exists), heading rhythm, KaTeX/code/figure
  styling, consistent light/dark/sepia reading themes.
- Focus mode: chrome recedes on scroll, minimal progress rail, `j/k` section nav
  (shortcuts-help scaffold exists), resume-position that feels reliable.
- Concept overlay: margin-note/popover treatment instead of heavy panels; learn-path
  stage drawers get one consistent behavior.
- **Paired refactor**: split `deep-chapter.tsx` (1,670 lines) into briefing / overlay /
  rail / section components while reskinning — one pass, not two.

## Milestone 5 — study UX layer · size M

- **Command palette** (⌘K, shadcn cmdk): jump to course/chapter/concept, start
  review/drill, semantic search across the library from anywhere.
- Review session polish: grade keys 1–4, card transition motion, session progress,
  end-of-session summary.
- `?` opens shortcuts overlay everywhere; per-surface hint row.
- Background-job toasts app-wide (pipeline finishes → toast with link), polling first,
  SSE later.

## Parking lot

Mobile pass · light-theme audit · Tailwind v4 migration · SSE job progress ·
re-enable `tsc` in builds (task chip exists) · course cover images from PDF page 1.

## Working rules (every milestone)

1. Verify in preview at 1440/768/375 before calling done; screenshot before/after.
2. One commit per milestone (or per surface within a milestone), rebuild the `app`
   image (:3001) at milestone end — never leave it stale.
3. New styles come from tokens/primitives; a PR that hand-rolls a stat tile is wrong.
4. Anything moved into `features/` must be covered by Tailwind `content` globs.
