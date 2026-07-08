/** Types and client helpers for the learn service (via Next.js /api/learn/* proxies). */

export type LearnTreeNode = {
  id: string
  label: string
  title?: string | null
  sectionKey: string | null
  isSection: boolean
  conceptCount?: number
  /** This section's OWN extracted concepts (not rolled up) — clickable leaves in the tree. */
  concepts?: { key?: string | null; name: string; kind?: string | null }[]
  children: LearnTreeNode[]
}

export type TocTreeResponse = {
  tree: LearnTreeNode[]
  edgeCount: number
  mentionEdgeCount: number
  error?: string
}

export type SectionStatsResponse = {
  scope: string
  tripleCount: number
  entityCount: number
  mentionCount?: number
  error?: string
}

export type SectionMastery = {
  mastery: number
  coverage?: number
  accuracy?: number
  attempts: number
  lastSeen: number | null
  isRollup?: boolean
}

export type WeakestSection = {
  sectionKey: string
  label: string
  title?: string | null
  mastery: number
}

export type MasteryResponse = {
  bySection: Record<string, SectionMastery>
  overall: number
  weakest: WeakestSection[]
  params?: { alpha: number; beta: number; tauDays: number }
  error?: string
}

export type Mistake = {
  sectionKey: string
  ts: number
  stem: string | null
  expected: string | null
}

export type MistakesResponse = {
  mistakes: Mistake[]
  error?: string
}

export type ActivityDay = { date: string; count: number }

export type ActivityResponse = {
  days: ActivityDay[]
  total: number
  max: number
  /** Per-engagement-kind counts (quiz | review | exam | read | listen | …). */
  byKind?: Record<string, number>
  error?: string
}

export type OutlineEntry = {
  numberKey: string | null
  title: string
  sectionKey: string
  listDepth: number
  page?: number
}

export type DocumentMeta = {
  id: string
  title: string
  sourceFilename: string
  markdown: string
  pageCount: number
  charCount: number
  sectionCount: number
  outline?: OutlineEntry[]
  createdAt: number
}

export type DocumentResponse = {
  document: DocumentMeta | null
  error?: string
}

export type SectionContentBlock = {
  sectionKey: string
  heading: string
  level: number
  order: number
  pageStart?: number | null
  pageEnd?: number | null
}

export type SectionContentResponse = {
  sectionKey: string
  docId?: string
  blocks: SectionContentBlock[]
  markdown: string
  error?: string
}

export function getLearnServiceBaseUrl(): string {
  return process.env.LEARN_SERVICE_URL?.replace(/\/$/, '') || 'http://learn:8000'
}

async function parseJsonResponse<T>(res: Response): Promise<T & { error?: string }> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: string }
  if (!res.ok) {
    const msg =
      typeof body.detail === 'string'
        ? body.detail
        : body.error || res.statusText || 'Learn service request failed'
    throw new Error(msg)
  }
  return body
}

export async function fetchTocTree(doc?: string): Promise<TocTreeResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/toc-tree${qs}`, { cache: 'no-store' })
  return parseJsonResponse<TocTreeResponse>(res)
}

export async function fetchMastery(doc?: string): Promise<MasteryResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/mastery${qs}`, { cache: 'no-store' })
  return parseJsonResponse<MasteryResponse>(res)
}

export async function fetchMistakes(doc?: string, limit = 20): Promise<MistakesResponse> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/mistakes?${params}`, { cache: 'no-store' })
  return parseJsonResponse<MistakesResponse>(res)
}

export async function fetchActivity(doc?: string): Promise<ActivityResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/activity${qs}`, { cache: 'no-store' })
  return parseJsonResponse<ActivityResponse>(res)
}

// Forgetting forecast: concepts due now + falling due over the next `days`.
export type ForecastResponse = {
  dueNow: number
  soon?: number
  tracked: number
  horizon: { date: string; count: number }[]
  error?: string
}

export async function fetchForecast(doc?: string, days = 7): Promise<ForecastResponse> {
  const params = new URLSearchParams({ days: String(days) })
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/forecast?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ForecastResponse>(res)
}

// Record a passive engagement event (read/listen/…) so the dashboard reflects all study,
// not just graded quizzes. Fire-and-forget — never blocks the UI.
export function recordEngagement(kind: string, scope: string | null, doc?: string): void {
  if (!scope) return
  void fetch('/api/learn/engagement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, scope, doc: doc ?? null }),
  }).catch(() => {})
}

export async function fetchDocumentMarkdown(id?: string): Promise<DocumentResponse> {
  const qs = id ? `?id=${encodeURIComponent(id)}` : ''
  const res = await fetch(`/api/learn/document${qs}`, { cache: 'no-store' })
  return parseJsonResponse<DocumentResponse>(res)
}

export type OutlineResponse = { docId?: string; outline: OutlineEntry[]; error?: string }

// The document's outline only (chapter list) — cheap (no markdown), for the chapter reader.
export async function fetchOutline(doc?: string): Promise<OutlineResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/outline${qs}`, { cache: 'no-store' })
  return parseJsonResponse<OutlineResponse>(res)
}

export async function fetchSectionContent(
  sectionKey: string,
  docId?: string,
): Promise<SectionContentResponse> {
  const segs = sectionKey.split('/').map(encodeURIComponent).join('/')
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/section/content/${segs}${qs}`, { cache: 'no-store' })
  return parseJsonResponse<SectionContentResponse>(res)
}

