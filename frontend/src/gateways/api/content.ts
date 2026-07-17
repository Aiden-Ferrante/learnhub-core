/** Document content: markdown, per-section text blocks, and extracted figures. */
import { parseJsonResponse } from './http'
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

export async function fetchDocumentMarkdown(id?: string): Promise<DocumentResponse> {
  const qs = id ? `?id=${encodeURIComponent(id)}` : ''
  const res = await fetch(`/api/learn/document${qs}`, { cache: 'no-store' })
  return parseJsonResponse<DocumentResponse>(res)
}

export async function fetchSectionContent(
  sectionKey: string,
  docId?: string,
): Promise<SectionContentResponse> {
  const segs = sectionKey.split('/').map(encodeURIComponent).join('/')
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/section/content/${segs}${qs}`, { cache: 'no-store' })
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
export async function fetchSectionFigures(docId: string, sectionKey: string): Promise<LearnFigure[]> {
  const params = new URLSearchParams({ doc: docId, scope: sectionKey, type: 'figure' })
  const res = await fetch(`/api/learn/elements?${params}`, { cache: 'no-store' })
  const data = await parseJsonResponse<{ elements?: LearnFigure[]; error?: string }>(res)
  return (data.elements ?? []).filter((e) => (e.caption ?? '').trim())
}

export function figureUrl(docId: string, order: number): string {
  return `/api/learn/figure?doc=${encodeURIComponent(docId)}&n=${order}`
}

