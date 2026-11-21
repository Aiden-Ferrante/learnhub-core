/** Library search reads. Passages come from the keyword locate tool (/api/search); there is
 *  no meaning (embedding) search on the server yet — the UI's "Meaning" mode waits for it. */
import { parseJsonResponse } from './http'

export type PassageMatch = {
  /** The book the passage is in (a learnDocId). */
  docId: string
  sectionKey: string
  heading?: string | null
  pageStart?: number | null
  pageEnd?: number | null
  score: number
  /** "2/3" — how many of the query's words the passage has. */
  termsMatched: string
  snippet: string
}

export type PassageSearchResponse = {
  query: string
  terms?: string[]
  total?: number
  matches: PassageMatch[]
  error?: string
}

export async function fetchPassages(q: string, doc?: string | null, limit = 8, signal?: AbortSignal): Promise<PassageSearchResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) })
  if (doc) params.set('doc', doc)
  const res = await fetch(`/api/learn/search?${params}`, { signal, cache: 'no-store' })
  const data = await parseJsonResponse<PassageSearchResponse>(res)
  // A per-book search knows its book; the server fills docId in both cases since v0.32.0.
  return { ...data, matches: (data.matches ?? []).map((m) => ({ ...m, docId: m.docId ?? doc ?? '' })) }
}
