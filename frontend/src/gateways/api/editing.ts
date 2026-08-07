/** Editing the material — the book's text, or one course's rewrite of it.
 *
 * Edits address a BLOCK, never a whole document. Block keys are minted at conversion and
 * every version's material mapping and every concept anchor points at them, so re-splitting
 * a document on save would destroy both. Each section is a handful of blocks; between them
 * they hold every word of the book.
 *
 * Two targets, chosen per save:
 *   'book'     fixes the source — every course cut from that book sees it. For conversion
 *              damage: OCR garbage, mangled tables, a heading that lost its letters.
 *   'version'  rewrites for the course you are in, copy-on-write. The book and the other
 *              courses keep the original, and a later fix to the book will not overwrite you.
 */
import { parseJsonResponse } from './http'

export type MaterialBlock = {
  /** What an edit addresses — stable across edits, which is the point. */
  blockKey: string
  sectionKey: string
  heading: string | null
  markdown: string
  charCount: number
  /** This course has its own wording for this block. */
  isRewritten: boolean
  editedAt: number | null
}

export type SectionMaterial = {
  docId: string
  scope: string
  blocks: MaterialBlock[]
  error?: string
}

export type EditTarget = 'book' | 'version'

export async function fetchSectionMaterial(doc: string, scope: string): Promise<SectionMaterial> {
  const res = await fetch(
    `/api/learn/section/material?doc=${encodeURIComponent(doc)}&scope=${encodeURIComponent(scope)}`,
    { cache: 'no-store' },
  )
  return parseJsonResponse<SectionMaterial>(res)
}

export async function saveBlock(
  doc: string,
  blockKey: string,
  markdown: string,
  target: EditTarget,
): Promise<{ blockKey: string; target: EditTarget; charCount: number }> {
  const res = await fetch(
    `/api/learn/section/material?doc=${encodeURIComponent(doc)}&block=${encodeURIComponent(
      blockKey,
    )}&target=${target}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    },
  )
  return parseJsonResponse(res)
}

/** Drop this course's rewrite and read the book's text again. */
export async function revertBlock(
  doc: string,
  blockKey: string,
): Promise<{ blockKey: string; reverted: boolean }> {
  const res = await fetch(
    `/api/learn/section/material?doc=${encodeURIComponent(doc)}&block=${encodeURIComponent(blockKey)}`,
    { method: 'DELETE' },
  )
  return parseJsonResponse(res)
}

/** Sections whose material changed after their concepts were built — the rebuild cue.
 *  Derived from timestamps, so building a chapter clears it without anything resetting a flag. */
export async function fetchStaleSections(doc: string): Promise<{ staleSections: string[] }> {
  const res = await fetch(`/api/learn/material/stale?doc=${encodeURIComponent(doc)}`, {
    cache: 'no-store',
  })
  return parseJsonResponse(res)
}

/** ── Outline editing ───────────────────────────────────────────────────────
 *
 * A course's outline is its own — reshaping it is what makes the course yours rather than
 * the book's. Saves send the WHOLE outline and the backend reconciles in place: a node's id
 * encodes its section key and the material mapping points at it, so a reorder must update
 * rather than recreate, or every block would come unplaced.
 *
 * Removing sections is refused on the Default course (409): concepts anchor to its tree.
 */

export type OutlineSection = {
  /** Absent on a section you just added — the backend mints one. */
  sectionKey?: string
  title: string
  depth: number
}

export type UnplacedBlock = {
  blockKey: string
  sourceSectionKey: string
  heading: string | null
  charCount: number
}

export async function saveOutline(
  doc: string,
  sections: OutlineSection[],
): Promise<{ sections: Required<OutlineSection>[]; removed: string[] }> {
  const res = await fetch(`/api/learn/outline?doc=${encodeURIComponent(doc)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sections }),
  })
  return parseJsonResponse(res)
}

/** Material this course keeps but files under no section — what a deleted section leaves
 *  behind. Surfaced so a cut is never silent. */
export async function fetchUnplacedBlocks(doc: string): Promise<{ blocks: UnplacedBlock[] }> {
  const res = await fetch(`/api/learn/version/unplaced?doc=${encodeURIComponent(doc)}`, {
    cache: 'no-store',
  })
  return parseJsonResponse(res)
}

export async function moveBlocks(
  doc: string,
  blocks: string[],
  sectionKey: string,
): Promise<{ moved: number }> {
  const res = await fetch(
    `/api/learn/version/blocks?doc=${encodeURIComponent(doc)}&section=${encodeURIComponent(sectionKey)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    },
  )
  return parseJsonResponse(res)
}

/** Drop material from THIS course — distilling. The book keeps every word. */
export async function removeBlocks(doc: string, blocks: string[]): Promise<{ removed: number }> {
  const res = await fetch(`/api/learn/version/blocks/remove?doc=${encodeURIComponent(doc)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  })
  return parseJsonResponse(res)
}
