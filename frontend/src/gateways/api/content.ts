/** Document content: markdown, per-section text blocks, and extracted figures. */
import { ApiError, onUnauthorized, parseJsonResponse } from './http'
import type { OutlineEntry } from './outline'

export type DocumentMeta = {
  id: string
  title: string
  sourceFilename: string
  markdown: string
  pageCount: number
  charCount: number
  sectionCount: number
  outline?: OutlineEntry[]
  createdAt: number
}

export type DocumentResponse = {
  document: DocumentMeta | null
  error?: string
}

export type SectionContentBlock = {
  sectionKey: string
  heading: string
  level: number
  order: number
  pageStart?: number | null
  pageEnd?: number | null
}

export type SectionContentResponse = {
  sectionKey: string
  docId?: string
  blocks: SectionContentBlock[]
  markdown: string
  error?: string
}

export async function fetchDocumentMarkdown(id?: string, signal?: AbortSignal): Promise<DocumentResponse> {
  const qs = id ? `?id=${encodeURIComponent(id)}` : ''
  const res = await fetch(`/api/learn/document${qs}`, { signal, cache: 'no-store' })
  return parseJsonResponse<DocumentResponse>(res)
}

export async function fetchSectionContent(
  sectionKey: string,
  docId?: string,
  signal?: AbortSignal,
): Promise<SectionContentResponse> {
  const segs = sectionKey.split('/').map(encodeURIComponent).join('/')
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/section/content/${segs}${qs}`, { signal, cache: 'no-store' })
  return parseJsonResponse<SectionContentResponse>(res)
}

// ----- Typed document elements (figures/tables extracted from the PDF) -----

export type LearnFigure = {
  type: string
  sectionKey: string
  page?: number | null
  order: number
  caption?: string | null
  imageRef?: string | null
}

/** Captioned figures for a section (and its descendants). The image itself is served by
 *  /api/learn/figure?doc=…&n={order}. */
export async function fetchSectionFigures(docId: string, sectionKey: string, signal?: AbortSignal): Promise<LearnFigure[]> {
  const params = new URLSearchParams({ doc: docId, scope: sectionKey, type: 'figure' })
  const res = await fetch(`/api/learn/elements?${params}`, { signal, cache: 'no-store' })
  const data = await parseJsonResponse<{ elements?: LearnFigure[]; error?: string }>(res)
  return (data.elements ?? []).filter((e) => (e.caption ?? '').trim())
}

export function figureUrl(docId: string, order: number): string {
  return `/api/learn/figure?doc=${encodeURIComponent(docId)}&n=${order}`
}

/** URL of a course's original PDF (the native viewer and the HEAD probe use the same one). */
export function originalPdfUrl(docId: string): string {
  return `/api/learn/pdf?doc=${encodeURIComponent(docId)}`
}

/** Whether a course has its original PDF: a HEAD on the PDF route. 404 = no PDF (a
 *  markdown/txt ingest); any other failure throws an ApiError so the screen can offer Retry. */
export async function fetchOriginalPdfAvailable(docId: string, signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(originalPdfUrl(docId), { signal, method: 'HEAD', cache: 'no-store' })
  if (res.ok) return true
  if (res.status === 404) return false
  if (res.status === 401) onUnauthorized()
  throw new ApiError(res.status, res.statusText || "Couldn't check for the original PDF")
}