export async function fetchSectionStats(
  scope: string,
  doc?: string,
): Promise<SectionStatsResponse> {
  const params = new URLSearchParams({ scope })
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/section-stats?${params}`, { cache: 'no-store' })
  return parseJsonResponse<SectionStatsResponse>(res)
}

export type ConceptProvenance = {
  sectionKey: string
  pageStart?: number | null
  pageEnd?: number | null
}

export type ConceptLesson = {
  conceptKey?: string
  name: string
  kind: string
  signal: string
  source?: string | null
  questions?: { q: string; a: string }[]
  prereqNames?: string[]
  sectionKey?: string
  pageStart?: number | null
  pageEnd?: number | null
  appearsIn?: ConceptProvenance[]
  aliasCount?: number
  /** 1-2 paragraph expansion of `signal`, pre-generated for the Deep Chapter surface. */
  deepExplanation?: string | null
}

export type DocumentConceptsResponse = {
  docId?: string
  concepts: ConceptLesson[]
  error?: string
}

// Document-level canonical (deduped) concept list — one entry per concept, with the merged
// provenance of every section it appears in.
export async function fetchDocumentConcepts(doc?: string): Promise<DocumentConceptsResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/concepts${qs}`, { cache: 'no-store' })
  return parseJsonResponse<DocumentConceptsResponse>(res)
}

// One pipeline status per course: whether the learn content exists (a dead learnDocId is the
// "content link broken" empty state), and chapter-level concept/quiz coverage for the strip.
export type CourseStatus = {
  doc: string
  exists: boolean
  reason?: string
  title?: string
  converted?: boolean
  pageCount?: number
  sectionCount?: number
  outlineEntries?: number
  chaptersTotal?: number
  chaptersWithConcepts?: number
  chaptersWithQuizzes?: number
  conceptCount?: number
  error?: string
}

export async function fetchCourseStatus(doc: string): Promise<CourseStatus> {
  const res = await fetch(`/api/learn/course-status?doc=${encodeURIComponent(doc)}`, {
    cache: 'no-store',
  })
  // 404 = the course points at content that no longer exists — a state the caller renders,
  // not an exception (parseJsonResponse would throw on it).
  const body = (await res.json().catch(() => ({}))) as Partial<CourseStatus>
  if (!res.ok && res.status !== 404) {
    return { doc, exists: false, error: body.error || res.statusText }
  }
  return { ...body, doc, exists: body.exists ?? false }
}

export async function deleteConcept(key: string): Promise<{ deleted?: string; error?: string }> {
  const res = await fetch(`/api/learn/concept/${encodeURIComponent(key)}`, { method: 'DELETE' })
  return parseJsonResponse(res)
}

// Delete a course's learn content outright (document, sections, concepts, reviews, artifacts).
export async function deleteLearnDocument(
  doc: string,
): Promise<{ deleted?: string; removed?: Record<string, number>; error?: string }> {
  const res = await fetch(`/api/learn/document?doc=${encodeURIComponent(doc)}`, {
    method: 'DELETE',
  })
  return parseJsonResponse(res)
}

export type SectionConceptsResponse = {
  sectionKey: string
  docId?: string
  concepts: ConceptLesson[]
  // Ordered sub-sections that carry concepts within the requested scope — present when a
  // chapter scope spans multiple sub-sections, used to drive the guided top-down concept walk.
  sections?: { sectionKey: string; title: string; essence?: string; depth?: number }[]
  error?: string
}

// Concepts extracted from a single section (the section view). `docId` must be the learnDocId
// (concepts are keyed by it), matching where section_content and the document outline live.
export async function fetchSectionConcepts(
  sectionKey: string,
  docId?: string,
): Promise<SectionConceptsResponse> {
  const segs = sectionKey.split('/').map(encodeURIComponent).join('/')
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/section/concepts/${segs}${qs}`, { cache: 'no-store' })
  return parseJsonResponse<SectionConceptsResponse>(res)
}

// ----- Spaced-repetition concept review (keyless) -----

export type ReviewCard = {
  conceptKey: string
  name: string
  kind: string
  signal: string
  source?: string | null
  sectionKey: string
  state: 'new' | 'learning' | 'review'
  due?: number | null
  /** Which course the card belongs to — set so whole-library sessions can fetch per-card
   *  extras (figures) without a docId prop. */
  docId?: string | null
  pageStart?: number | null
  pageEnd?: number | null
  /** 'skeleton' = a structure-recall card (rebuild a branch's sub-sections from memory),
   *  seeded by the chapter walk's self-grades. Absent/'concept' = a normal concept card. */
  itemType?: 'concept' | 'skeleton'
  /** Skeleton cards only: the branch's true children, snapshotted at walk time. */
  children?: { heading: string; essence?: string }[]
}

export type ReviewQueueResponse = {
  cards: ReviewCard[]
  /** `new` is the full untouched backlog; `newAllowance` (unscoped sessions only) is how many
   *  of them today's session will actually serve — the daily intake cap minus what was
   *  already introduced since midnight. */
  counts: { due: number; new: number; later: number; newAllowance?: number }
  error?: string
}

export type ReviewGradeResponse = {
  conceptKey: string
  due: number
  intervalDays: number
  state: string
  error?: string
}

// Recall grades: 1=Again, 2=Hard, 3=Good, 4=Easy.
export type ReviewGrade = 1 | 2 | 3 | 4

// Due + new concepts to review. `scope` = a sectionKey (one section) or null (whole course).
// `docId` must be the learnDocId (concepts/reviews are keyed by it).
export async function fetchReviewQueue(
  docId?: string,
  scope?: string | null,
  limit = 40,
): Promise<ReviewQueueResponse> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (docId) params.set('doc', docId)
  if (scope) params.set('scope', scope)
  // The learner's midnight, so the daily new-card allowance follows their timezone.
  params.set('dayStart', String(new Date().setHours(0, 0, 0, 0) / 1000))
  const res = await fetch(`/api/learn/review/queue?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ReviewQueueResponse>(res)
}

