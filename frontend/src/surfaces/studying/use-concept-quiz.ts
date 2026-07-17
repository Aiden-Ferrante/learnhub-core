"use client"

import { useCallback, useState } from "react"
import {
  startConceptQuiz,
  submitConceptAnswer,
  type ConceptQuizResult,
  type ConceptQuizSession,
} from "@/gateways/api/quiz"

/** THE concept-MCQ session machine — start a question, pick a choice, get the graded
 *  result. ConceptQuizPanel and the reader's quick check were byte-identical copies of
 *  this state + wiring; both now render over this one hook. `answer` is memoized (the
 *  quick check's un-memoized copy re-registered its key listener every render). */
export function useConceptQuizSession(scope: string | null, docId?: string, onAnswered?: () => void) {
  const [session, setSession] = useState<ConceptQuizSession | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [result, setResult] = useState<ConceptQuizResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(() => {
    setLoading(true)
    setError(null)
    setResult(null)
    setPicked(null)
    setSession(null)
    startConceptQuiz(scope, docId)
      .then((s) => (s.error ? setError(s.error) : setSession(s)))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to start quiz"))
      .finally(() => setLoading(false))
  }, [scope, docId])

  const answer = useCallback(
    (i: number) => {
      if (!session || result) return
      setPicked(i)
      submitConceptAnswer(session.sessionId, i)
        .then((r) => {
          if (r.error) setError(r.error)
          else {
            setResult(r)
            onAnswered?.()
          }
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to submit"))
    },
    [session, result, onAnswered],
  )

  return { session, picked, result, loading, error, start, answer }
}
