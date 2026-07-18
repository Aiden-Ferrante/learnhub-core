/** Study tracking read models — the three-question split:
 *  memory state (coverage + FSRS retention), history (activity + cadence), action (debt). */
import { parseJsonResponse } from './http'

export type MemoryState = 'new' | 'solid' | 'shaky' | 'fading'

/** One unit's memory summary: how much is touched (coverage) and how well it holds
 *  right now (mean FSRS retrievability over reviewed concepts; null = nothing reviewed). */
export type SectionMemory = {
  total: number
  reviewed: number
  coverage: number
  retention: number | null
  state: MemoryState
  fading: number
}

export type FadingSection = SectionMemory & {
  sectionKey: string
  label: string
  title?: string | null
}

export type MasteryResponse = {
  bySection: Record<string, SectionMemory>
  overall: SectionMemory
  fading: FadingSection[]
  thresholds?: { solid: number; shaky: number }
  error?: string
}

export type ActivityDay = { date: string; count: number }

export type ActivityResponse = {
  days: ActivityDay[]
  total: number
  max: number
  /** Per-engagement-kind counts (review | skeleton | read | listen | …). */
  byKind?: Record<string, number>
  /** Cadence: days with at least one graded review in the trailing window. */
  cadence?: { reviewedDays: number; windowDays: number }
  error?: string
}

export async function fetchMastery(doc?: string): Promise<MasteryResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/mastery${qs}`, { cache: 'no-store' })
  return parseJsonResponse<MasteryResponse>(res)
}

export async function fetchActivity(doc?: string): Promise<ActivityResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/activity${qs}`, { cache: 'no-store' })
  return parseJsonResponse<ActivityResponse>(res)
}

// Record a passive engagement event (read/listen/…) so the dashboard reflects all study,
// not just graded reviews. Fire-and-forget — never blocks the UI.
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
  /** FSRS retrievability right now; null until first review. */
  retention: number | null
  state: MemoryState
  due?: number | null
  scheduleState?: string
  attempts: number
  accuracy?: number | null
  lastSeen?: number | null
}

export type ConceptMasteryResponse = {
  byConcept: Record<string, ConceptMastery>
  overall: number | null
  counts?: { new: number; solid: number; shaky: number; fading: number; total: number }
  thresholds?: { solid: number; shaky: number }
  error?: string
}

export async function fetchConceptMastery(docId?: string): Promise<ConceptMasteryResponse> {
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/concept-mastery${qs}`, { cache: 'no-store' })
  return parseJsonResponse<ConceptMasteryResponse>(res)
}

