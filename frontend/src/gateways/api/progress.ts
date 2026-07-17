/** Study progress rollups: mastery, mistakes, activity, forecast, calibration, study debt. */
import { parseJsonResponse } from './http'
import type { Confidence } from './quiz'

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

export type ConceptMastery = {
  name: string
  sectionKey: string
  mastery: number
  attempts: number
  due?: number | null
  state?: string
  /** Study gate: mastered (≥ threshold) | ready (not yet mastered). */
  gate?: 'mastered' | 'ready'
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

// Confidence calibration: accuracy per pre-reveal confidence level.
export type CalibrationBucket = { confidence: Confidence; count: number; correct: number; accuracy: number }
export type CalibrationResponse = { buckets: CalibrationBucket[]; total: number; error?: string }

export async function fetchCalibration(doc?: string): Promise<CalibrationResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/calibration${qs}`, { cache: 'no-store' })
  return parseJsonResponse<CalibrationResponse>(res)
}

