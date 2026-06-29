"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { startQuizSession, submitQuizAnswer } from "@/lib/learn-service"

type QuizPanelProps = {
  scope: string | null
  doc?: string
  onAnswered?: () => void
}

export function QuizPanel({ scope, doc, onAnswered }: QuizPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  const [choices, setChoices] = useState<string[]>([])
  const [result, setResult] = useState<{
    correct: boolean
    expected: string
    explanation: string
  } | null>(null)

  const startQuiz = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await startQuizSession(scope, doc)
      setSessionId(data.sessionId)
      setQuestion(data.question)
      setChoices(data.choices)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start quiz")
      setSessionId(null)
      setQuestion(null)
      setChoices([])
    } finally {
      setLoading(false)
    }
  }, [scope, doc])

  const answer = useCallback(
    async (choiceIndex: number) => {
      if (!sessionId) return
      setLoading(true)
      setError(null)
      try {
        const data = await submitQuizAnswer(sessionId, choiceIndex)
        setResult({
          correct: data.correct,
          expected: data.expected,
          explanation: data.explanation,
        })
        setSessionId(null)
        onAnswered?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to submit answer")
      } finally {
        setLoading(false)
      }
    },
    [sessionId, onAnswered],
  )

  // Keyboard: 1-9 picks a choice; Enter starts a question / fetches the next one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t?.isContentEditable
      ) {
        return
      }
      if (loading) return
      const answering = !!question && choices.length > 0 && !result
      if (answering) {
        const n = Number(e.key)
        if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
          e.preventDefault()
          answer(n - 1)
        }
      } else if (e.key === "Enter") {
        // idle (pre-first question) or showing a result → (re)start
        e.preventDefault()
        startQuiz()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [loading, question, choices.length, result, answer, startQuiz])

  return (
    <div className="flex h-full flex-col p-4 gap-4">
      {!question && !result && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Multiple-choice question from a random triple in{" "}
            {scope ? `section ${scope}` : "the full graph"}.
          </p>
          <Button type="button" onClick={startQuiz} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Start question
            <kbd className="ml-2 rounded border border-current/30 px-1 text-[10px] opacity-70">↵</kbd>
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {question && choices.length > 0 && !result && (
        <div className="space-y-4">
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">{question}</pre>
          <div className="grid gap-2">
            {choices.map((choice, i) => (
              <Button
                key={i}
                type="button"
                variant="outline"
                className="justify-start h-auto py-3 text-left whitespace-normal gap-3"
                disabled={loading}
                onClick={() => answer(i)}
              >
                <kbd className="mt-0.5 shrink-0 rounded border border-border bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                  {i + 1}
                </kbd>
                <span>{choice}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
          <p className={`font-medium ${result.correct ? "text-nvidia-green" : "text-destructive"}`}>
            {result.correct ? "Correct!" : "Not quite."}
          </p>
          <p className="text-sm">
            Expected: <strong>{result.expected}</strong>
          </p>
          <p className="text-sm text-muted-foreground">{result.explanation}</p>
          <Button type="button" variant="outline" size="sm" onClick={startQuiz} disabled={loading}>
            New question
            <kbd className="ml-2 rounded border border-current/30 px-1 text-[10px] opacity-70">↵</kbd>
          </Button>
        </div>
      )}
    </div>
  )
}
