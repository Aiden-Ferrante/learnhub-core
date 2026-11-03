"use client"

/** The two writes a syllabus row can make: a concept "I recalled this" tick (a real Good
 *  grade) and a chapter concept build (with its status poll). Both go through the data
 *  contract: a failed write is shown, never swallowed, and the poll stops on unmount. */

import { useMemo, useState } from "react"
import { getExtractionStatus, startExtraction } from "@/gateways/api/pipeline"
import { fetchConceptMastery } from "@/gateways/api/progress"
import { submitReviewGrade } from "@/gateways/api/review"
import { GRADE_INVALIDATES, qk, useApi, useApiMutation } from "@/kit/data"
import { orThrow } from "@/surfaces/library/envelope"

export type ExtractState = "running" | "done" | "error"

/** The LOCAL calendar day an epoch-seconds timestamp falls on.
 *
 *  Local, not UTC, and the difference is not cosmetic: the backend's heatmap buckets by UTC
 *  day, so from about 8pm Eastern onward UTC is already tomorrow. Bucketing the tick that
 *  way would silently un-tick everything reviewed during an evening session. "Studied
 *  today" means the user's today. */
function localDay(seconds: number): string {
  const d = new Date(seconds * 1000)
  const month = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${d.getFullYear()}-${month}-${day}`
}

/** Concept ticks: which concepts already carry a graded event today (so a tick survives a
 *  reload and shows reviews made elsewhere), and the Good grade a tick writes. */
export function useConceptTicks(docId: string | null | undefined, enabled: boolean, onReviewed?: () => void) {
  const doc = docId ?? undefined
  const mastery = useApi(qk.conceptMastery(doc), (signal) => fetchConceptMastery(doc, signal).then(orThrow), {
    enabled: enabled && !!doc,
  })
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const [lastKey, setLastKey] = useState<string | null>(null)
  const grade = useApiMutation((conceptKey: string) => submitReviewGrade(conceptKey, 3, doc).then(orThrow), {
    invalidates: GRADE_INVALIDATES,
    onSuccess: (_r, conceptKey) => {
      setTicked((prev) => new Set(prev).add(conceptKey))
      onReviewed?.()
    },
  })

  const reviewedToday = useMemo(() => {
    const seen = new Set(ticked)
    const today = localDay(Date.now() / 1000)
    for (const [key, m] of Object.entries(mastery.data?.byConcept ?? {})) {
      if (m.lastSeen && localDay(m.lastSeen) === today) seen.add(key)
    }
    return seen
  }, [mastery.data, ticked])

  const tick = (conceptKey: string) => {
    setLastKey(conceptKey)
    grade.fire(conceptKey)
  }
  return {
    mastery,
    reviewedToday,
    gradingKey: grade.pending ? lastKey : null,
    /** The concept whose tick failed (shown "Not saved · Retry" on its row). */
    failedKey: grade.error ? lastKey : null,
    error: grade.error,
    tick,
    retry: () => lastKey && grade.fire(lastKey),
  }
}

/** One section's concept build: start it, then poll its status every 8 s until it is done
 *  or failed. The poll belongs to the row, so it stops when the row unmounts. */
export function useExtraction(scope: string, docId: string | null | undefined) {
  const doc = docId ?? undefined
  const [started, setStarted] = useState(false)
  const start = useApiMutation(() => startExtraction(scope, doc).then(orThrow), {
    invalidates: [qk.extraction(doc, scope)],
    onSuccess: (r) => {
      if (r.status !== "error") setStarted(true)
    },
  })
  const status = useApi(qk.extraction(doc, scope), (signal) => getExtractionStatus(scope, doc, signal), {
    enabled: started,
    poll: (d) => (d?.status === "done" || d?.status === "error" ? false : 8000),
  })

  let state: ExtractState | undefined
  if (start.pending) state = "running"
  else if (start.error || start.data?.status === "error") state = "error"
  else if (started) state = status.data?.status === "done" ? "done" : status.data?.status === "error" ? "error" : "running"

  return {
    state,
    /** A failed status check while the poll keeps going; shown on the control's title. */
    statusError: started ? status.error : null,
    error: start.error,
    run: () => start.fire(undefined),
  }
}
