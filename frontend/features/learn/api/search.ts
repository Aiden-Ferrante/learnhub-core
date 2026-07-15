/** Semantic search + grounded ask over the book (keyless embeddings + Ollama). */
import { parseJsonResponse } from './http'

// ── Semantic search + grounded answer (keyless: MiniLM embeddings + Ollama) ──────────────────
export type SearchMatch = {
  sectionKey: string | null
  heading: string | null
  pageStart: number | null
  pageEnd: number | null
  score: number
  snippet: string
  text?: string
}
export type SemanticSearchResponse = {
  query?: string
  matches: SearchMatch[]
  indexed?: number
  hint?: string
  error?: string
}
export type AskCitation = { n: number; sectionKey: string | null; heading: string | null; page: number | null }
export type AskResponse = {
  query?: string
  answer: string | null
  citations: AskCitation[]
  error?: string
}
export type SearchIndexStatus = { docId?: string | null; total: number; indexed: number; error?: string }

export async function semanticSearch(doc: string, q: string, k = 8): Promise<SemanticSearchResponse> {
  const params = new URLSearchParams({ doc, q, k: String(k) })
  const res = await fetch(`/api/learn/semantic-search?${params}`, { cache: 'no-store' })
  return parseJsonResponse<SemanticSearchResponse>(res)
}

export async function askTextbook(doc: string, question: string, k = 6): Promise<AskResponse> {
  const res = await fetch(`/api/learn/ask?doc=${encodeURIComponent(doc)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: question, k }),
  })
  return parseJsonResponse<AskResponse>(res)
}

export async function fetchSearchIndexStatus(doc: string): Promise<SearchIndexStatus> {
  const res = await fetch(`/api/learn/search-index?doc=${encodeURIComponent(doc)}`, { cache: 'no-store' })
  return parseJsonResponse<SearchIndexStatus>(res)
}

export async function buildSearchIndex(doc: string): Promise<SearchIndexStatus> {
  const res = await fetch(`/api/learn/search-index?doc=${encodeURIComponent(doc)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  return parseJsonResponse<SearchIndexStatus>(res)
}

