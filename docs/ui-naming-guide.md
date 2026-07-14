# Learn Hub — UI Naming Guide

A shared vocabulary for every screen, panel, button, and display in the Learn Hub
frontend. When you want to change something, point at its **name** here and I'll know
exactly which element and source file you mean.

- Frontend root: `assets/frontend/`
- Every entry cites its **source file + approx line + component** in parentheses so a
  change request maps straight to code.
- Naming convention: where an element has visible text I use that text in quotes
  (e.g. the **"Build chapter" button**); where it doesn't I give it a short descriptive
  name (e.g. the **mastery ring**).

> **Naming gotcha, true everywhere below:**
> - The brand accent is **brand blue** (#4da3ff), exposed as the `brand` token (`text-brand` / `bg-brand`).
> - The nav item labeled **"Configure"** shows a screen titled **"Process"**. Same page.

---

## 0. How the app is laid out (the big picture)

The app has **no top tab bar**. The **Learn** surface *is* the app and owns the whole
screen. Upload and Process/Configure are sub-pages you drop into and come back from.

```
Login page  ──►  LEARN (the whole app)
                   │
                   ├─ Course Shelf ............ landing grid of all your courses
                   │     └─ Course Home ....... one course's dashboard
                   │            ├─ Deep Chapter ... the primary read+study surface
                   │            ├─ PDF Book View ... the raw source PDF
                   │            ├─ Book Reader ..... lighter chapter reader (+ pop-out /reader window)
                   │            ├─ Concepts View ... browse every concept
                   │            ├─ Drill View ...... adaptive weak-spot practice
                   │            ├─ Free Recall ..... brain-dump a chapter
                   │            └─ Ask this book ... semantic search / grounded Q&A
                   │
                   ├─ Upload sub-page ......... drop in PDFs/docs   (via "Upload" button)
                   └─ Process sub-page ........ build chapter concept layers  (via "Process" button)
```

- The top-level router lives in [app/page.tsx](../assets/frontend/app/page.tsx); it defaults to `#learn` and
  shows a **"Back to courses" link** (top-left chevron) whenever you're on Upload/Configure.
- `LearnTab` ([components/tabs/LearnTab.tsx](../assets/frontend/components/tabs/LearnTab.tsx)) is a **pure router** with no chrome of
  its own — it just swaps between the views above based on where you clicked.
- **Study always lands in Deep Chapter.** Every "study / quiz / review / exam" entry point
  opens the Deep Chapter surface, sometimes with a side **drawer** already open.

### Section index
1. [Login page](#1-login-page)
2. [Global chrome](#2-global-chrome-shared-everywhere) — logo, user menu, theme, model picker, settings
3. [Course Shelf](#3-course-shelf) — the landing grid + groups sidebar
4. [Course Home](#4-course-home) — one course's dashboard
5. [Deep Chapter](#5-deep-chapter-the-primary-readstudy-surface) — the main read+study surface
6. [Other reading surfaces](#6-other-reading-surfaces) — Book Reader, Chapter Reader, PDF Book View, Chapter Walk
7. [Reading chrome](#7-reading-chrome-shared) — the "Aa" popover + Paper/Dark toggle
8. [Study & testing modes](#8-study--testing-modes) — quiz, review, drill, exam, free recall, lesson, lock-in
9. [Concepts & side panels](#9-concepts--side-panels) — concept cards/detail, Ask, Audiobook, syllabus tree, shortcuts
10. [Upload sub-page](#10-upload-sub-page)
11. [Process / Configure sub-page](#11-process--configure-sub-page)
12. [Shared visual language](#12-shared-visual-language) — mastery dots, kind colors, keyboard keys

---

## 1. Login page

Route [app/login/page.tsx](../assets/frontend/app/login/page.tsx). A single centered card.

- **Login card** — the bordered, centered box holding everything. (`login/page.tsx` ~46, `LoginForm`)
- **Brand mark + "Learn Hub" heading** — the graph logo over the gradient "Learn Hub" wordmark and "Sign in to your workspace" subtitle. (`login/page.tsx` ~48)
- **"Username" field** / **"Password" field** — the two credential inputs (password is masked). (`login/page.tsx` ~55, ~66)
- **Login error banner** — red inline message: "Invalid username or password." / "Sign-in failed. Please try again." (`login/page.tsx` ~77)
- **"Sign in" button** — full-width; shows lock + "Sign in", or spinner + "Signing in…". (`login/page.tsx` ~83)
- **Provisioning note** — footnote "Accounts are provisioned by the administrator." (`login/page.tsx` ~89)

---

## 2. Global chrome (shared everywhere)

The header/footer widgets that live outside any single screen.

- **Brand mark (logo)** — the small knowledge-graph SVG; decorative, renders brand-blue. (`brand-mark.tsx` ~3, `BrandMark`)
- **User menu (account chip)** — top-right pill: user icon + your name + a sign-out icon. (`user-menu.tsx` ~8)
  - **Sign-out button** — the log-out icon inside the chip; tooltip "Sign out". (`user-menu.tsx` ~18)
- **Theme toggle** — round Sun/Moon icon button; flips light/dark. (`theme-toggle.tsx` ~28, `ThemeToggle`)
- **Settings button (gear)** — round gear icon; opens the Settings modal. (`settings-modal.tsx` ~457)
- **Model selector (model picker)** — bordered pill showing the current model + chevron; menu opens **upward** from a bottom bar. States: "Loading models…", "No models available". (`model-selector.tsx` ~250, `ModelSelector`)
  - **"Select Model" dropdown** — the open menu, grouped under "Ollama (Local)", "vLLM (GPU-accelerated)", "NVIDIA API (Cloud)"; each row = icon + name + description, active row highlighted. Has a **Refresh models** icon button. (`model-selector.tsx` ~263)

### Settings modal
Titled **"Settings"**, opened by the gear. A **category dropdown** switches panels: "Graph Database", "Vector Database", "S3 Storage", "Embeddings", "Model Management". (`settings-modal.tsx` ~483)

- **Graph Database panel** — "Database Type" (Neo4j / ArangoDB) + the matching connection sub-card (URL / DB name / username / password with show-hide eye). (`settings-modal.tsx` ~523)
- **Vector Database panel** — single "Qdrant URL" field. (`settings-modal.tsx` ~672)
- **S3 Storage panel** — Endpoint / Bucket / Access Key / Secret Key; a green **Connected banner** ("{n} file(s) in bucket") and a **Connect/Update button**. (`settings-modal.tsx` ~710)
- **Embeddings panel** — "Provider Type" (Local Sentence Transformer / NVIDIA API) + model name. (`settings-modal.tsx` ~816)
- **Model Management panel** — "Ollama Model Configuration": a **Refresh button**, a green/red connection banner, the **"Available Models" checklist** with "All"/"None" links, and **"Save Settings"**. (`settings-modal.tsx` ~877)
- Every panel ends in a brand-blue **"Save Settings" button**.

---

## 3. Course Shelf

The landing grid of all courses. Two columns: **groups sidebar** (left) + **course grid** (right).
([components/learn/course-shelf.tsx](../assets/frontend/components/learn/course-shelf.tsx), `CourseShelf`)

### Shelf header (top bar)
- **"Learn" title + subtitle** — cap icon + "Learn" + "Your courses — each one built from a document you processed." (`course-shelf.tsx` ~321)
- **"Upload" button** — top-right pill (plus icon); jumps to the Upload sub-page. (`course-shelf.tsx` ~332)
- **"Process" button** — top-right pill (lightning icon); jumps to the Process/Configure sub-page. (`course-shelf.tsx` ~342)

### First-run empty state (zero courses)
- **"Start your first course" panel** — big dashed card. (`course-shelf.tsx` ~356)
- **Upload→Process→Study step chips** — the "1 · Upload / 2 · Process / 3 · Study" pills. (`course-shelf.tsx` ~365)
- **"Upload a document" button** — the green primary CTA. (`course-shelf.tsx` ~372)

### Course grid
- **Course search box** — "Search courses…" input, appears only above 4 courses. (`course-shelf.tsx` ~401)
- **Course card** — one tile per course; the whole face is clickable → opens Course Home. (`CourseCard`, `course-shelf.tsx` ~93)
  - **Cover strip** — the book-open banner across the card top.
  - **Course title** / **format tag** / **course description**.
  - **Status badge** — "Ready" / "Processing" / "Not processed". (`course-shelf.tsx` ~179)
  - **Sections count** — e.g. "12 sections" (live course only).
  - **Mini mastery ring** — small 48px ring with overall % in the corner. (`MiniRing`, `course-shelf.tsx` ~78)
  - **"Move to group" card menu (⋮)** — hover-reveal dots menu; group checkboxes + "New group…". (`course-shelf.tsx` ~118)
- **"New course" tile** — dashed plus-tile at the grid's end → Upload. (`course-shelf.tsx` ~437)

### Groups sidebar (left rail)
- **"Groups" header** + **"New" button** (opens the group dialog). (`group-sidebar.tsx` ~173)
- **"All courses" row** — clears the group filter; shows total count. (`group-sidebar.tsx` ~186)
- **Group row** — chevron + folder icon + name + count; click filters to it. (`GroupRow`, `group-sidebar.tsx` ~63)
  - **Group actions menu (⋮)** — hover dots → "Rename" / "Delete". (`group-sidebar.tsx` ~102)
- **Group dialog** — shared **New / Rename** modal: "Name" field, "Parent group" dropdown, "Cancel", "Create"/"Save". (`course-shelf.tsx` ~462)

---

## 4. Course Home

One course's dashboard. ([components/learn/course-home.tsx](../assets/frontend/components/learn/course-home.tsx), `CourseHome`)

### Breadcrumb
- **"Courses" back link** (top-left chevron → shelf) + **course-title breadcrumb**. (`course-home.tsx` ~270)

### Hero / overview card
- **Course header** — cap icon + title + description.
- **Mastery ring** — large 80px ring with overall %. (`MasteryRing`, `course-home.tsx` ~74)
- **Stat tiles** — four boxes: "Sections", "Studied", "Need review", "Overall". (`StatTile`, `course-home.tsx` ~89)
- **Headline nudge** — one-line status (flame = sections faded / sparkle = start a quiz / sparkle = on top of it). (`course-home.tsx` ~248)
- **"Today" action row** (inside the hero):
  - **"Continue" / "Start reading" button** — primary; resumes the last chapter+stage or starts fresh. (`course-home.tsx` ~311)
  - **"Review · N due" button** — opens whole-course review (only when reviews are due). (`course-home.tsx` ~327)
  - **Next-chapter build control** — a build-status chip, or a **"Build '<chapter>' tonight" button** (wand) scheduling a 2am build. (`course-home.tsx` ~333)

### Practice card
Header "Practice" over up to three tiles. (`PracticeTile`, `course-home.tsx` ~366)
- **"Review" tile** — spaced-repetition cards due now; badge "N due" / "Caught up".
- **"Drill weak spots" tile** — adaptive MCQ on weakest concepts → Drill view.
- **"Free recall" tile** — close-the-book brain dump → Free Recall view.

### Other Course Home blocks
- **Error panel** + **"Retry" button** (backend-not-ready guidance). (`course-home.tsx` ~405)
- **"No syllabus outline" empty panel** + **"View concepts" button**. (`course-home.tsx` ~424)
- **Forecast banner** — amber "N concepts due for review now" + **"Review N now" button**. (`course-home.tsx` ~446)
- **Study activity heatmap** — GitHub-style contribution grid; header "Study activity" + "N reviews this year", day cells, "Less/More" legend. (`StudyHeatmap`, `study-heatmap.tsx` ~106)
- **"Pick up where you left off" rail** — weak-section cards with mastery bars. (`course-home.tsx` ~477)
- **"Recent mistakes"** — rows of past wrong answers → open that section's review. (`course-home.tsx` ~513)
- **"Course outline" card** — the syllabus panel + a toolbar of entry buttons:
  - **"Read the book"** → PDF Book View. (`course-home.tsx` ~574)
  - **"Deep read"** → Deep Chapter. (`course-home.tsx` ~584)
  - **"Ask this book"** → Ask panel. (`course-home.tsx` ~596)
  - **"Concepts · N"** → Concepts view. (`course-home.tsx` ~608)
  - **"Study whole course"** → study with no section scope. (`course-home.tsx` ~621)
  - **Syllabus tree** body (see §9). (`course-home.tsx` ~632)

---

## 5. Deep Chapter (the primary read+study surface)

The richest surface: header chrome, a **path rail**, the annotated **reader spine**, margin
notes, popovers, and slide-in **study drawers**. Every "study" action lands here.
([components/learn/deep-chapter.tsx](../assets/frontend/components/learn/deep-chapter.tsx), `DeepChapter`)

### Header
- **Course back button** — chevron + course title → back to course. (`deep-chapter.tsx` ~1040)
- **Chapter picker** — center title + chevron; opens the **chapter dropdown** (each row has a **readiness dot**). (`deep-chapter.tsx` ~1044)
- **"deep layer N/M" indicator** — explained/total concept count. (`deep-chapter.tsx` ~1085)
- **Building / queued status** — spinner+"building" or clock+"queued" (+ an **X cancel-build** button). (`deep-chapter.tsx` ~1090)
- **"Build chapter" button + menu** — wand button → "Build now" / "Build tonight · 2:00 AM". (`deep-chapter.tsx` ~1116)
- **"Narrate" button** — headphones; toggles the narration mini-player (only if audio exists). (`deep-chapter.tsx` ~1133)
- **Reading controls ("Aa")** — text size/width popover; here it hosts the **"Highlight concepts" switch**. (`deep-chapter.tsx` ~1146) — see §7.
- **Reading theme toggle** — Paper/Dark. (`deep-chapter.tsx` ~1156) — see §7.
- **"Prev" / "Next" chapter buttons** — far right. (`deep-chapter.tsx` ~1157)

### Path rail (the guided-journey strip)
- **Path stage chips** — a row of pills, one per stage (**orient / read / skeleton / quizzes / exam / lockin**); each shows a done-check, next-dot, or muted-dot. Clicking jumps to that stage (scrolls or opens the matching drawer). (`deep-chapter.tsx` ~1174)

### Narration mini-player (when "Narrate" is on)
- **Audio player** + **playback-speed button** (cycles 1→2×) + **close (X)**. (`deep-chapter.tsx` ~1211)

### Left rail — "In this chapter"
- **"In this chapter" outline rail** — sticky section links with scroll-spy highlight. (`deep-chapter.tsx` ~1267)

### Reader spine (center)
- **Chapter briefing card** — collapsible "Chapter briefing"; folds to "oriented" once done. Contains:
  - **"You'll be able to" list** (objectives) / **"Watch for" list** (cautions). (`deep-chapter.tsx` ~1334)
  - **"The road through · N sections" disclosure**. (`deep-chapter.tsx` ~1364)
  - **"I'm oriented — start reading" button**. (`deep-chapter.tsx` ~1379)
  - **Key-concept chips** — color-coded pills; click → concept popover. (`deep-chapter.tsx` ~1387)
- **Reader spine (annotated prose)** — the chapter text, with **inline concept terms** (underlined, click → popover). (`deep-chapter.tsx` ~1413)
- **"Close the loop" panel** — the study-action bar after the prose:
  - **"Learn top-down"** (→ walk drawer), **"Quiz"**, **"Exam"**, **"Lock in"**, **"Review · N due"**, **"Tutor"**, **"Listen"**, **"Next: <title>"**. (`deep-chapter.tsx` ~1422)

### Margins & overlays
- **Margin note (sidenote)** — right-margin concept card on wide screens (≥1440px). (`deep-chapter.tsx` ~1470)
- **Concept popover** — floating card on a clicked concept: mastery dot, name, kind badge, signal, deep explanation, "Builds on:" prereqs, a **"Check yourself:" reveal**, and X close. (`deep-chapter.tsx` ~1513)
- **"Explain this" chip** — floating pill above a text selection → the **Explain drawer** (quoted passage + grounded answer + citations). (`deep-chapter.tsx` ~1560)
- **Study drawer** — the right-side slide-in that hosts each mode. Titles: "Chapter quiz", "Review", "Chapter exam", "Learn — top-down walk", "Lock in", "Tutor", "Listen". (`deep-chapter.tsx` ~1607)

---

## 6. Other reading surfaces

### Book Reader (lighter chapter reader with syllabus sidebar)
([components/learn/book-reader.tsx](../assets/frontend/components/learn/book-reader.tsx), `BookReader`)
- **"Course outline" back button** (chevron + text) / **course-title label**. (`book-reader.tsx` ~161)
- **Float reader button** — picture-in-picture icon; always-on-top floating window. (`book-reader.tsx` ~172)
- **Pop out reader button** — external-link icon; opens the `/reader` route in a new window. (`book-reader.tsx` ~182)
- **Reading theme toggle** + **"Aa" reading controls** (with a **Focus mode** toggle here). (`book-reader.tsx` ~191)
- **Syllabus sidebar (left pane)** + **pane resize handle** + **reader pane**. (`book-reader.tsx` ~205)

### Chapter Reader (the shared chapter pane; also the pop-out /reader window)
([components/learn/chapter-reader.tsx](../assets/frontend/components/learn/chapter-reader.tsx), `ChapterReader`)
- **Sticky "you are here" bar** — **Prev / Next chapter buttons**, **chapter title/breadcrumb**, **page badge ("p.N")**, **chapter counter ("3/12")**, **Find button**, and a thin **reading-progress bar**. (`chapter-reader.tsx` ~217)
- **Find-in-chapter box** — floating "Find in chapter" input + **match counter** + up/down/close. (`chapter-reader.tsx` ~273)
- **Chapter content area** + **"Top" scroll-to-top button**. (`chapter-reader.tsx` ~301, ~331)
- The pop-out window ([app/reader/page.tsx](../assets/frontend/app/reader/page.tsx)) wraps this with a **"Toggle outline" button** and the theme toggle in its own top bar.

### PDF Book View (the raw source PDF)
([components/learn/pdf-book-view.tsx](../assets/frontend/components/learn/pdf-book-view.tsx), `PdfBookView`)
- **Course back button** + **"Original PDF" badge**. (`pdf-book-view.tsx` ~102)
- **"Window" button** (open PDF in its own window) + **"Full screen" / "Exit" button**. (`pdf-book-view.tsx` ~111)
- **PDF iframe** — the native viewer. Falls back to Book Reader when no PDF exists. (`pdf-book-view.tsx` ~134)

### Chapter Walk (the top-down "learn the chapter" walkthrough)
The **walk drawer** opened by "Learn top-down". ([components/learn/chapter-walk.tsx](../assets/frontend/components/learn/chapter-walk.tsx), `ChapterWalk`)
- **Step title** + **step counter ("Step N / M")**. (`chapter-walk.tsx` ~215)
- **Recall step** — **recall prompt**, **recall textarea**, **"Reveal" button**, **revealed section list**, and **self-grade buttons** ("Missed a lot" / "Partial" / "Most of it" / "Nailed it") + **"Try again"**. (`chapter-walk.tsx` ~241)
- **Concept step** — embeds the **Section concepts panel** (§9). (`chapter-walk.tsx` ~324)
- **Footer nav** — **"Back"**, and **"Continue" / "Finish chapter"**. (`chapter-walk.tsx` ~329)

---

## 7. Reading chrome (shared)

These two appear on multiple reading surfaces — call them by these names everywhere.

- **"Aa" reading controls popover** — ghost "Aa" button opens it. Contains a **"Text size" stepper** (– / +), a **"Width" selector** (Narrow / Normal / Wide), an optional **"Focus mode" toggle**, and an **extras slot** (Deep Chapter injects "Highlight concepts" here). (`reading-controls.tsx` ~32, `ReadingControls`)
- **Paper/Dark toggle** — a two-option segmented switch: **"Paper"** (warm cream serif) and **"Dark"** (app-native). (`reading-theme-toggle.tsx` ~37, `ReadingThemeToggle`)

---

## 8. Study & testing modes

All of these open as **study drawers** inside Deep Chapter (or full views from Course Home).
A shared **AnswerFeedback banner** (brand-tinted callout with the concept's "why" + a
"From the text:" source line) appears after wrong answers in several of them.
(`answer-feedback.tsx`, `AnswerFeedback`)

### Concept Quiz ("which concept matches this description?")
([components/learn/concept-quiz-panel.tsx](../assets/frontend/components/learn/concept-quiz-panel.tsx), `ConceptQuizPanel`)
- **Question stem** + **answer choice buttons** (numbered 1–9 key badges). (`~154`)
- **Application-questions status strip** ("Writing application questions… n/total") + **"Prepare all" button**. (`~127`)
- **Result verdict line** ("✓ Correct" / "✗ Answer: …") + **feedback banner** + **"Next" button** (↵). (`~184`)

### Review (spaced repetition)
([components/learn/review-panel.tsx](../assets/frontend/components/learn/review-panel.tsx), `ReviewPanel`)
- **Queue counter** ("N due · N new") + **position counter** + **progress bar**. (`~140`)
- **Concept name heading** + **kind badge** + **recall prompt** ("Recall what this concept means."). (`~157`)
- **"Reveal" button** (space) → **revealed signal + source**. (`~169`)
- **Grade buttons** — "Again" (1) / "Hard" (2) / "Good" (3) / "Easy" (4). (`~185`)
- **Empty/done state** — "🎉 Session done — N reviewed" + **"Review again" button**. (`~109`)

### Drill (adaptive weak-spot practice)
([components/learn/drill-view.tsx](../assets/frontend/components/learn/drill-view.tsx), `DrillView`)
- **"Back" button** + header "Practice your weak spots". (`~127`)
- **Question stem** + **answer choice buttons** (pick = *pending*, not submitted). (`~257`)
- **Confidence buttons** — "Guessing" (1) / "Shaky" (2) / "Confident" (3) commit the answer. (`~283`)
- **Result** — **score line**, **calibration panel** ("how often each confidence level was actually right"), **missed-concepts list**, **"Drill again"** / **"Done"**. (`~178`)

### Exam (chapter exam)
([components/learn/exam-panel.tsx](../assets/frontend/components/learn/exam-panel.tsx), `ExamPanel`)
- **Start header** "Chapter exam" + **"Start exam" button** (shows "Pass mark is N%"). (`~198`)
- **Question counter** + **"Chapter exam · pass N%" label** + **progress bar** + **answer choices** (no per-question feedback). (`~162`)
- **Result score dial** (green pass / amber fail) + **verdict line** + **per-question result list** (✓/✗, wrong answers show the feedback banner) + **"Retake exam" button**. (`~114`)

### Free Recall / Brain Dump
([components/learn/dump-view.tsx](../assets/frontend/components/learn/dump-view.tsx), `DumpView`)
- **"Back" button** + header "Free recall" + optional **chapter selector**. (`~53`)
- **Brain-dump textarea** ("Brain-dump here…") + **"Check what I remembered" button**. (`~100`)
- **Coverage score** ("N% of M concepts recalled") + **Gaps section** (amber chips) + **Recalled section** (emerald chips) + **"Try again"** / **"Done"**. (`~115`)

### Lesson Panel (guided per-concept walkthrough)
([components/learn/lesson-panel.tsx](../assets/frontend/components/learn/lesson-panel.tsx), `LessonPanel`)
- **"Lesson" label** + **position counter** + **concept card** (name / kind badge / signal / source). (`~90`)
- **"Needs review" button** (grade Again) / **"Got it" button** (grade Good). (`~112`)
- **Lesson-complete state** + **"Start over" button**. (`~74`)

### Lock-In Panel (chapter wrap-up)
([components/learn/lockin-panel.tsx](../assets/frontend/components/learn/lockin-panel.tsx), `LockInPanel`)
- Header "Lock it in" + **prerequisite checklist** ("Skeleton recalled" / "Chapter exam passed"). (`~68`)
- **"Into spaced review" card** + **"Up next" card** (with **"Continue"**). (`~78`)
- **"Mark chapter complete" button** → **locked confirmation banner** ("Chapter complete — nice work."). (`~103`)

---

## 9. Concepts & side panels

### Concepts View (browse every concept in a course)
([components/learn/concepts-view.tsx](../assets/frontend/components/learn/concepts-view.tsx), `ConceptsView`)
- **"Back" button** + **breadcrumb** ("<course> · Concepts") + **concept-count chip** + **"Study" button** (→ review session). (`~145`)
- **"Ready to learn" panel** — concepts whose prereqs are all mastered, as **ready-to-learn chips**. (`~171`)
- **Section group heading** + a list of **concept cards**. (`~194`)

### Concept Card (one expandable concept row)
([components/learn/concept-card.tsx](../assets/frontend/components/learn/concept-card.tsx), `ConceptCard`)
- Colored left-edge by kind; **card expand/collapse toggle**, **mastery dot**, **concept name**, **kind badge**, **"also in …" badge**, **page badge**, **"Open concept lesson" button**, **signal line**, and (expanded) **source passage** / **"Prerequisites:" line** / **Q&A list**. (`~56`)

### Concept Detail (focused single-concept lesson)
([components/learn/concept-detail.tsx](../assets/frontend/components/learn/concept-detail.tsx), `ConceptDetail`)
- **"Back" button**, **concept title** + **kind badge** + **location subline**. (`~64`)
- **"Learn first:" locked banner** (amber, clickable prereq links) when gated. (`~84`)
- **Explanation body** + **"From the text" passage** + **"Prerequisites" chips** + **"Test yourself" cards** (each with **"Show answer"**). (`~105`)
- **"How well did you recall this?" grader** — "Again" / "Hard" / "Good" / "Easy". (`~163`)

### Section Concepts Panel (active recall for one section)
([components/learn/section-concepts-panel.tsx](../assets/frontend/components/learn/section-concepts-panel.tsx), `SectionConceptsPanel`)
- **Recall prompt header** + **marked-count badge** ("3/8"). (`~411`)
- **Concept recall row** — **row toggle** reveals the definition; **status marker** (check / "~" fuzzy / hollow); **"Described it" button** + **"Fuzzy" button**. (`ConceptRecallRow`, `~231`)
- **Quick Check** — dashed **"Quick check" launch button** → a 2-question inline MCQ with **answer choices**, **result marker**, **"Next"**, and the feedback banner. (`ConceptQuickCheck`, `~101`)

### Ask this book (semantic search / grounded Q&A)
([components/learn/ask-panel.tsx](../assets/frontend/components/learn/ask-panel.tsx), `AskPanel`)
- **"Course" back button** + **"Ask this book" heading**. (`~76`)
- **Mode toggle** — "Ask" (grounded answer) / "Search" (semantic). (`~95`)
- **Query input box** + **Run button** ("Ask" / "Search"). (`~113`)
- **Index hint bar** ("This book isn't indexed…") + **"Build index" button**. (`~131`)
- **Grounded-answer card** + **"Sources" list** (numbered **citation rows** → open section). (`~151`)
- **Search-results list** — **search-result cards** with snippet → open section. (`~192`)

### Audiobook Panel (chapter narration → MP3)
([components/learn/audiobook-panel.tsx](../assets/frontend/components/learn/audiobook-panel.tsx), `AudiobookPanel`)
- **"Audiobook" header** ("narrated locally by Orpheus"). (`~162`)
- **"Narrate" source toggle** — "Full text" / "Guided" / "Concept summary". (`~168`)
- **"Voice" dropdown** + **Generate button** ("Generate audiobook" / "Generating…" / "Regenerate"). (`~193`)
- **Progress bar + status** + **audio player** + **"Speed" selector** + **"Download MP3" link**. (`~224`)

### Syllabus Tree (the course outline sidebar)
([components/learn/syllabus-tree.tsx](../assets/frontend/components/learn/syllabus-tree.tsx), `SyllabusTree`)
- **"Filter sections…" search box** + scrollable **tree rows**. (`~336`)
- **Tree row** — **expand/collapse chevron**, **section mastery dot**, **row title button** (selects the section), **concept-count badge**, **mastery-% badge**. (`TreeRow`, `~141`)
- **Extract button** — per-section sparkles/loader/check/warning icon; kicks off background concept extraction. (`ExtractButton`, `~30`)
- **"Clear selection (study whole graph)" button** at the bottom. (`~365`)

### TOC Section Selector (choose which sections to process)
([components/toc-section-selector.tsx](../assets/frontend/components/toc-section-selector.tsx), `TocSectionSelector`)
- **"Select all" / "Select none" / "Expand all" / "Collapse all"** + **selection-count text**. (`~182`)
- **Node rows** — **expand/collapse chevron** + tri-state **section checkbox** (indeterminate for partial subtrees) + **section label**. (`TreeNodeRow`, `~63`)

### Shortcuts Help (keyboard cheat-sheet)
([components/learn/shortcuts-help.tsx](../assets/frontend/components/learn/shortcuts-help.tsx), `ShortcutsHelp`)
- **Shortcuts dialog** — opened by pressing **"?"**; title "Keyboard shortcuts", grouped "Learning path / Review / Quiz / Reader / General". (`~84`)

---

## 10. Upload sub-page

Reached via the **"Upload" button**; return via **"Back to courses"**. ([components/tabs/UploadTab.tsx](../assets/frontend/components/tabs/UploadTab.tsx), `UploadTab`)

- **"Upload Documents" card** (top-left) — holds the **file drop zone**: dashed target with "Drag & Drop Files" / "or browse files" and the accepted-types chip ".md, .csv, .txt, .json, .pdf (auto-convert)". Shows a **"Converting PDF…" state** and an **error banner**. (`upload-documents.tsx` ~96, `UploadDocuments`)
- **"Storage Connections" card** (left rail) — wraps the DB-connection widget. (`UploadTab.tsx` ~43)
- **"Documents Overview" panel** (wide right) — the documents table. (`UploadTab.tsx` ~56)

---

## 11. Process / Configure sub-page

The nav "Configure" opens a screen titled **"Process"**. Reached via the **"Process" button**.
([components/process/process-dashboard.tsx](../assets/frontend/components/process/process-dashboard.tsx), `ProcessDashboard`; wrapped by `ConfigureTab`)

- **Process header** — lightning tile + "Process" + subtitle; **"Refresh" button** top-right. (`~205`)
- **Book picker** — a row of pill buttons, one per document; active pill highlighted. (`~221`)
- **Chapter list card**:
  - **"{n}/{m} chapters deep" counter** + **"Build all N unbuilt tonight · 2:00 AM" button**. (`~250`)
  - **Chapter row** — **expand chevron** (→ report), **readiness dot**, **chapter title**, **concept counts** ("N concepts · X/N deep"), a **status indicator** (extracting/queued/error/deep), a **"Build" button** (wand, immediate) and a **schedule-tonight** icon button. (`~276`)
  - **Extraction report drawer** — the per-chapter **OutcomeReport**: summary counts ("N extracted / empty / skipped / errors / gated…") + a noteworthy-sections list. (`~364`, `OutcomeReport` ~46)
  - **Empty state** — "No chapters found — convert a document first (Upload)." (`~378`)

---

## 12. Shared visual language

Recurring pieces worth naming once so we mean the same thing everywhere:

- **Mastery dot** — hollow circle = "Not studied yet"; filled green dot with opacity scaling to mastery %. Appears on concept cards, concept detail, syllabus rows, and the concept popover. (`concept-mastery-dot.tsx`; also `MasteryDot` in `syllabus-tree.tsx`)
- **Mastery ring** — the conic-gradient % ring: **mini ring** (48px, course cards) and the large ring (80px, Course Home hero).
- **Kind badge / kind color** — every concept's type is color-coded consistently: **definition = blue, theorem = purple, principle = amber, result = emerald, method = rose.**
- **Kind badge** vs **status badge** — "kind badge" = concept type (above); "status badge" = a course's Ready/Processing/Not-processed pill on the shelf.
- **Readiness dot** — the build-state dot (solid = deep/ready, hollow-fill = partial, hollow = not built) in the Deep Chapter dropdown and the Process chapter rows.
- **Expand/collapse chevron** — right (closed) ↔ down (open); used on concept cards, both trees, and process rows.
- **Number-key badges (1–9)** — the small `kbd` chips on answer choices across every quiz/exam/drill. Press the number to pick.
- **Keyboard shortcuts** — `→` continue, `1–9` pick answer, Review: `space` reveal + `1–4` grade, Quiz: `↵` next, Reader: `Ctrl F` find, `?` shows the shortcuts dialog.

---

*Generated by walking every frontend component under `assets/frontend/`. If a name here
feels wrong, tell me the better name and I'll update this file — it's meant to be the
canonical vocabulary we both use.*
