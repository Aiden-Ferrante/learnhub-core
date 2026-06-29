"use client"

import { useState } from "react"
import { HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConceptMarkdown } from "@/components/learn/concept-markdown"
import {
  startConceptQuiz,
  submitConceptAnswer,
  type ConceptQuizResult,
  type ConceptQuizSession,
} from "@/lib/learn-service"

/** A compact end-of-section "check yourself" — one deterministic concept MCQ from this section.
 *  Reuses the concept-quiz endpoints; records a study event so mastery moves. */
export function InlineCheck({
  scope,
  docId,
  onAnswered,
}: {
  scope: string | null
  docId?: string
  onAnswered?: () => void
}) {
  const [session, setSession] = useState<ConceptQuizSession | null>(null)
  const [result, setResult] = useState<ConceptQuizResult | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setPicked(null)
    setSession(null)
    startConceptQuiz(scope, docId)
      .then((s) => (s.error ? setError(s.error) : setSession(s)))
      .catch(() => setError("Couldn't build a check"))
      .finally(() => setLoading(false))
  }

  const answer = (i: number) => {
    if (!session || result) return
    setPicked(i)
    submitConceptAnswer(session.sessionId, i)
      .then((r) => {
        if (!r.error) {
          setResult(r)
          onAnswered?.()
        }
      })
      .catch(() => {})
  }

  if (!session && !loading && !error) {
    return (
      <div className="mx-6 mb-6 mt-2 rounded-lg border border-dashed p-4 text-center">
        <div className="mb-1 flex items-center justify-center gap-1.5 text-sm font-medium">
          <HelpCircle className="h-4 w-4 text-nvidia-green" /> Check yourself
        </div>
        <p className="mb-3 text-xs text-muted-foreground">Quick recall of a concept from this section.</p>
        <Button size="sm" onClick={start}>
          Start check
        </Button>
      </div>
    )
  }
  if (loading) return <p className="mx-6 mb-6 text-sm text-muted-foreground">Building a question…</p>
  if (error)
    return (
      <div className="mx-6 mb-6 mt-2 flex items-center gap-3 text-sm">
        <span className="text-destructive">{error}</span>
        <Button size="sm" variant="outline" onClick={start}>
          Retry
        </Button>
      </div>
    )

  return (
    <div className="mx-6 mb-6 mt-2 rounded-lg border p-4">
      <ConceptMarkdown content={session!.stem} className="text-sm" />
      <div className="mt-3 grid gap-2">
        {session!.choices.map((c, i) => {
          const correct = result && c === result.expected
          const wrong = result && picked === i && !correct
          return (
            <button
              key={i}
              type="button"
              disabled={!!result}
              onClick={() => answer(i)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                !result
                  ? "hover:border-nvidia-green/50"
                  : correct
                    ? "border-emerald-500/60 bg-emerald-500/10"
                    : wrong
                      ? "border-rose-500/60 bg-rose-500/10"
                      : "opacity-60"
              }`}
            >
              {c}
            </button>
          )
        })}
      </div>
      {result && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-medium">
            {result.correct ? "✓ Correct" : `Answer: ${result.expected}`}
          </span>
          <Button size="sm" variant="outline" onClick={start}>
            Another
          </Button>
        </div>
      )}
    </div>
  )
}