export async function submitReviewGrade(
  conceptKey: string,
  grade: ReviewGrade,
  docId?: string,
): Promise<ReviewGradeResponse> {
  const res = await fetch('/api/learn/review/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conceptKey, grade, doc: docId ?? null }),
  })
  return parseJsonResponse<ReviewGradeResponse>(res)
}

// ----- Typed document elements (figures/tables extracted from the PDF) -----

export type LearnFigure = {
  type: string
  sectionKey: string
  page?: number | null
  order: number
  caption?: string | null
  imageRef?: string | null
}

/** Captioned figures for a section (and its descendants). The image itself is served by
 *  /api/learn/figure?doc=…&n={order}. */
export async function fetchSectionFigures(docId: string, sectionKey: string): Promise<LearnFigure[]> {
  const params = new URLSearchParams({ doc: docId, scope: sectionKey, type: 'figure' })
  const res = await fetch(`/api/learn/elements?${params}`, { cache: 'no-store' })
  const data = await parseJsonResponse<{ elements?: LearnFigure[]; error?: string }>(res)
  return (data.elements ?? []).filter((e) => (e.caption ?? '').trim())
}

export function figureUrl(docId: string, order: number): string {
  return `/api/learn/figure?doc=${encodeURIComponent(docId)}&n=${order}`
}

// ----- Whole-library study debt (the one cross-course rollup) -----

export type StudyDebt = {
  dueNow: number
  fadingSoon: number
  tracked: number
  days: number
  courses: { doc: string; title: string; dueNow: number; fadingSoon: number; tracked: number }[]
  error?: string
}

export async function fetchStudyDebt(days = 7): Promise<StudyDebt> {
  const res = await fetch(`/api/learn/study-debt?days=${days}`, { cache: 'no-store' })
  return parseJsonResponse<StudyDebt>(res)
}

// Seed-or-advance a SKELETON item's spaced-repetition state — the chapter walk calls this on
// every structure-recall self-grade, snapshotting the branch's true children so the review
// reveal can re-show them. Re-grades from the queue go through submitReviewGrade instead
// (the card's conceptKey is the skel-… review-row key).
export async function submitSkeletonReviewGrade(
  docId: string,
  sectionKey: string,
  grade: ReviewGrade,
  snapshot?: {
    heading?: string
    chapterScope?: string
    children?: { heading: string; essence?: string }[]
  },
): Promise<ReviewGradeResponse> {
  const res = await fetch('/api/learn/review/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skeleton: true, doc: docId, sectionKey, grade, ...snapshot }),
  })
  return parseJsonResponse<ReviewGradeResponse>(res)
}

// ----- Deterministic concept MCQ (keyless) -----

export type ConceptQuizSession = {
  sessionId: string
  stem: string
  choices: string[]
  error?: string
}

export type ConceptQuizResult = {
  correct: boolean
  expected: string
  signal?: string | null
  source?: string | null
  error?: string
}

export async function startConceptQuiz(
  scope: string | null,
  docId?: string,
): Promise<ConceptQuizSession> {
  const res = await fetch('/api/learn/concept-quiz/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: docId ?? null }),
  })
  return parseJsonResponse<ConceptQuizSession>(res)
}

// ---- Guided reading: the book's text, scaffolded with focus notes + checks per section ----
export type ReadingCheck = { q: string; a: string }
export type ReadingGuideSection = {
  sectionKey: string
  heading: string
  markdown: string
  depth: number
  essence?: string
  focus?: string
  checks?: ReadingCheck[]
  pageStart?: number | null
  pageEnd?: number | null
}
export type ReadingGuideResponse = {
  docId?: string
  scope?: string | null
  sections: ReadingGuideSection[]
  error?: string
}

export async function fetchReadingGuide(
  scope: string | null,
  docId?: string,
): Promise<ReadingGuideResponse> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (docId) params.set('doc', docId)
  const res = await fetch(`/api/learn/reading-guide?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ReadingGuideResponse>(res)
}

export type ReadingPrepareStatus = { total: number; authored: number; running: boolean; error?: string }

export async function fetchReadingPrepareStatus(
  scope: string | null,
  docId?: string,
): Promise<ReadingPrepareStatus> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (docId) params.set('doc', docId)
  const res = await fetch(`/api/learn/reading-guide/prepare?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ReadingPrepareStatus>(res)
}

export async function prepareReadingGuide(
  scope: string | null,
  docId?: string,
): Promise<ReadingPrepareStatus> {
  const res = await fetch('/api/learn/reading-guide/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: docId ?? null }),
  })
  return parseJsonResponse<ReadingPrepareStatus>(res)
}

