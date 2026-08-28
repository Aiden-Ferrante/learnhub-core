/** Practice items — the one item pool behind practice sessions, quizzes, and exams.
 *
 * Items belong to the BOOK and are typed by HOW THE ANSWER IS CHECKED (`kind`), never by
 * subject: retrieve/problem are self-graded against a revealed worked solution; mcq/order/
 * code carry their check data in `payload`. `editedAt === null` marks a generated,
 * untouched item — the regenerable set; the moment it's edited it is yours and no
 * regeneration will overwrite it. Grading goes through /api/learn/review/grade (review.ts).
 */
import { parseJsonResponse } from './http'

export type PracticeKind = 'retrieve' | 'problem' | 'mcq' | 'order' | 'code'

export type PracticeItem = {
  key: string
  /** THIS version's section key (translated server-side from the book's). */
  sectionKey: string
  kind: PracticeKind
  prompt: string
  /** The worked solution, markdown. */
  answer: string
  rubric: string | null
  /** Per-kind check data (mcq choices, order steps, code tests) — null for retrieve/problem. */
  payload: Record<string, unknown> | null
  order: number | null
  createdAt: number | null
  /** null = generated + untouched = will be replaced by a regenerate. */
  editedAt: number | null
}

export type PracticeResponse = {
  docId: string | null
  scope?: string | null
  items: PracticeItem[]
  /** Version sections whose material changed after their items were authored. */
  staleSections?: string[]
  error?: string
}

export type PracticeStatus = {
  /** Sections in scope / sections with any authored items. */
  total: number
  authored: number
  byKind: Record<string, number>
  running: boolean
  error?: string
}

export async function fetchPractice(
  docId: string | undefined,
  scope?: string,
): Promise<PracticeResponse> {
  const params = new URLSearchParams()
  if (docId) params.set('doc', docId)
  if (scope) params.set('scope', scope)
  const res = await fetch(`/api/learn/practice?${params}`, { cache: 'no-store' })
  return parseJsonResponse<PracticeResponse>(res)
}

export async function fetchPracticeStatus(
  docId: string | undefined,
  scope: string,
): Promise<PracticeStatus> {
  const params = new URLSearchParams({ scope })
  if (docId) params.set('doc', docId)
  const res = await fetch(`/api/learn/practice/prepare?${params}`, { cache: 'no-store' })
  return parseJsonResponse<PracticeStatus>(res)
}

/** Enqueue authoring for a chapter on the processing ledger (visible in the Process tab).
 *  `regenerate` rewrites only untouched items — hand edits are permanent by construction. */
export async function preparePractice(
  docId: string | undefined,
  scope: string,
  opts: { kinds?: PracticeKind[]; regenerate?: boolean } = {},
): Promise<PracticeStatus> {
  const res = await fetch('/api/learn/practice/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: docId ?? null, scope, ...opts }),
  })
  return parseJsonResponse<PracticeStatus>(res)
}

export async function createPracticeItem(
  docId: string | undefined,
  sectionKey: string,
  fields: Pick<PracticeItem, 'kind' | 'prompt' | 'answer'> &
    Partial<Pick<PracticeItem, 'rubric' | 'payload'>>,
): Promise<{ created?: string; error?: string }> {
  const res = await fetch('/api/learn/practice/item', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: docId ?? null, sectionKey, ...fields }),
  })
  return parseJsonResponse(res)
}

export async function updatePracticeItem(
  key: string,
  patch: Partial<Pick<PracticeItem, 'prompt' | 'answer' | 'rubric' | 'kind' | 'payload'>>,
): Promise<{ updated?: string; error?: string }> {
  const res = await fetch(`/api/learn/practice/item/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return parseJsonResponse(res)
}

export async function deletePracticeItem(key: string): Promise<{ deleted?: string; error?: string }> {
  const res = await fetch(`/api/learn/practice/item/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
  return parseJsonResponse(res)
}
