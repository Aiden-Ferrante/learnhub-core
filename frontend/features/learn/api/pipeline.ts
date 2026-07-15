/** Processing pipeline: extraction, chapter build queue, coverage grid, jobs ledger, system status. */
import { parseJsonResponse } from './http'

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

// Delete a course's learn content outright (document, sections, concepts, reviews, artifacts).
export async function deleteLearnDocument(
  doc: string,
): Promise<{ deleted?: string; removed?: Record<string, number>; error?: string }> {
  const res = await fetch(`/api/learn/document?doc=${encodeURIComponent(doc)}`, {
    method: 'DELETE',
  })
  return parseJsonResponse(res)
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
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  cancelRequested?: boolean | null
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
  briefing: boolean
  build: Pick<ChapterBuildJob, 'status' | 'notBefore' | 'phase' | 'done' | 'total' | 'error'> | null
}

/** Every artifact the processing queue can produce. "build" = extraction + deep overlay;
 *  the rest regenerate one artifact for one chapter. */
export type BuildKind = 'build' | 'quizzes' | 'guides' | 'skeleton' | 'orient'

export async function enqueueChapterBuild(
  doc: string,
  scope: string,
  at?: number | null,
  kind: BuildKind = 'build',
): Promise<ChapterBuildJob & { error?: string }> {
  const params = new URLSearchParams({ doc, scope })
  const res = await fetch(`/api/learn/build?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(at ? { at } : {}), ...(kind !== 'build' ? { kind } : {}) }),
  })
  return parseJsonResponse<ChapterBuildJob>(res)
}

// ----- Processing ledger + coverage grid (the de-black-boxed pipeline) -----

export type PipelineJobState = {
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  notBefore?: number | null
  phase?: string | null
  done?: number
  total?: number
  error?: string | null
}

export type ChapterCoverage = {
  scope: string
  title: string
  sections: number
  concepts: number
  quizzes: { authored: number; total: number }
  skeleton: 'fresh' | 'stale' | 'missing'
  orient: boolean
  briefing: boolean
  guides: { authored: number; total: number }
  audiobooks: string[]
  readAlong: boolean
  jobs: Partial<Record<BuildKind, PipelineJobState>>
}

export async function fetchCoverage(
  doc: string,
): Promise<{ docId?: string; chapters: ChapterCoverage[]; error?: string }> {
  const res = await fetch(`/api/learn/coverage?doc=${encodeURIComponent(doc)}`, { cache: 'no-store' })
  return parseJsonResponse<{ docId?: string; chapters: ChapterCoverage[] }>(res)
}

export type PipelineLedgerRow = ChapterBuildJob & { kind: BuildKind; receipt?: Record<string, unknown> | null }

export async function fetchJobsLedger(
  doc: string,
): Promise<{ docId?: string; builds: PipelineLedgerRow[]; error?: string }> {
  const res = await fetch(`/api/learn/jobs?doc=${encodeURIComponent(doc)}`, { cache: 'no-store' })
  return parseJsonResponse<{ docId?: string; builds: PipelineLedgerRow[] }>(res)
}

export async function cancelChapterBuild(
  doc: string,
  scope: string,
  kind: BuildKind = 'build',
): Promise<{ cancelled: boolean; cancelling?: boolean; reason?: string; error?: string }> {
  const params = new URLSearchParams({ doc, scope, ...(kind !== 'build' ? { kind } : {}) })
  const res = await fetch(`/api/learn/build/cancel?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  return parseJsonResponse<{ cancelled: boolean; cancelling?: boolean; reason?: string }>(res)
}

// ----- System status (the Process tab's machine strip) -----

export type OllamaLoadedModel = {
  name: string
  size?: number
  sizeVram?: number
  expiresAt?: string
}

export type RunningJobInfo = {
  docId: string
  scope: string
  kind: BuildKind
  phase?: string | null
  done?: number
  total?: number
  startedAt?: number | null
  cancelRequested?: boolean | null
  docTitle?: string
  chapterTitle?: string
}

export type SystemStatus = {
  ollama: { ok: boolean; models: OllamaLoadedModel[]; error?: string }
  memory: { totalBytes: number; usedBytes: number } | null
  queue: {
    paused: boolean
    running: RunningJobInfo | null
    queuedCount: number
    scheduledCount: number
    nextScheduledAt: number | null
  }
}

export async function fetchSystemStatus(): Promise<SystemStatus & { error?: string }> {
  const res = await fetch('/api/learn/system', { cache: 'no-store' })
  return parseJsonResponse<SystemStatus>(res)
}

export async function setQueuePaused(paused: boolean): Promise<{ paused: boolean; error?: string }> {
  const res = await fetch('/api/learn/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  })
  return parseJsonResponse<{ paused: boolean }>(res)
}

export async function fetchChaptersReadiness(
  doc: string,
  scopes: string[],
): Promise<{ docId?: string; chapters: Record<string, ChapterReadiness>; error?: string }> {
  const params = new URLSearchParams({ doc, scopes: scopes.join(',') })
  const res = await fetch(`/api/learn/build/readiness?${params}`, { cache: 'no-store' })
  return parseJsonResponse<{ docId?: string; chapters: Record<string, ChapterReadiness> }>(res)
}