export async function submitConceptAnswer(
  sessionId: string,
  choiceIndex: number,
): Promise<ConceptQuizResult> {
  const res = await fetch('/api/learn/concept-quiz/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, choiceIndex }),
  })
  return parseJsonResponse<ConceptQuizResult>(res)
}

// Application-question authoring progress for a chapter scope.
export type QuizPrepareStatus = { total: number; authored: number; running: boolean; error?: string }

export async function fetchQuizPrepareStatus(
  scope: string | null,
  docId?: string,
): Promise<QuizPrepareStatus> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (docId) params.set('doc', docId)
  const res = await fetch(`/api/learn/concept-quiz/prepare?${params}`, { cache: 'no-store' })
  return parseJsonResponse<QuizPrepareStatus>(res)
}

// Kick off authoring of ALL of a chapter's application questions up front (background).
export async function prepareQuizQuestions(
  scope: string | null,
  docId?: string,
): Promise<QuizPrepareStatus> {
  const res = await fetch('/api/learn/concept-quiz/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: docId ?? null }),
  })
  return parseJsonResponse<QuizPrepareStatus>(res)
}

export type ConceptMastery = {
  name: string
  sectionKey: string
  mastery: number
  attempts: number
  due?: number | null
  state?: string
  /** Prerequisite gate: mastered | ready (prereqs met) | locked (prereqs unmet). */
  gate?: 'mastered' | 'ready' | 'locked'
  blockedBy?: string[]
}

export type ConceptMasteryResponse = {
  byConcept: Record<string, ConceptMastery>
  overall: number
  counts?: { mastered: number; ready: number; locked: number; total: number }
  masteredThreshold?: number
  error?: string
}

export async function fetchConceptMastery(docId?: string): Promise<ConceptMasteryResponse> {
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/concept-mastery${qs}`, { cache: 'no-store' })
  return parseJsonResponse<ConceptMasteryResponse>(res)
}

export type ExtractStatusResponse = {
  status: 'idle' | 'running' | 'done' | 'error'
  scope?: string | null
  docId?: string
  progress?: { done: number; total: number; current?: string | null }
  summary?: {
    sections?: number
    extracted?: number
    concepts?: number
    questions?: number
    prereqEdges?: number
    seconds?: number
    errors?: string[]
  }
  error?: string
}

// The model picked in the UI. The learn service is local-only (Ollama), so we honor the
// selection only when it's an Ollama model; otherwise the learn service falls back to
// LEARN_EXTRACT_MODEL / OLLAMA_MODEL. `selectedModel` is the PRIMARY key — written by the
// main ModelSelector (Configure / Process Documents tab), which is the picker that drives
// document processing/extraction. `selectedModelForRAG` is only written by the RAG Query
// tab's compact selector and is checked second as a fallback. Order matters: reading the RAG
// key first let a stale RAG selection (e.g. llama3.1:70b) override the Process picker's choice.
function selectedOllamaModel(): string | undefined {
  if (typeof window === 'undefined') return undefined
  for (const key of ['selectedModel', 'selectedModelForRAG']) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const m = JSON.parse(raw)
      if (m?.provider === 'ollama' && m?.model) return String(m.model)
    } catch {
      // ignore malformed entry, try the next key
    }
  }
  return undefined
}

// Kick off a background concept extraction. Pass a `scope` (toc: key) for one chapter, OR
// `sectionKeys` for an exact set (the TOC-preview selection) with `scope = null` (the whole
// document's per-doc job slot). Neither → the whole document. `model` overrides the
// extraction model; when omitted it defaults to the UI-selected Ollama model.
export async function startExtraction(
  scope: string | null,
  doc?: string,
  sectionKeys?: string[],
  model?: string,
): Promise<ExtractStatusResponse> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  const useModel = model ?? selectedOllamaModel()
  const payload: Record<string, unknown> = {}
  if (sectionKeys && sectionKeys.length) payload.sectionKeys = sectionKeys
  if (useModel) payload.model = useModel
  const res = await fetch(`/api/learn/extract?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<ExtractStatusResponse>(res)
}

export async function getExtractionStatus(
  scope: string | null,
  doc?: string,
): Promise<ExtractStatusResponse> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/extract/status?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ExtractStatusResponse>(res)
}

/** Find a section node by its sectionKey anywhere in the forest. */
export function findNodeBySectionKey(nodes: LearnTreeNode[], key: string): LearnTreeNode | null {
  for (const n of nodes) {
    if (n.sectionKey === key) return n
    const found = findNodeBySectionKey(n.children, key)
    if (found) return found
  }
  return null
}

/** The top-level chapter whose subtree contains `sectionKey` (or that chapter itself).
 *  Used to keep studying chapter-scoped: a click on any section resolves to its chapter. */
export function findChapterForSection(
  forest: LearnTreeNode[],
  sectionKey: string,
): LearnTreeNode | null {
  const contains = (n: LearnTreeNode): boolean =>
    n.sectionKey === sectionKey || n.children.some(contains)
  for (const chapter of forest) {
    if (chapter.isSection && contains(chapter)) return chapter
  }
  return null
}

/** One step of the unified, top-down "learn the chapter" walk.
 *  - `skeleton`: free-recall the direct sub-sections of `ofKey` (the chapter frame when
 *    `ofKey` is the chapter, or a branch's sub-skeleton).
 *  - `concepts`: learn the concepts of a leaf sub-section. */
