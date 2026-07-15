/** Assessment: concept MCQs, chapter exams, adaptive drills, free-recall checks. */
import { parseJsonResponse } from './http'

// ----- Deterministic concept MCQ (keyless) -----

export type ConceptQuizSession = {
  sessionId: string
  stem: string
  choices: string[]
  error?: string
}

export type ConceptQuizResult = {
  correct: boolean
  expected: string
  signal?: string | null
  source?: string | null
  error?: string
}

export async function startConceptQuiz(
  scope: string | null,
  docId?: string,
): Promise<ConceptQuizSession> {
  const res = await fetch('/api/learn/concept-quiz/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: docId ?? null }),
  })
  return parseJsonResponse<ConceptQuizSession>(res)
}

export async function submitConceptAnswer(
  sessionId: string,
  choiceIndex: number,
): Promise<ConceptQuizResult> {
  const res = await fetch('/api/learn/concept-quiz/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, choiceIndex }),
  })
  return parseJsonResponse<ConceptQuizResult>(res)
}

// Application-question authoring progress for a chapter scope.
export type QuizPrepareStatus = { total: number; authored: number; running: boolean; error?: string }

export async function fetchQuizPrepareStatus(
  scope: string | null,
  docId?: string,
): Promise<QuizPrepareStatus> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (docId) params.set('doc', docId)
  const res = await fetch(`/api/learn/concept-quiz/prepare?${params}`, { cache: 'no-store' })
  return parseJsonResponse<QuizPrepareStatus>(res)
}

// Kick off authoring of ALL of a chapter's application questions up front (background).
export async function prepareQuizQuestions(
  scope: string | null,
  docId?: string,
): Promise<QuizPrepareStatus> {
  const res = await fetch('/api/learn/concept-quiz/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: docId ?? null }),
  })
  return parseJsonResponse<QuizPrepareStatus>(res)
}

// --------------------------------------------------------------------------- //
// Chapter exam — scored, interleaved MCQ across the whole chapter.
// --------------------------------------------------------------------------- //

export type ExamQuestion = { stem: string; choices: string[] }

export type ExamStartResponse = {
  sessionId?: string
  total?: number
  passPct?: number
  questions?: ExamQuestion[]
  error?: string
}

export type ExamResult = { correct: boolean; expected?: string; yourChoice?: number; explanation?: string; source?: string | null }

export type ExamGradeResponse = {
  score?: number
  correct?: number
  total?: number
  pass?: boolean
  results?: ExamResult[]
  error?: string
}

export async function startExam(scope: string | null, doc?: string, n = 12): Promise<ExamStartResponse> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/exam/start?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ n }),
  })
  return parseJsonResponse<ExamStartResponse>(res)
}

export async function gradeExam(sessionId: string, answers: number[]): Promise<ExamGradeResponse> {
  const res = await fetch('/api/learn/exam/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, answers }),
  })
  return parseJsonResponse<ExamGradeResponse>(res)
}

// Adaptive practice drill — concepts you most need (missed + weakest, interleaved). Ungraded
// practice (no pass/fail). Reuses the exam question/result shapes.
export type DrillStartResponse = {
  sessionId?: string
  total?: number
  fromMisses?: number
  questions?: ExamQuestion[]
  error?: string
}
export type DrillGradeResponse = {
  score?: number
  correct?: number
  total?: number
  results?: ExamResult[]
  error?: string
}

export async function startDrill(
  scope: string | null,
  doc?: string,
  n = 10,
): Promise<DrillStartResponse> {
  const res = await fetch('/api/learn/drill/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: doc ?? null, n }),
  })
  return parseJsonResponse<DrillStartResponse>(res)
}

export type Confidence = 'guess' | 'shaky' | 'confident'

export async function gradeDrill(
  sessionId: string,
  answers: number[],
  confidences?: (Confidence | null)[],
): Promise<DrillGradeResponse> {
  const res = await fetch('/api/learn/drill/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, answers, confidences: confidences ?? [] }),
  })
  return parseJsonResponse<DrillGradeResponse>(res)
}

// Free-recall brain dump → coverage vs the chapter's concepts.
export type RecallResponse = {
  covered: string[]
  missed: string[]
  coverage: number
  total: number
  error?: string
}

export async function checkRecall(
  scope: string | null,
  doc: string | undefined,
  text: string,
): Promise<RecallResponse> {
  const res = await fetch('/api/learn/recall/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: doc ?? null, text }),
  })
  return parseJsonResponse<RecallResponse>(res)
}

