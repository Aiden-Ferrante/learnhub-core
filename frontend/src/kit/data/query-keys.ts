/** The ONE query-key factory. Every read the app makes has a key here; never write a
 *  key array by hand in a surface.
 *
 *  Keys are hierarchical arrays, so invalidating a ROOT (e.g. `roots.reviewQueue`)
 *  invalidates every key under it (all docs, scopes, limits). Arguments that are absent
 *  are stored as `null`, so `qk.mastery()` (whole library) and `qk.mastery("doc")` are
 *  distinct entries.
 *
 *  Which id to pass: concept / review / mastery reads take the course's `learnDocId`;
 *  versions take the book key; packs take the pack key. Same as the gateway it wraps. */

import type { QueryKey } from "@tanstack/react-query"

const n = <T>(v: T | undefined | null): T | null => (v === undefined ? null : v)

/** First element of every key family. Pass one to `invalidates` to refresh the family. */
export const roots = {
  documents: ["documents"],
  learnDocuments: ["learn-documents"],
  studyDebt: ["study-debt"],
  reviewQueue: ["review-queue"],
  reviewCalendar: ["review-calendar"],
  sessions: ["study-sessions"],
  mastery: ["mastery"],
  conceptMastery: ["concept-mastery"],
  activity: ["activity"],
  concepts: ["concepts"],
  sectionConcepts: ["section-concepts"],
  outline: ["outline"],
  tocTree: ["toc-tree"],
  chapters: ["chapters"],
  chapterProgress: ["chapter-progress"],
  guidedReading: ["guided-reading"],
  skeleton: ["skeleton"],
  sectionContent: ["section-content"],
  sectionFigures: ["section-figures"],
  documentMarkdown: ["document-markdown"],
  sectionMaterial: ["section-material"],
  staleSections: ["stale-sections"],
  unplacedBlocks: ["unplaced-blocks"],
  versions: ["versions"],
  readingProgress: ["reading-progress"],
  groups: ["course-groups"],
  courseStatus: ["course-status"],
  deletion: ["deletion-impact"],
  extraction: ["extraction-status"],
  jobs: ["jobs"],
  system: ["system-status"],
  audiobook: ["audiobook"],
  packs: ["packs"],
  pack: ["pack"],
  /** Pack DRAWS (a unit page, the Today review set). Kept OUT of `pack` on purpose. */
  packDraw: ["pack-draw"],
  sitting: ["sitting"],
  pdf: ["pdf-available"],
} as const satisfies Record<string, QueryKey>