export type ChapterWalkStep =
  | { kind: 'skeleton'; ofKey: string; childKeys: string[] }
  | { kind: 'concepts'; sectionKey: string }

/**
 * Depth-first chapter walk: frame the chapter (recall its sub-sections), then descend one
 * branch at a time — for each branch, recall its sub-sections, then learn each leaf's concepts
 * before moving on. Produces e.g. [skeleton(ch:1.1–1.4), skeleton(1.1:1.1.1–1.1.2),
 * concepts(1.1.1), concepts(1.1.2), skeleton(1.2:1.2.1–1.2.8), concepts(1.2.1)…].
 */
export function buildChapterWalk(chapter: LearnTreeNode): ChapterWalkStep[] {
  const steps: ChapterWalkStep[] = []
  const kidsOf = (n: LearnTreeNode) => n.children.filter((c) => c.isSection && c.sectionKey)
  const branch = (node: LearnTreeNode) => {
    const kids = kidsOf(node)
    if (kids.length && node.sectionKey) {
      steps.push({ kind: 'skeleton', ofKey: node.sectionKey, childKeys: kids.map((k) => k.sectionKey!) })
      kids.forEach(branch)
    } else if (node.sectionKey) {
      steps.push({ kind: 'concepts', sectionKey: node.sectionKey })
    }
  }
  branch(chapter)
  return steps
}

/** Pre-order list of all section nodes (reading order) in a tree/forest. */
export function flattenSections(nodes: LearnTreeNode[]): LearnTreeNode[] {
  const out: LearnTreeNode[] = []
  const visit = (n: LearnTreeNode) => {
    if (n.isSection && n.sectionKey) out.push(n)
    n.children.forEach(visit)
  }
  nodes.forEach(visit)
  return out
}

/** Count all section nodes in a tree/forest. */
export function countSections(nodes: LearnTreeNode[]): number {
  let n = 0
  for (const node of nodes) {
    if (node.isSection) n++
    n += countSections(node.children)
  }
  return n
}

export function displaySectionTitle(label: string, title?: string | null): string {
  const base = label.startsWith('toc:') ? label.slice(4) || 'Document root' : label
  const heading = (title ?? '').trim()
  if (!heading) return base
  // Slug-keyed sections (preface, contents, …) show the heading — it has real casing
  // where the slug key is lowercased/hyphenated.
  if (!/^\d+(\.\d+)*$/.test(base)) return heading
  // Numbered section whose heading is just the number again → show the number.
  if (heading.toLowerCase() === base.toLowerCase()) return base
  // Otherwise "1.2  Linear Regression"; many headings already carry their own
  // number, so only prepend the section number when it's missing.
  const startsWithNumber = new RegExp(`^${base.replace(/\./g, '\\.')}(\\D|$)`).test(heading)
  return startsWithNumber ? heading : `${base}  ${heading}`
}

const FULL_NUMBER = /^\d+(\.\d+)*$/

/**
 * Hierarchical display number for every section node, keyed by `node.id`.
 * "Keep real, fill gaps": use the source's own number where it has one (a full
 * dotted key like `1.2.3`, or a single segment like a chapter `1`), and
 * synthesize a positional number (`1.1`, `1.2`, …) only for slug-keyed /
 * unnumbered sections, so the outline is *always* numbered. Non-section nodes
 * (entity leaves) are skipped and get no number.
 */
export function numberSections(nodes: LearnTreeNode[]): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (list: LearnTreeNode[], parent: string) => {
    const sections = list.filter((n) => n.isSection)
    // Integer segments already claimed by the source at this level, so a
    // synthesized sibling never collides with a real chapter number.
    const claimed = new Set<number>()
    for (const n of sections) {
      const lab = (n.label ?? "").trim()
      if (/^\d+$/.test(lab)) claimed.add(parseInt(lab, 10))
    }
    let synth = 0
    for (const n of sections) {
      const lab = (n.label ?? "").trim()
      let num: string
      if (FULL_NUMBER.test(lab) && lab.includes(".")) {
        num = lab // the book's own full number, e.g. 1.2.3
      } else if (/^\d+$/.test(lab)) {
        num = parent ? `${parent}.${lab}` : lab // the book's own single segment
      } else {
        do {
          synth++
        } while (claimed.has(synth)) // fill the next free gap
        num = parent ? `${parent}.${synth}` : `${synth}`
      }
      out.set(n.id, num)
      if (n.children?.length) walk(n.children, num)
    }
  }
  walk(nodes, "")
  return out
}

/**
 * `displaySectionTitle` prefixed with a canonical hierarchical `number`,
 * de-duplicating any number the heading already carries (so a numbered key like
 * `1.2.3` plus a heading "1.2.3 Conditional Probability" reads "1.2.3 …", not
 * "1.2.3 1.2.3 …"). Falls back to the plain title when no number is supplied.
 */
export function numberedSectionTitle(
  number: string | undefined,
  label: string,
  title?: string | null,
): string {
  const base = displaySectionTitle(label, title)
  if (!number) return base
  const clean = base.replace(/^\s*\d+(\.\d+)*[ \t]*[.:)–-]?[ \t]+/, "").trim()
  return clean ? `${number}  ${clean}` : number
}

// --------------------------------------------------------------------------- //
// Audiobook (Orpheus TTS) — generate a chapter's narration as a downloadable MP3.
// --------------------------------------------------------------------------- //

export type AudiobookSource = 'text' | 'concepts' | 'guided'

