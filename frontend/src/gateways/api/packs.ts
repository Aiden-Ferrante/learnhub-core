/** Exam packs: chapters of one textbook built into Learn and an exam pool. */
import { parseJsonResponse } from './http'

export type PackFormat = {
  count: number
  minutes: number
  choices: 4 | 5
  writtenShare: number
  closedBook: boolean
}

export type PackSummary = {
  key: string
  title: string
  status: 'building' | 'ready' | 'failed'
  examDate: string | null
  units: number
  ready: number
  sittings: number
}

export type UnitProgress = { chunk?: boolean; steps?: boolean; test?: { good: number; total: number } }

export type UnitReceipt = {
  source?: 'book_summary' | 'sections'
  bookProblems?: number
  skills?: number
  kept?: number
  droppedCount?: number
  dropped?: { kind: string; what: string; reason: string }[]
  capacity?: number
  share?: number
  thin?: boolean
  error?: string
}

export type PackUnit = {
  key: string
  sectionKey: string
  title: string
  status: 'queued' | 'building' | 'ready' | 'failed'
  receipt: UnitReceipt | null
  progress: UnitProgress
}

export type SittingSummary = {
  key: string
  status: 'open' | 'finished'
  startedAt: number
  shortBy: number
  questions: number
}

export type Pack = {
  key: string
  docId: string
  title: string
  config: { format: PackFormat; scopeNotes: string }
  examDate: string | null
  status: PackSummary['status']
  units: PackUnit[]
  sittings: SittingSummary[]
}

export type Step = { ask: string; show: string }

export type LearnQuestion = {
  itemKey: string
  skill: string
  skillLabel: string
  sectionKey: string
  origin: 'book_problem' | 'variant' | 'generated'
  qtype: string
  stem: string
  choices?: string[]
  answer?: number | string | null
  printedAnswer?: string
  explain?: string
  steps?: Step[]
}

export type LearnUnit = {
  key: string
  title: string
  status: PackUnit['status']
  chunk: { points: { text: string; sectionKey: string }[]; source: string } | null
  progress: UnitProgress
  worked: LearnQuestion[]
  bookProblems: LearnQuestion[]
  test: LearnQuestion[]
}

export type PlanStep = {
  kind: 'review' | 'learn' | 'weak' | 'exam'
  title: string
  minutes: number | null
  unitKey: string | null
  stage?: 'chunk' | 'steps' | 'test'
}

export type Today = { now: PlanStep | null; next: PlanStep[]; examDate: string | null }

export type SitQuestion = {
  key: string
  qtype: 'choice' | 'written'
  unitKey: string
  skill?: string
  skillLabel: string
  stem: string
  choices?: string[]
  sectionKey: string
  answer?: number | string
  explain?: string
  rubric?: string
  steps?: Step[]
  why?: Record<string, string>
}

export type SitAnswer = { choice?: number; response?: string; flag?: boolean; selfGrade?: number }

export type Sitting = {
  key: string
  packKey: string
  questions: SitQuestion[]
  answers: Record<string, SitAnswer>
  minutes: number | null
  shortBy: number
  status: 'open' | 'finished'
  startedAt: number
}

export type Bucket = { total: number; good: number; pending: number; label?: string; sectionKey?: string }

export type SittingResults = Sitting & {
  score: {
    good: number
    total: number
    pending: number
    provisional: boolean
    units: Record<string, Bucket>
    skills: Record<string, Bucket>
    verdicts: Record<string, boolean | null>
  }
}

const base = '/api/learn'
const enc = encodeURIComponent

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return parseJsonResponse<T>(await fetch(`${base}${path}`, { signal, cache: 'no-store' }))
}

async function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return parseJsonResponse<T>(
    await fetch(`${base}${path}`, {
      signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  )
}

export const fetchPacks = (doc: string, signal?: AbortSignal) =>
  get<{ packs: PackSummary[] }>(`/packs?doc=${enc(doc)}`, signal)
export const fetchPresets = (doc: string, signal?: AbortSignal) =>
  get<{ presets: { name: string; format: PackFormat }[]; default: PackFormat }>(`/packs/presets?doc=${enc(doc)}`, signal)
export const savePreset = (doc: string, name: string, format: PackFormat, signal?: AbortSignal) =>
  post('/packs/presets', { doc, name, format }, signal)
export const createPack = (
  body: {
    doc: string
    title: string
    chapters: { scope: string; title: string }[]
    format: PackFormat
    scopeNotes: string
    examDate: string | null
  },
  signal?: AbortSignal,
) => post<{ key: string }>('/packs', body, signal)
export const fetchPack = (key: string, signal?: AbortSignal) => get<Pack>(`/packs/${enc(key)}`, signal)
export const fetchToday = (key: string, signal?: AbortSignal) => get<Today>(`/packs/${enc(key)}/today`, signal)
export const fetchReviewSet = (key: string, signal?: AbortSignal) =>
  get<{ questions: LearnQuestion[] }>(`/packs/${enc(key)}/review`, signal)
export const fetchUnit = (key: string, unit: string, signal?: AbortSignal) =>
  get<LearnUnit>(`/packs/${enc(key)}/units/${enc(unit)}`, signal)
export const saveProgress = (key: string, unit: string, patch: UnitProgress, signal?: AbortSignal) =>
  post(`/packs/${enc(key)}/units/${enc(unit)}/progress`, patch, signal)
export const gradeSkill = (key: string, skill: string, correct: boolean, signal?: AbortSignal) =>
  post(`/packs/${enc(key)}/grade`, { skill, correct }, signal)
export const startSitting = (key: string, signal?: AbortSignal) =>
  post<Sitting>(`/packs/${enc(key)}/sittings`, undefined, signal)
export const fetchSitting = (key: string, signal?: AbortSignal) => get<Sitting>(`/sittings/${enc(key)}`, signal)
export const saveSitAnswer = (key: string, questionKey: string, answer: SitAnswer, signal?: AbortSignal) =>
  post(`/sittings/${enc(key)}/answer`, { questionKey, answer }, signal)
export const finishSitting = (key: string, signal?: AbortSignal) =>
  post<SittingResults>(`/sittings/${enc(key)}/finish`, undefined, signal)
export const markWritten = (key: string, questionKey: string, grade: number, signal?: AbortSignal) =>
  post<SittingResults>(`/sittings/${enc(key)}/mark`, { questionKey, grade }, signal)
export const fetchResults = (key: string, signal?: AbortSignal) =>
  get<SittingResults>(`/sittings/${enc(key)}/results`, signal)
