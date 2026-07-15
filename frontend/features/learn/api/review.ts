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
   *  seeded by the chapter walk's self-grades. 'figure' = a figure-recall card (image front,
   *  caption reveal), seeded by chapter-scoped review. Absent/'concept' = a concept card. */
  itemType?: 'concept' | 'skeleton' | 'figure'
  /** Skeleton cards only: the branch's true children, snapshotted at walk time. */
  children?: { heading: string; essence?: string }[]
  /** Figure cards only: the figure's reading-order n for /api/learn/figure. */
  figureOrder?: number | null
  /** Figure cards only: the source page, kept on the row at seed time. */
  page?: number | null
}

export type ReviewQueueResponse = {
  cards: ReviewCard[]
  /** `new` is the full untouched backlog; `newAllowance` (unscoped sessions only) is how many
   *  of them today's session will actually serve — the daily intake cap minus what was
   *  already introduced since midnight. */
  counts: { due: number; new: number; later: number; newAllowance?: number }
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

// Due + new concepts to review. `scope` = a sectionKey (one section) or null (whole course).
// `docId` must be the learnDocId (concepts/reviews are keyed by it).
export async function fetchReviewQueue(
  docId?: string,
  scope?: string | null,
  limit = 40,
): Promise<ReviewQueueResponse> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (docId) params.set('doc', docId)
  if (scope) params.set('scope', scope)
  // The learner's midnight, so the daily new-card allowance follows their timezone.
  params.set('dayStart', String(new Date().setHours(0, 0, 0, 0) / 1000))
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

// Seed-or-advance a FIGURE-recall item ("what does this figure show?"). Sent with the full
// snapshot every time — the backend upsert keeps caption/section fresh on the row.
export async function submitFigureReviewGrade(
  docId: string,
  figureOrder: number,
  grade: ReviewGrade,
  snapshot?: { caption?: string; sectionKey?: string; chapterScope?: string; page?: number | null },
): Promise<ReviewGradeResponse> {
  const res = await fetch('/api/learn/review/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ figure: true, doc: docId, figureOrder, grade, ...snapshot }),
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

