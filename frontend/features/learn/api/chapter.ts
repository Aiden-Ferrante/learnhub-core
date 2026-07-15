/** The chapter learning path: skeleton, orient, per-chapter progress, Deep Chapter, Today plan. */
import { parseJsonResponse } from './http'
import type { SectionContentBlock } from './content'
import type { ConceptLesson } from './concepts'

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

