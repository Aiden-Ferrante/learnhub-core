/** Processing pipeline: extraction, chapter build queue, jobs ledger, system status. */
import { parseJsonResponse } from './http'

// One pipeline status per course: whether the learn content exists (a dead learnDocId is the
// "content link broken" empty state), and chapter-level concept coverage for the strip.
export type CoursePipelineStatus = {
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
  conceptCount?: number
  error?: string
}

export async function fetchCourseStatus(doc: string): Promise<CoursePipelineStatus> {
  const res = await fetch(`/api/learn/course-status?doc=${encodeURIComponent(doc)}`, {
    cache: 'no-store',
  })
  // 404 = the course points at content that no longer exists — a state the caller renders,
  // not an exception (parseJsonResponse would throw on it).
  const body = (await res.json().catch(() => ({}))) as Partial<CoursePipelineStatus>
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
  const useModel = model
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

/** Every artifact the processing queue can produce. "build" = extraction + deep overlay;
 *  the rest regenerate one artifact for one chapter. */
export type BuildKind = 'build' | 'guides' | 'skeleton' | 'orient'

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