export type AudiobookStatusResponse = {
  status: 'idle' | 'running' | 'done' | 'error'
  scope?: string | null
  docId?: string
  source?: string
  progress?: { done: number; total: number; current?: string | null }
  summary?: {
    file?: string
    durationSec?: number
    segments?: number
    voice?: string
    exists?: boolean
  }
  error?: string
}

function audiobookParams(scope: string | null, doc?: string, source?: AudiobookSource): URLSearchParams {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  if (source) params.set('source', source)
  return params
}

export async function startAudiobook(
  scope: string | null,
  doc: string | undefined,
  source: AudiobookSource,
  voice: string,
): Promise<AudiobookStatusResponse> {
  const params = audiobookParams(scope, doc)
  const res = await fetch(`/api/learn/audiobook?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, voice }),
  })
  return parseJsonResponse<AudiobookStatusResponse>(res)
}

export async function getAudiobookStatus(
  scope: string | null,
  doc: string | undefined,
  source: AudiobookSource,
): Promise<AudiobookStatusResponse> {
  const params = audiobookParams(scope, doc, source)
  const res = await fetch(`/api/learn/audiobook/status?${params}`, { cache: 'no-store' })
  return parseJsonResponse<AudiobookStatusResponse>(res)
}

/** URL for the generated MP3 — for the <audio> player (inline) or download (?download=1). */
export function audiobookFileUrl(
  scope: string | null,
  doc: string | undefined,
  source: AudiobookSource,
  download = false,
): string {
  const params = audiobookParams(scope, doc, source)
  if (download) params.set('download', '1')
  return `/api/learn/audiobook/file?${params}`
}

export async function fetchAudiobookVoices(): Promise<string[]> {
  try {
    const res = await fetch('/api/learn/audiobook/voices', { cache: 'no-store' })
    const data = await parseJsonResponse<{ voices?: string[] }>(res)
    return data.voices || []
  } catch {
    return []
  }
}

// --------------------------------------------------------------------------- //
// Chapter learning path — skeleton (free-recall scaffold) + per-chapter progress.
// --------------------------------------------------------------------------- //

export type SkeletonSection = {
  sectionKey: string
  heading: string
  essence: string
  // Relative TOC depth (0 = chapter/shallowest in scope) for hierarchical rendering.
  depth?: number
}

export type SkeletonResponse = {
  docId?: string
  scope?: string | null
  sections: SkeletonSection[]
  error?: string
}

export type SkeletonGrade = 'missed' | 'partial' | 'most' | 'nailed'

export async function fetchSkeleton(
  scope: string | null,
  doc?: string,
  regenerate = false,
): Promise<SkeletonResponse> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  if (regenerate) params.set('regenerate', '1')
  const res = await fetch(`/api/learn/skeleton?${params}`, { cache: 'no-store' })
  return parseJsonResponse<SkeletonResponse>(res)
}

export async function gradeSkeleton(
  scope: string | null,
  doc: string | undefined,
  grade: SkeletonGrade,
): Promise<{ stages?: Record<string, unknown>; error?: string }> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/skeleton/grade?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grade }),
  })
  return parseJsonResponse<{ stages?: Record<string, unknown>; error?: string }>(res)
}

export type ChapterProgress = { docId?: string; scope?: string | null; stages: Record<string, Record<string, unknown>> }

export async function fetchChapterProgress(scope: string | null, doc?: string): Promise<ChapterProgress> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/chapter-progress?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ChapterProgress>(res)
}

export async function updateChapterStage(
  scope: string | null,
  doc: string | undefined,
  stage: string,
  data: Record<string, unknown>,
): Promise<ChapterProgress> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/chapter-progress?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, data }),
  })
  return parseJsonResponse<ChapterProgress>(res)
}

export type OrientResponse = {
  docId?: string
  scope?: string | null
  objectives: string[]
  watchFor: string[]
  error?: string
}

export async function fetchOrient(scope: string | null, doc?: string): Promise<OrientResponse> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/orient?${params}`, { cache: 'no-store' })
  return parseJsonResponse<OrientResponse>(res)
}

// --------------------------------------------------------------------------- //
// Chapter exam — scored, interleaved MCQ across the whole chapter.
// --------------------------------------------------------------------------- //

export type ExamQuestion = { stem: string; choices: string[] }

export type ExamStartResponse = {
  sessionId?: string
  total?: number
  passPct?: number
  questions?: ExamQuestion[]
  error?: string
}

export type ExamResult = { correct: boolean; expected?: string; yourChoice?: number; explanation?: string; source?: string | null }

export type ExamGradeResponse = {
  score?: number
  correct?: number
  total?: number
  pass?: boolean
  results?: ExamResult[]
  error?: string
}

export async function startExam(scope: string | null, doc?: string, n = 12): Promise<ExamStartResponse> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/exam/start?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ n }),
  })
  return parseJsonResponse<ExamStartResponse>(res)
}

export async function gradeExam(sessionId: string, answers: number[]): Promise<ExamGradeResponse> {
  const res = await fetch('/api/learn/exam/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, answers }),
  })
  return parseJsonResponse<ExamGradeResponse>(res)
}

// Adaptive practice drill — concepts you most need (missed + weakest, interleaved). Ungraded
// practice (no pass/fail). Reuses the exam question/result shapes.
export type DrillStartResponse = {
  sessionId?: string
  total?: number
  fromMisses?: number
  questions?: ExamQuestion[]
  error?: string
}
export type DrillGradeResponse = {
  score?: number
  correct?: number
  total?: number
  results?: ExamResult[]
  error?: string
}

