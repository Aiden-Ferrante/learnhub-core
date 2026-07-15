/** Extracted concepts: document- and section-level lists, deletion. */
import { parseJsonResponse } from './http'

export type ConceptProvenance = {
  sectionKey: string
  pageStart?: number | null
  pageEnd?: number | null
}

export type ConceptLesson = {
  conceptKey?: string
  name: string
  kind: string
  signal: string
  source?: string | null
  questions?: { q: string; a: string }[]
  sectionKey?: string
  pageStart?: number | null
  pageEnd?: number | null
  appearsIn?: ConceptProvenance[]
  aliasCount?: number
  /** 1-2 paragraph expansion of `signal`, pre-generated for the Deep Chapter surface. */
}

export type DocumentConceptsResponse = {
  docId?: string
  concepts: ConceptLesson[]
  error?: string
}

// Document-level canonical (deduped) concept list — one entry per concept, with the merged
// provenance of every section it appears in.
export async function fetchDocumentConcepts(doc?: string): Promise<DocumentConceptsResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/concepts${qs}`, { cache: 'no-store' })
  return parseJsonResponse<DocumentConceptsResponse>(res)
}

export async function deleteConcept(key: string): Promise<{ deleted?: string; error?: string }> {
  const res = await fetch(`/api/learn/concept/${encodeURIComponent(key)}`, { method: 'DELETE' })
  return parseJsonResponse(res)
}

export type SectionConceptsResponse = {
  sectionKey: string
  docId?: string
  concepts: ConceptLesson[]
  // Ordered sub-sections that carry concepts within the requested scope — present when a
  // chapter scope spans multiple sub-sections, used to drive the guided top-down concept walk.
  sections?: { sectionKey: string; title: string; essence?: string; depth?: number }[]
  error?: string
}

// Concepts extracted from a single section (the section view). `docId` must be the learnDocId
// (concepts are keyed by it), matching where section_content and the document outline live.
export async function fetchSectionConcepts(
  sectionKey: string,
  docId?: string,
): Promise<SectionConceptsResponse> {
  const segs = sectionKey.split('/').map(encodeURIComponent).join('/')
  const qs = docId ? `?doc=${encodeURIComponent(docId)}` : ''
  const res = await fetch(`/api/learn/section/concepts/${segs}${qs}`, { cache: 'no-store' })
  return parseJsonResponse<SectionConceptsResponse>(res)
}

