/** Exam sittings — the one assembly over the practice pool that is stored, not queried.
 *
 * A sitting FREEZES its questions when it is created (prompt and worked solution are
 * snapshotted into the row), so regenerating the chapter mid-exam cannot change the paper
 * under you, and a resit months later is genuinely the same exam. Answers are saved one at
 * a time, so a closed tab costs nothing.
 *
 * Grading goes to `/exams/{key}/grade`, which routes to the same FSRS engine as the
 * practice session and only tags the study event differently.
 */
import { parseJsonResponse } from './http'
import type { PracticeKind } from './practice'

/** A question as it was ASKED — frozen at creation, never re-read from the pool. */
export type ExamQuestion = {
  key: string
  kind: PracticeKind
  prompt: string
  answer: string
  rubric: string | null
  sectionKey: string
}

export type ExamAnswer = {
  response?: string
  selfGrade?: 1 | 2 | 3 | 4
  at?: number
}

export type ExamSitting = {
  key: string
  docId: string
  scope: string | null
  config: { chapters?: string[]; perChapter?: number; kinds?: string[] | null }
  questions: ExamQuestion[]
  answers: Record<string, ExamAnswer>
  resitOf: string | null
  status: 'open' | 'finished' | 'abandoned'
  startedAt: number | null
  finishedAt: number | null
  error?: string
}

/** One unit of the results breakdown — `graded` may trail `total` when you stop early,
 *  and an ungraded question is reported as ungraded rather than counted wrong. */
export type ExamBucket = { total: number; graded: number; good: number }

export type ExamResults = ExamSitting & {
  score: { graded: number; good: number; fraction: number | null }
  bySection: Record<string, ExamBucket>
  byKind: Record<string, ExamBucket>
  comparison: { key: string; score: ExamResults['score']; finishedAt: number | null } | null
}

export type ExamSummary = {
  key: string
  scope: string | null
  config: ExamSitting['config']
  status: ExamSitting['status']
  resitOf: string | null
  startedAt: number | null
  finishedAt: number | null
  count: number
  answered: number
  score: ExamResults['score'] | null
}

export async function fetchExams(docId?: string): Promise<{ exams: ExamSummary[] }> {
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/exams${qs}`, { cache: 'no-store' })
  return parseJsonResponse(res)
}

export async function createExam(
  docId: string | undefined,
  chapters: string[],
  perChapter: number,
  kinds?: PracticeKind[],
): Promise<ExamSitting> {
  const res = await fetch('/api/learn/exams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: docId ?? null, chapters, perChapter, kinds: kinds ?? null }),
  })
  return parseJsonResponse<ExamSitting>(res)
}

export async function fetchExam(key: string): Promise<ExamSitting> {
  const res = await fetch(`/api/learn/exams/${encodeURIComponent(key)}`, { cache: 'no-store' })
  return parseJsonResponse<ExamSitting>(res)
}

export async function saveExamAnswer(
  key: string,
  itemKey: string,
  response: string,
): Promise<{ saved?: string; error?: string }> {
  const res = await fetch(`/api/learn/exams/${encodeURIComponent(key)}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemKey, response }),
  })
  return parseJsonResponse(res)
}

export async function finishExam(key: string): Promise<ExamSitting> {
  const res = await fetch(`/api/learn/exams/${encodeURIComponent(key)}/finish`, { method: 'POST' })
  return parseJsonResponse<ExamSitting>(res)
}

/** `scheduled: false` means the item was regenerated away since the sitting — the grade is
 *  kept on your paper but fed nothing, which the results screen says out loud. */
export async function gradeExamAnswer(
  key: string,
  itemKey: string,
  grade: 1 | 2 | 3 | 4,
  docId?: string,
): Promise<{ graded?: string; scheduled?: boolean; error?: string }> {
  const res = await fetch(`/api/learn/exams/${encodeURIComponent(key)}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemKey, grade, doc: docId ?? null }),
  })
  return parseJsonResponse(res)
}

export async function fetchExamResults(key: string): Promise<ExamResults> {
  const res = await fetch(`/api/learn/exams/${encodeURIComponent(key)}/results`, {
    cache: 'no-store',
  })
  return parseJsonResponse<ExamResults>(res)
}

export async function resitExam(key: string): Promise<ExamSitting> {
  const res = await fetch(`/api/learn/exams/${encodeURIComponent(key)}/resit`, { method: 'POST' })
  return parseJsonResponse<ExamSitting>(res)
}