export async function startDrill(
  scope: string | null,
  doc?: string,
  n = 10,
): Promise<DrillStartResponse> {
  const res = await fetch('/api/learn/drill/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: doc ?? null, n }),
  })
  return parseJsonResponse<DrillStartResponse>(res)
}

export type Confidence = 'guess' | 'shaky' | 'confident'

export async function gradeDrill(
  sessionId: string,
  answers: number[],
  confidences?: (Confidence | null)[],
): Promise<DrillGradeResponse> {
  const res = await fetch('/api/learn/drill/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, answers, confidences: confidences ?? [] }),
  })
  return parseJsonResponse<DrillGradeResponse>(res)
}

// Free-recall brain dump → coverage vs the chapter's concepts.
export type RecallResponse = {
  covered: string[]
  missed: string[]
  coverage: number
  total: number
  error?: string
}

export async function checkRecall(
  scope: string | null,
  doc: string | undefined,
  text: string,
): Promise<RecallResponse> {
  const res = await fetch('/api/learn/recall/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: doc ?? null, text }),
  })
  return parseJsonResponse<RecallResponse>(res)
}

// Confidence calibration: accuracy per pre-reveal confidence level.
export type CalibrationBucket = { confidence: Confidence; count: number; correct: number; accuracy: number }
export type CalibrationResponse = { buckets: CalibrationBucket[]; total: number; error?: string }

export async function fetchCalibration(doc?: string): Promise<CalibrationResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/calibration${qs}`, { cache: 'no-store' })
  return parseJsonResponse<CalibrationResponse>(res)
}

// ── Semantic search + grounded answer (keyless: MiniLM embeddings + Ollama) ──────────────────
export type SearchMatch = {
  sectionKey: string | null
  heading: string | null
  pageStart: number | null
  pageEnd: number | null
  score: number
  snippet: string
  text?: string
}
export type SemanticSearchResponse = {
  query?: string
  matches: SearchMatch[]
  indexed?: number
  hint?: string
  error?: string
}
export type AskCitation = { n: number; sectionKey: string | null; heading: string | null; page: number | null }
export type AskResponse = {
  query?: string
  answer: string | null
  citations: AskCitation[]
  error?: string
}
export type SearchIndexStatus = { docId?: string | null; total: number; indexed: number; error?: string }

export async function semanticSearch(doc: string, q: string, k = 8): Promise<SemanticSearchResponse> {
  const params = new URLSearchParams({ doc, q, k: String(k) })
  const res = await fetch(`/api/learn/semantic-search?${params}`, { cache: 'no-store' })
  return parseJsonResponse<SemanticSearchResponse>(res)
}

export async function askTextbook(doc: string, question: string, k = 6): Promise<AskResponse> {
  const res = await fetch(`/api/learn/ask?doc=${encodeURIComponent(doc)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: question, k }),
  })
  return parseJsonResponse<AskResponse>(res)
}

export async function fetchSearchIndexStatus(doc: string): Promise<SearchIndexStatus> {
  const res = await fetch(`/api/learn/search-index?doc=${encodeURIComponent(doc)}`, { cache: 'no-store' })
  return parseJsonResponse<SearchIndexStatus>(res)
}

