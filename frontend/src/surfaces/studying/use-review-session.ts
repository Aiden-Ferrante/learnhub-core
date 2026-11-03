"use client"

import { useCallback, useEffect, useState } from "react"
import { GRADE_INVALIDATES, qk, useApi, useApiMutation } from "@/kit/data"
import {
  fetchCourseReviewQueue,
  fetchReviewQueue,
  submitReviewGrade,
  type ReviewCard,
  type ReviewGrade,
  type ReviewQueueResponse,
} from "@/gateways/api/review"
import { unwrap } from "@/surfaces/studying/envelope"

/** The scope that asks for the whole-course queue (backend build_review_queue). */
export const COURSE_SCOPE = "course"

const CHAPTER_LIMIT = 40
const COURSE_LIMIT = 200

/** One run through the queue. The cards are a SNAPSHOT taken when the run starts: every
 *  grade invalidates the queue, and the refetch must not reshuffle the cards under the
 *  learner mid-run. Counts above the card stay live. */
type Run = { id: string; cards: ReviewCard[]; idx: number; done: number; good: number; again: number }

const freshRun = (id: string, cards: ReviewCard[]): Run => ({ id, cards, idx: 0, done: 0, good: 0, again: 0 })

type GradeVars = { conceptKey: string; grade: ReviewGrade; docId?: string }

/** The review queue for a chapter/section scope, or the whole course (`scope="course"`),
 *  plus the grade mutation. A card advances only once its grade has landed; a failed
 *  grade leaves the card up with `grade.error` set, and `retryGrade` re-sends it. */
export function useReviewSession(docId: string | undefined, scope: string, onAnswered?: () => void) {
  const course = scope === COURSE_SCOPE
  const q = useApi<ReviewQueueResponse>(
    course ? qk.courseReview(docId ?? "") : qk.reviewQueue(docId, scope, CHAPTER_LIMIT),
    (signal) =>
      unwrap(
        course
          ? fetchCourseReviewQueue(docId ?? "", COURSE_LIMIT, signal)
          : fetchReviewQueue(docId, scope, CHAPTER_LIMIT, signal),
      ),
    { enabled: !course || Boolean(docId) },
  )

  const id = `${docId ?? ""}:${scope}`
  const [run, setRun] = useState<Run | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [lastVars, setLastVars] = useState<GradeVars | null>(null)

  // Start a run on first data, and again whenever the doc/scope changes.
  useEffect(() => {
    if (q.data && (!run || run.id !== id)) {
      setRun(freshRun(id, q.data.cards))
      setRevealed(false)
    }
  }, [q.data, id, run])

  const active = run && run.id === id ? run : null
  const card = active ? active.cards[active.idx] : undefined

  const grade = useApiMutation(
    (v: GradeVars) => unwrap(submitReviewGrade(v.conceptKey, v.grade, v.docId)),
    {
      invalidates: GRADE_INVALIDATES,
      onSuccess: (_res, v) => {
        setRevealed(false)
        setRun((r) =>
          r && {
            ...r,
            idx: r.idx + 1,
            done: r.done + 1,
            good: r.good + (v.grade >= 3 ? 1 : 0),
            again: r.again + (v.grade < 3 ? 1 : 0),
          },
        )
        onAnswered?.()
      },
    },
  )

  const submit = useCallback(
    (g: ReviewGrade) => {
      if (!card || grade.pending) return
      const v = { conceptKey: card.conceptKey, grade: g, docId }
      setLastVars(v)
      grade.fire(v)
    },
    [card, grade, docId],
  )

  const retryGrade = useCallback(() => {
    if (lastVars) grade.fire(lastVars)
  }, [grade, lastVars])

  /** Start over from the queue as it stands now, and pull a fresh copy behind it. */
  const restart = useCallback(() => {
    if (q.data) setRun(freshRun(id, q.data.cards))
    setRevealed(false)
    grade.reset()
    q.retry()
  }, [q, id, grade])

  return { q, run: active, card, revealed, setRevealed, submit, grade, retryGrade, restart }
}
