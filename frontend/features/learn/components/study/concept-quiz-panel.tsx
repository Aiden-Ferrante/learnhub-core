"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnswerFeedback } from "@/features/learn/components/study/answer-feedback"
import { ConceptMarkdown } from "@/features/learn/components/concepts/concept-markdown"
import { fetchQuizPrepareStatus, prepareQuizQuestions, type QuizPrepareStatus } from "@/features/learn/api/quiz"
import { QuizChoiceList } from "@/features/learn/components/study/quiz-choice-list"
import { useConceptQuizSession } from "@/features/learn/components/study/use-concept-quiz"
import { useStudyHotkeys } from "@/features/learn/hooks/use-study-hotkeys"
import { usePolling } from "@/hooks/use-polling"

/** Deterministic concept MCQ: "which concept does this description match?", distractors are
 *  sibling concepts. Keyless. Records a study event so mastery moves. */
export function ConceptQuizPanel({
  scope,
  docId,
  onAnswered,
}: {
  scope: string | null
  docId?: string
  onAnswered?: () => void
}) {
  const { session, picked, result, loading, error, start, answer } = useConceptQuizSession(scope, docId, onAnswered)

  useEffect(() => {
    start()
  }, [start])

  // Application-question authoring status for this chapter. Opening the quiz AUTO-KICKS the
  // authoring pass when questions are missing (it used to hide behind a "Prepare all" button
  // nobody found until mid-quiz) — the strip below just reports progress.
  const [prep, setPrep] = useState<QuizPrepareStatus | null>(null)
  const [autoKicked, setAutoKicked] = useState(false)
  const loadStatus = useCallback(() => {
    if (!scope) {
      setPrep(null)
      return
    }
    fetchQuizPrepareStatus(scope, docId)
      .then((s) => !s.error && setPrep(s))
      .catch(() => {})
  }, [scope, docId])
  useEffect(() => {
    setAutoKicked(false)
    loadStatus()
  }, [loadStatus])
  useEffect(() => {
    if (autoKicked || !prep || prep.running || !prep.total || prep.authored >= prep.total) return
    setAutoKicked(true)
    prepareQuizQuestions(scope, docId)
      .then((s) => !s.error && setPrep(s))
      .catch(() => {})
  }, [autoKicked, prep, scope, docId])
  usePolling(loadStatus, prep?.running ? 5000 : null)

  // Keyboard: 1-9 pick a choice; Enter advances after answering.
  useStudyHotkeys((e) => {
    if (result && e.key === "Enter") {
      e.preventDefault()
      start()
    } else if (session && !result && /^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1
      if (i < session.choices.length) {
        e.preventDefault()
        answer(i)
      }
    }
  })

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Building a question…</p>
  if (error)
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={start}>
          Try again
        </Button>
      </div>
    )
  if (!session) return null

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {prep && prep.total > 0 && prep.authored < prep.total && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-card/60 px-3 py-2 text-xs">
          <span className="flex items-center gap-2 text-muted-foreground">
            {prep.running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-brand" />
            )}
            {prep.running
              ? `Writing application questions… ${prep.authored}/${prep.total} — recall questions serve meanwhile`
              : `Application questions: ${prep.authored}/${prep.total} ready`}
          </span>
        </div>
      )}

      <ConceptMarkdown content={session.stem} className="text-sm" />

      <QuizChoiceList choices={session.choices} picked={picked} result={result} onPick={answer} />

      {result && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
          <p className="text-sm font-medium">
            {result.correct ? "✓ Correct" : `✗ Answer: ${result.expected}`}
          </p>
          <AnswerFeedback signal={result.signal} source={result.source} />
          <Button size="sm" className="self-start" onClick={start}>
            Next <kbd className="ml-2 rounded bg-muted px-1 text-[10px]">↵</kbd>
          </Button>
        </div>
      )}
    </div>
  )
}
