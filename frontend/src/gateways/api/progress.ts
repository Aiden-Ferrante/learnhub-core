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
  /** Days with ANY study activity (events or manual blocks) in the trailing window. */
  cadence?: { activeDays: number; windowDays: number }
  error?: string
}

export async function fetchMastery(doc?: string, signal?: AbortSignal): Promise<MasteryResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/mastery${qs}`, { signal, cache: 'no-store' })
  return parseJsonResponse<MasteryResponse>(res)
}

/** Whole-book summaries for many courses in one call (the Library shelf). null = unreadable. */
export async function fetchMasteryOverall(
  docs: string[],
  signal?: AbortSignal,
): Promise<{ overall: Record<string, SectionMemory | null>; error?: string }> {
  const res = await fetch(`/api/learn/mastery/overall?docs=${encodeURIComponent(docs.join(','))}`, {
    signal,
    cache: 'no-store',
  })
  return parseJsonResponse(res)
}

export async function fetchActivity(doc?: string, signal?: AbortSignal): Promise<ActivityResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/activity${qs}`, { signal, cache: 'no-store' })
  return parseJsonResponse<ActivityResponse>(res)
}

/** Record a passive engagement event (read/listen/…) so the dashboard reflects all study,
 *  not just graded reviews. Callers fire it as a mutation and never block on it; a failed
 *  request throws (ApiError) so the caller can say so. A null scope records nothing. */
export async function recordEngagement(
  kind: string,
  scope: string | null,
  doc?: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!scope) return
  const res = await fetch('/api/learn/engagement', {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, scope, doc: doc ?? null }),
  })
  await parseJsonResponse<unknown>(res)
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

export async function fetchStudyDebt(days = 7, signal?: AbortSignal): Promise<StudyDebt> {
  const res = await fetch(`/api/learn/study-debt?days=${days}`, { signal, cache: 'no-store' })
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

export async function fetchConceptMastery(docId?: string, signal?: AbortSignal): Promise<ConceptMasteryResponse> {
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/concept-mastery${qs}`, { signal, cache: 'no-store' })
  return parseJsonResponse<ConceptMasteryResponse>(res)
}
