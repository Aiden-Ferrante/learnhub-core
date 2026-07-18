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
