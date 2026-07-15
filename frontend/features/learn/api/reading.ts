/** Guided reading: the book's text scaffolded with focus notes + checks per section. */
import { parseJsonResponse } from './http'

// ---- Guided reading: the book's text, scaffolded with focus notes + checks per section ----
export type ReadingCheck = { q: string; a: string }
export type ReadingGuideSection = {
  sectionKey: string
  heading: string
  markdown: string
  depth: number
  essence?: string
  focus?: string
  checks?: ReadingCheck[]
  pageStart?: number | null
  pageEnd?: number | null
}
export type ReadingGuideResponse = {
  docId?: string
  scope?: string | null
  sections: ReadingGuideSection[]
  error?: string
}

export async function fetchReadingGuide(
  scope: string | null,
  docId?: string,
): Promise<ReadingGuideResponse> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (docId) params.set('doc', docId)
  const res = await fetch(`/api/learn/reading-guide?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ReadingGuideResponse>(res)
}

export type ReadingPrepareStatus = { total: number; authored: number; running: boolean; error?: string }

export async function fetchReadingPrepareStatus(
  scope: string | null,
  docId?: string,
): Promise<ReadingPrepareStatus> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (docId) params.set('doc', docId)
  const res = await fetch(`/api/learn/reading-guide/prepare?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ReadingPrepareStatus>(res)
}

export async function prepareReadingGuide(
  scope: string | null,
  docId?: string,
): Promise<ReadingPrepareStatus> {
  const res = await fetch('/api/learn/reading-guide/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, doc: docId ?? null }),
  })
  return parseJsonResponse<ReadingPrepareStatus>(res)
}

