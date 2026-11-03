# UI spec (v0.25.0, 2026-11-03)

The contract every screen is built to. The evidence behind it is `docs/ui-inventory.md`. The
human chose what stays and what goes. The agent made the UI calls, which were delegated.

## 1. What stays, what goes

Reading, Exam packs, Review (FSRS), Concepts and Skeleton recall stay, along with the admin tools
for upload, process and edit. **Deleted from the frontend:** the old practice session, old exam mode and
Match game (`surfaces/practicing/{practice-session,exam-mode,match-game}.tsx`, the
`/courses/[id]/practice` route), the course editor's Practice tab and `practice-editor.tsx`, the Fluency stat,
and their gateway clients. The backend routes and stored rows are left alone, and only the counts change (§5).

## 2. Routes and navigation

Paths stay as they are. Moving URLs is churn with no payoff for one user.

| Route | Screen |
|---|---|
| `/courses` | **Library**: one Today panel on top, then the course grid |
| `/courses/[id]` | **Course home**: one primary action, then the five study tiles, then stats |
| `/courses/[id]/review` | **New.** Course-wide review: every due concept, skeleton and chapter card in this course |
| `/courses/[id]/chapter/[[...scope]]` | Guided reading (with the study drawer) |
| `/courses/[id]/read` | The book (PDF, or the markdown reader) |
| `/courses/[id]/concepts` | Concepts |
| `/courses/[id]/skeleton` | Skeleton recall |
| `/courses/[id]/packs`, `/packs/[key]?tab=today\|learn\|exam\|results` | Exam packs. The tab lives in the URL |
| `/study` | Plan (the calendar/agenda). Reached from the Library Today panel and nav |
| `/upload`, `/process`, `/courses/[id]/edit`, `/styleguide` | Admin |
| `/reader` | Pop-out reader, unchanged |

**Header nav:** `Library` · `Plan` (with the due badge) · `Admin ▾` (Upload, Process, Kit).
The word is "Library", never "Learn" or "Courses", in nav, breadcrumbs and buttons alike.

**Back:** breadcrumbs are the single back affordance on every course route, and they know
every sub-route (Library › Course › Review | Read | Chapter title | Concepts | Skeleton | Exam
packs › Pack title | Edit). Surfaces drop their own "Back to course / Course / Back / All packs"
buttons. The exception is full-screen reading chrome, which may keep a close or back control.

## 3. The daily path

**Library Today panel:** one line per course that has anything due. Each line has a primary button
picked in order: `Review N` if reviews are due, else the active pack's next step (`Continue
<pack>`), else `Continue reading <chapter>`. A `Plan` link sits at the right. Nothing else goes
in the panel.

**Course home**, top to bottom:
1. Hero with the title and one primary button, picked by the same rule (Review → pack → reading).
2. Five tiles: Review (due count), Exam packs (ready packs plus next step), Read (continue
   chapter), Concepts (count), Skeleton recall.
3. The syllabus tree.
4. Stats and the heatmap, compact, at the bottom.

## 4. One visual system

- **Tokens:** `globals.css` zinc tokens are the only palette. They already equal the fleet values.
  Dark-only. No `dark:` utilities, no raw Tailwind palette colours (`text-red-500` and similar),
  no inline hex/rgb. Words use the `-text` tokens, never fill tokens (`text-brand` becomes the
  accent-text token). Every colour, type size and face must pass `fleet-ui/check.sh`.
- **Study theme everywhere you study:** course home, review, concepts, skeleton, packs, plan
  and library sit on `.study-page` (the graph-paper ground). The one card is `.study-sheet`.
  Reading keeps its own paper surface.
- **`fleet-study.css` stays a byte copy of fleet-ui's study block.** It is never edited here.
  The sticky bar fix goes upstream first: `.study-bar { top: var(--fleet-header-h, 0) }`.
  Re-copy it, then alias `--fleet-header-h` in `globals.css`.
- **Kit (`src/kit`) is the only source of UI pieces:**
  - `kit/ui`: shadcn primitives. Every button is `<Button>`, with no hand-written `<button
    className=...>` except inside kit components.
  - `kit/study`: typed wrappers over the study classes: `StudyPage`, `Sheet`, `Tabs`, `Stepper`,
    `Choice`, `Note`, `Track`, `Clock`, `AnswerGrid`.
  - `kit/patterns`: `PageHeader`, `StatTile`, `ListRow`, `StatusPill`, `EmptyState`, `MeterBar`,
    `ProgressRing`, `Skeletons`.
  - `kit/data`: `AsyncView`, `ErrorNotice` (§5).
- **Size:** no component file over ~350 lines. Data hooks live in `use-*.ts` next to the surface.
  Views stay presentational.

## 5. Data contract

- **`@tanstack/react-query` v5.** Mount one `QueryClientProvider` in the root layout.
- **`gateways/api/http.ts`:** `ApiError {status, message, detail}`, which keeps FastAPI's 422
  detail arrays. Every gateway function takes an optional `AbortSignal`.
- **`kit/data/query-keys.ts`:** one key factory (`qk.documents`, `qk.studyDebt`,
  `qk.reviewQueue(doc, scope)` and the rest). Data goes through `useApi(key, fn, opts)` and
  `useApiMutation(fn, {invalidates})`.
- **`AsyncView`:** renders loading (skeleton), error (an `ErrorNotice` with message and Retry),
  empty (`EmptyState`) or children, the same way on every screen.
- **No silent catches.** Every `catch(() => undefined)` or `.catch(() => {})` on a request is gone.
  Grades are mutations: the card advances only on success. On failure it shows "Not saved ·
  Retry". A 401 anywhere redirects to `/login`.
- **Documents context:** a query with an error state. `CourseFallback` tells "couldn't load
  your library · Retry" apart from "not found".
- **Counts that can reach zero.** `study-debt` and every due badge count only what the course
  review serves (concept, skeleton, chapter rows). Pack rows show inside their pack. Practice
  rows are no longer counted. The backend `build_review_queue` accepts a whole-course scope, which
  backs `/courses/[id]/review`.

## 6. Not in scope

New study features, framework changes, database migrations, deleting stored rows, and backend
behaviour beyond the course-wide review scope and the debt filter.