export async function buildSearchIndex(doc: string): Promise<SearchIndexStatus> {
  const res = await fetch(`/api/learn/search-index?doc=${encodeURIComponent(doc)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  return parseJsonResponse<SearchIndexStatus>(res)
}

// ---------------------------------------------------------------------------
// Deep Chapter — the one-call reading-first chapter surface
// ---------------------------------------------------------------------------

export type DeepChapterBriefing = {
  objectives: string[]
  watchFor: string[]
  sections: { sectionKey: string; heading: string; essence?: string; depth?: number }[]
  keyConcepts: { name: string; kind: string; signal: string }[]
  conceptCount?: number
}

export type DeepChapterStatus = {
  totalConcepts: number
  explained: number
  running: boolean
  briefing: boolean
}

export type DeepChapterResponse = {
  docId?: string
  scope: string
  briefing: DeepChapterBriefing | null
  markdown: string
  blocks: SectionContentBlock[]
  concepts: ConceptLesson[]
  sections: { sectionKey: string; title: string; essence?: string; depth?: number }[]
  augments: Record<string, { objectives: string[]; recap: string }>
  pageStart?: number | null
  pageEnd?: number | null
  status: DeepChapterStatus
  error?: string
}

export async function fetchDeepChapter(doc: string, scope: string): Promise<DeepChapterResponse> {
  const params = new URLSearchParams({ doc, scope })
  const res = await fetch(`/api/learn/deep-chapter?${params}`, { cache: 'no-store' })
  return parseJsonResponse<DeepChapterResponse>(res)
}

// --- Canonical chapters ---------------------------------------------------------
// The course dashboard's syllabus tree is the outline of record. /api/chapters is
// its single server-side derivation (content-bearing tree nodes, Parts descended);
// EVERY chapter list in the app must come from here so surfaces cannot drift.

export type CourseChapter = { key: string; title: string }

export async function fetchCourseChapters(
  doc: string,
): Promise<{ docId?: string; chapters: CourseChapter[]; error?: string }> {
  const res = await fetch(`/api/learn/chapters?doc=${encodeURIComponent(doc)}`, { cache: 'no-store' })
  return parseJsonResponse<{ docId?: string; chapters: CourseChapter[] }>(res)
}

export type ChapterOutlineItem = {
  sectionKey: string
  title: string
  number: string
  depth: number
}

/** The within-chapter outline, flattened from the SAME tree + numberSections map the
 *  course dashboard renders — the reader's rail and in-text numbering derive from this
 *  so they literally cannot disagree with the dashboard. */
export function flattenChapterOutline(
  tree: LearnTreeNode[],
  chapterKey: string,
): ChapterOutlineItem[] {
  const node = findNodeBySectionKey(tree, chapterKey)
  if (!node) return []
  const numbers = numberSections(tree)
  const out: ChapterOutlineItem[] = []
  const walk = (n: LearnTreeNode, depth: number) => {
    if (n.isSection && n.sectionKey) {
      out.push({
        sectionKey: n.sectionKey,
        title: n.title || n.label || n.sectionKey,
        number: numbers.get(n.id) ?? '',
        depth,
      })
    }
    for (const c of n.children || []) walk(c, depth + 1)
  }
  walk(node, 0)
  return out
}

// --- Course-level Today plan ---------------------------------------------------

export type TodayPlan = {
  docId?: string
  resume: {
    scope: string
    title: string
    nextStage: { key: string; label: string }
    stagesDone: number
    stagesTotal: number
  } | null
  reviewsDue: number
  nextUnbuilt: {
    key: string
    title: string
    build: { status: string; notBefore?: number | null } | null
  } | null
  chapters: { key: string; title: string; concepts: number; explained: number }[]
  error?: string
}

export async function fetchTodayPlan(doc: string, hintScope?: string | null): Promise<TodayPlan> {
  const params = new URLSearchParams({ doc })
  if (hintScope) params.set('scope', hintScope)
  const res = await fetch(`/api/learn/plan?${params}`, { cache: 'no-store' })
  return parseJsonResponse<TodayPlan>(res)
}

// --- Chapter build queue -----------------------------------------------------

export type SectionOutcome = {
  sectionKey: string
  heading: string
  status: 'ok' | 'empty' | 'error' | 'skipped'
  reason?: string
  concepts?: number
  raw?: number
  gated?: number
  malformed?: number
  chunks?: number
  error?: string
}

export type ChapterBuildJob = {
  key?: string
  scope: string
  status: 'queued' | 'running' | 'done' | 'error'
  notBefore?: number | null
  requestedAt?: number
  startedAt?: number | null
  finishedAt?: number | null
  phase?: string | null
  done?: number
  total?: number
  error?: string | null
  already?: boolean
  /** Per-section extraction report (why sections produced 0 concepts, etc.). */
  outcomes?: SectionOutcome[] | null
  concepts?: number | null
  prereqEdges?: number | null
}

export async function fetchChapterBuilds(
  doc: string,
): Promise<{ docId?: string; builds: ChapterBuildJob[]; error?: string }> {
  const res = await fetch(`/api/learn/build?doc=${encodeURIComponent(doc)}`, { cache: 'no-store' })
  return parseJsonResponse<{ docId?: string; builds: ChapterBuildJob[] }>(res)
}

export type LearnDocumentInfo = { docId: string; title: string; sourceFilename?: string }

export async function fetchLearnDocuments(): Promise<{ documents: LearnDocumentInfo[]; error?: string }> {
  const res = await fetch('/api/learn/documents', { cache: 'no-store' })
  return parseJsonResponse<{ documents: LearnDocumentInfo[] }>(res)
}

export type ChapterReadiness = {
  concepts: number
  explained: number
  briefing: boolean
  build: Pick<ChapterBuildJob, 'status' | 'notBefore' | 'phase' | 'done' | 'total' | 'error'> | null
}

export async function enqueueChapterBuild(
  doc: string,
  scope: string,
  at?: number | null,
): Promise<ChapterBuildJob & { error?: string }> {
  const params = new URLSearchParams({ doc, scope })
  const res = await fetch(`/api/learn/build?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(at ? { at } : {}),
  })
  return parseJsonResponse<ChapterBuildJob>(res)
}

export async function cancelChapterBuild(
  doc: string,
  scope: string,
): Promise<{ cancelled: boolean; reason?: string; error?: string }> {
  const params = new URLSearchParams({ doc, scope })
  const res = await fetch(`/api/learn/build/cancel?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  return parseJsonResponse<{ cancelled: boolean; reason?: string }>(res)
}

export async function fetchChaptersReadiness(
  doc: string,
  scopes: string[],
): Promise<{ docId?: string; chapters: Record<string, ChapterReadiness>; error?: string }> {
  const params = new URLSearchParams({ doc, scopes: scopes.join(',') })
  const res = await fetch(`/api/learn/build/readiness?${params}`, { cache: 'no-store' })
  return parseJsonResponse<{ docId?: string; chapters: Record<string, ChapterReadiness> }>(res)
}

export async function prepareDeepChapter(
  doc: string,
  scope: string,
): Promise<DeepChapterStatus & { started?: boolean; error?: string }> {
  const params = new URLSearchParams({ doc, scope })
  const res = await fetch(`/api/learn/deep-chapter/prepare?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  return parseJsonResponse<DeepChapterStatus & { started?: boolean }>(res)
}
