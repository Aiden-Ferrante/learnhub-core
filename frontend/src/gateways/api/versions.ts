/** Course versions: the named courses cut over one book.
 *
 * A book always has a `Default` version — the course built from the PDF's own table of
 * contents. Any other version is a re-cut of the same material: its own outline and its
 * own progress, sharing the book's text and its extracted concepts.
 *
 * `doc` is any version of the book; the backend resolves it to the book and answers for
 * the whole version set, so callers can pass whichever id they happen to hold.
 */
import { parseJsonResponse } from './http'

export type CourseVersion = {
  docId: string
  name: string
  /** 'default' = built from the book's own TOC and undeletable; 'custom' = yours. */
  origin: 'default' | 'custom'
  /** Exactly one version per book is main — the one a course card opens. */
  isMain: boolean
  status: string
  sectionCount: number | null
  /** How many of the book's blocks this version keeps — the size of its cut. */
  blockCount: number
  createdAt: number
}

export type VersionsResponse = {
  docId: string
  sourceId?: string
  versions: CourseVersion[]
  error?: string
}

export async function fetchVersions(doc: string): Promise<VersionsResponse> {
  const res = await fetch(`/api/learn/versions?doc=${encodeURIComponent(doc)}`, {
    cache: 'no-store',
  })
  return parseJsonResponse<VersionsResponse>(res)
}

/** Seeded from the book's Default: same outline, all the material. Never main — switching
 *  is a separate, deliberate act. Returns the new version's docId. */
export async function createVersion(
  doc: string,
  name: string,
): Promise<{ docId: string; name: string }> {
  const res = await fetch(
    `/api/learn/version?doc=${encodeURIComponent(doc)}&name=${encodeURIComponent(name)}`,
    { method: 'POST' },
  )
  return parseJsonResponse(res)
}

export async function renameVersion(doc: string, name: string): Promise<{ docId: string }> {
  const res = await fetch(
    `/api/learn/version?doc=${encodeURIComponent(doc)}&name=${encodeURIComponent(name)}`,
    { method: 'PATCH' },
  )
  return parseJsonResponse(res)
}

/** Make this the version the course opens. */
export async function setMainVersion(doc: string): Promise<{ docId: string }> {
  const res = await fetch(`/api/learn/version?doc=${encodeURIComponent(doc)}&main=true`, {
    method: 'PATCH',
  })
  return parseJsonResponse(res)
}

/** Delete one version — its outline and its progress. The book, its text and its concepts
 *  survive. The Default cannot be deleted (the API answers 409). */
export async function deleteVersion(doc: string): Promise<{ deleted: string }> {
  const res = await fetch(`/api/learn/version?doc=${encodeURIComponent(doc)}`, {
    method: 'DELETE',
  })
  return parseJsonResponse(res)
}