/** Query keys. `qk.x(args)` → the key for one read; see each gateway for the args. */
export const qk = {
  // ── Library ────────────────────────────────────────────────────────────
  /** The app's document list (/api/documents, the DocumentProvider). */
  documents: () => [...roots.documents],
  /** The learn service's own document list (fetchLearnDocuments). */
  learnDocuments: () => [...roots.learnDocuments],
  /** Whole-library due rollup (fetchStudyDebt). Feeds every due badge. */
  studyDebt: (days = 7) => [...roots.studyDebt, days],
  readingProgress: () => [...roots.readingProgress],
  groups: () => [...roots.groups],
  versions: (book: string) => [...roots.versions, book],
  courseStatus: (doc: string) => [...roots.courseStatus, doc],
  /** Impact read before deleting a course (fetchLearnDeletion). */
  deletion: (doc: string) => [...roots.deletion, doc],

  // ── Review / memory ────────────────────────────────────────────────────
  /** A chapter/section review queue (fetchReviewQueue). Omit limit to address all limits. */
  reviewQueue: (doc: string | null | undefined, scope: string, limit?: number) =>
    limit === undefined ? [...roots.reviewQueue, n(doc), scope] : [...roots.reviewQueue, n(doc), scope, limit],
  /** The whole-course review queue (fetchCourseReviewQueue). Lives under reviewQueue. */
  courseReview: (doc: string) => [...roots.reviewQueue, doc, "course"],
  reviewCalendar: (days = 60) => [...roots.reviewCalendar, days],
  sessions: (days = 90, doc?: string | null) => [...roots.sessions, days, n(doc)],
  mastery: (doc?: string | null) => [...roots.mastery, n(doc)],
  conceptMastery: (doc?: string | null) => [...roots.conceptMastery, n(doc)],
  activity: (doc?: string | null) => [...roots.activity, n(doc)],

  // ── Course structure + content ─────────────────────────────────────────
  /** Every concept of a course (fetchDocumentConcepts). */
  concepts: (doc?: string | null) => [...roots.concepts, n(doc)],
  sectionConcepts: (doc: string | null | undefined, scope: string) => [...roots.sectionConcepts, n(doc), scope],
  outline: (doc?: string | null) => [...roots.outline, n(doc)],
  tocTree: (doc?: string | null) => [...roots.tocTree, n(doc)],
  chapters: (doc: string) => [...roots.chapters, doc],
  chapterProgress: (doc: string | null | undefined, scope: string | null) => [...roots.chapterProgress, n(doc), scope],
  guidedReading: (doc: string, scope: string) => [...roots.guidedReading, doc, scope],
  skeleton: (doc: string | null | undefined, scope: string | null) => [...roots.skeleton, n(doc), scope],
  sectionContent: (doc: string | null | undefined, scope: string) => [...roots.sectionContent, n(doc), scope],
  sectionFigures: (doc: string, sectionKey: string) => [...roots.sectionFigures, doc, sectionKey],
  /** The whole book's markdown (fetchDocumentMarkdown). Heavy: prefer outline. */
  documentMarkdown: (doc?: string | null) => [...roots.documentMarkdown, n(doc)],
  /** Whether a course's original PDF exists (the HEAD in pdf-book-view). */
  pdf: (url: string) => [...roots.pdf, url],

  // ── Authoring ──────────────────────────────────────────────────────────
  sectionMaterial: (doc: string, scope: string) => [...roots.sectionMaterial, doc, scope],
  staleSections: (doc: string) => [...roots.staleSections, doc],
  unplacedBlocks: (doc: string) => [...roots.unplacedBlocks, doc],

  // ── Processing ─────────────────────────────────────────────────────────
  /** A course's chapter build queue (fetchChapterBuilds). */
  jobs: (doc: string) => [...roots.jobs, doc],
  /** Worker / queue status (fetchSystemStatus). */
  system: () => [...roots.system],
  extraction: (doc: string | null | undefined, scope: string | null) => [...roots.extraction, n(doc), scope],
  audiobookStatus: (doc: string | null | undefined, scope: string | null) => [...roots.audiobook, "status", n(doc), scope],
  audiobookTimeline: (doc: string | null | undefined, scope: string | null) => [...roots.audiobook, "timeline", n(doc), scope],
  audiobookVoices: () => [...roots.audiobook, "voices"],

  // ── Exam packs ─────────────────────────────────────────────────────────
  packs: (doc: string) => [...roots.packs, doc],
  packPresets: (doc: string) => [...roots.packs, doc, "presets"],
  /** One pack; packToday lives under it. */
  pack: (key: string) => [...roots.pack, key],
  packToday: (key: string) => [...roots.pack, key, "today"],
  /** A unit page and the Today review set are DRAWS: each GET marks its questions as seen
   *  on the server (packs.learn_unit / review_set), so a refetch burns unseen questions
   *  and swaps the cards under the learner. They live under `roots.packDraw`, never under
   *  `roots.pack`, so no pack invalidation can refetch them. Read them with
   *  `staleMs: Infinity`; refresh one only through its own retry(). */
  packReviewSet: (key: string) => [...roots.packDraw, key, "review"],
  packUnit: (key: string, unit: string) => [...roots.packDraw, key, "unit", unit],
  /** One sitting; sittingResults lives under it. */
  sitting: (key: string) => [...roots.sitting, key],
  sittingResults: (key: string) => [...roots.sitting, key, "results"],
} satisfies Record<string, (...args: never[]) => QueryKey>

/** What a recall grade (concept, skeleton or chapter card) changes. Pass as
 *  `useApiMutation(submitReviewGrade, { invalidates: GRADE_INVALIDATES })`, so the
 *  nav badge, Library Today panel, course home and queues all update together. */
export const GRADE_INVALIDATES: QueryKey[] = [
  roots.reviewQueue,
  roots.studyDebt,
  roots.mastery,
  roots.conceptMastery,
  roots.chapterProgress,
  roots.reviewCalendar,
  roots.activity,
]

/** What a pack grade / sitting answer changes: the pack (incl. Today), its sittings and
 *  the badges (pack rows do not count there, but the heatmap does). The draws
 *  (packUnit, packReviewSet) are outside every root here, so this never refetches them. */
export const PACK_INVALIDATES: QueryKey[] = [roots.pack, roots.sitting, roots.packs, roots.activity]
