/** The /study planner's data: the cross-course review calendar (when everything comes due)
 *  and derived working sessions (gap-clustered study_events). Read-only aggregators. */

import { parseJsonResponse } from './http'

export type CalendarCourse = {
  doc: string
  title: string
  count: number
  /** concept | skeleton | figure | chapter → count */
  byType: Record<string, number>
}

export type CalendarDay = {
  date: string // YYYY-MM-DD (UTC)
  total: number
  courses: CalendarCourse[]
}

export type ReviewCalendar = {
  dueNow: { total: number; courses: CalendarCourse[] }
  /** Only days with something due — the grid lays out the full range. */
  days: CalendarDay[]
  horizonDays: number
  tracked?: number
  error?: string
}

export async function fetchReviewCalendar(days = 60): Promise<ReviewCalendar> {
  const res = await fetch(`/api/learn/review-calendar?days=${days}`, { cache: 'no-store' })
  return parseJsonResponse<ReviewCalendar>(res)
}

export type WorkingSession = {
  start: number
  end: number
  durationMin: number
  events: number
  kinds: Record<string, number>
  /** The dominant kind — what the session mostly was (read/review/skeleton/resurface…). */
  kind: string
  courses: { doc: string; title: string }[]
  scopes: string[]
  graded: number
  correct: number
  /** Manual time blocks (the stored corrections layer) — editable; derived sessions are not. */
  manual?: boolean
  key?: string
  note?: string | null
}

export type SessionsResponse = {
  sessions: WorkingSession[]
  summary: { count?: number; totalMinutes?: number; byKind?: Record<string, number>; days?: number }
  error?: string
}

// `docId` is the learn-doc-key (course.learnDocId), matching the rest of features/learn/api;
// it becomes the backend's ?doc= query param. See frontend ARCHITECTURE.md "Identifiers".
export async function fetchSessions(days = 90, docId?: string): Promise<SessionsResponse> {
  const params = new URLSearchParams({ days: String(days) })
  if (docId) params.set('doc', docId)
  const res = await fetch(`/api/learn/study-sessions?${params}`, { cache: 'no-store' })
  return parseJsonResponse<SessionsResponse>(res)
}

// --- Manual time blocks --------------------------------------------------------
// The one stored layer over the derived sessions (backend manual_sessions table).
// `doc` is the learn-doc-key; timestamps are epoch SECONDS, matching WorkingSession.

export type ManualSessionInput = {
  doc: string
  start: number
  end: number
  note?: string | null
  /** Present = update that block; absent = create. */
  key?: string
}

export async function saveManualSession(
  input: ManualSessionInput,
): Promise<{ ok?: boolean; key?: string; error?: string }> {
  const res = await fetch('/api/learn/study/manual-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parseJsonResponse<{ ok?: boolean; key?: string; error?: string }>(res)
}

export async function deleteManualSession(key: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`/api/learn/study/manual-session?key=${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
  return parseJsonResponse<{ ok?: boolean; error?: string }>(res)
}
