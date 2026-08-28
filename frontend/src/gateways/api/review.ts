/** Spaced-repetition review: the queue and concept/figure/skeleton grade submissions. */
import { parseJsonResponse } from './http'

// ----- Spaced-repetition concept review (keyless) -----

export type ReviewCard = {
  conceptKey: string
  name: string
  kind: string
  signal: string
  source?: string | null
  sectionKey: string
  state: 'new' | 'learning' | 'review'
  due?: number | null
  /** Which course the card belongs to — set so whole-library sessions can fetch per-card
   *  extras (figures) without a docId prop. */
  docId?: string | null
  pageStart?: number | null
  pageEnd?: number | null
  /** 'skeleton' = a structure-recall card (rebuild a branch's sub-sections from memory),
   *  seeded by the chapter walk's self-grades. 'chapter' = a chapter-resurface card
   *  (recall what the chapter covered), seeded by reading. 'practice' = a practice-item
   *  card from the separate practice session. Absent/'concept' = a concept card. */
  itemType?: 'concept' | 'skeleton' | 'chapter' | 'practice'
  /** Skeleton/chapter cards only: the true structure snapshot for the reveal. */
  children?: { heading: string; essence?: string }[]
  /** Practice cards only — the item's fields, read LIVE from the pool at queue time
   *  (never snapshotted into the review row, so edits always show). */
  practiceKey?: string
  practiceKind?: 'retrieve' | 'problem' | 'mcq' | 'order' | 'code'
  prompt?: string
  answer?: string
  rubric?: string | null
  payload?: Record<string, unknown> | null
}

export type ReviewQueueResponse = {
  cards: ReviewCard[]
  counts: { due: number; new: number; later: number }
  error?: string
}

export type ReviewGradeResponse = {
  conceptKey: string
  due: number
  intervalDays: number
  state: string
  error?: string
}

// Recall grades: 1=Again, 2=Hard, 3=Good, 4=Easy.
export type ReviewGrade = 1 | 2 | 3 | 4

// Due + new concepts to review for one chapter/section scope (studying is chapter-scoped).
// `docId` must be the learnDocId (concepts/reviews are keyed by it).
export async function fetchReviewQueue(
  docId: string | undefined,
  scope: string,
  limit = 40,
  session: 'concepts' | 'practice' = 'concepts',
): Promise<ReviewQueueResponse> {
  const params = new URLSearchParams({ scope, limit: String(limit) })
  if (docId) params.set('doc', docId)
  if (session !== 'concepts') params.set('session', session)
  const res = await fetch(`/api/learn/review/queue?${params}`, { cache: 'no-store' })
  return parseJsonResponse<ReviewQueueResponse>(res)
}

export async function submitReviewGrade(
  conceptKey: string,
  grade: ReviewGrade,
  docId?: string,
): Promise<ReviewGradeResponse> {
  const res = await fetch('/api/learn/review/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conceptKey, grade, doc: docId ?? null }),
  })
  return parseJsonResponse<ReviewGradeResponse>(res)
}

// Seed-or-advance a PRACTICE item's spaced-repetition state. The practice session's
// separate queue grades through this on every self-grade; the item key (not the review-row
// key) addresses it, so first grades and re-grades are the same call. `doc` attributes the
// study event to the VERSION being studied while the review row follows the book.
export async function submitPracticeReviewGrade(
  practiceKey: string,
  grade: ReviewGrade,
  docId?: string,
): Promise<ReviewGradeResponse> {
  const res = await fetch('/api/learn/review/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ practice: true, practiceKey, grade, doc: docId ?? null }),
  })
  return parseJsonResponse<ReviewGradeResponse>(res)
}

// Seed-or-advance a SKELETON item's spaced-repetition state — the chapter walk calls this on
// every structure-recall self-grade, snapshotting the branch's true children so the review
// reveal can re-show them. Re-grades from the queue go through submitReviewGrade instead
// (the card's conceptKey is the skel-… review-row key).
export async function submitSkeletonReviewGrade(
  docId: string,
  sectionKey: string,
  grade: ReviewGrade,
  snapshot?: {
    heading?: string
    chapterScope?: string
    children?: { heading: string; essence?: string }[]
  },
): Promise<ReviewGradeResponse> {
  const res = await fetch('/api/learn/review/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skeleton: true, doc: docId, sectionKey, grade, ...snapshot }),
  })
  return parseJsonResponse<ReviewGradeResponse>(res)
}

