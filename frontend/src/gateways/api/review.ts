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
   *  (recall what the chapter covered), seeded by reading. Absent/'concept' = a concept card. */
  itemType?: 'concept' | 'skeleton' | 'chapter'
  /** Skeleton/chapter cards only: the true structure snapshot for the reveal. */
  children?: { heading: string; essence?: string }[]
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
): Promise<ReviewQueueResponse> {
  const params = new URLSearchParams({ scope, limit: String(limit) })
  if (docId) params.set('doc', docId)
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

