"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, Loader2, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConceptMarkdown } from "@/features/learn/components/concepts/concept-markdown"
import { fetchCalibration, type CalibrationResponse } from "@/features/learn/api/progress"
import { gradeDrill, startDrill, type Confidence, type DrillGradeResponse, type ExamQuestion } from "@/features/learn/api/quiz"
import { cn } from "@/lib/utils"

const CONF: { value: Confidence; label: string }[] = [
  { value: "guess", label: "Guessing" },
  { value: "shaky", label: "Shaky" },
  { value: "confident", label: "Confident" },
]

type DrillViewProps = {
  /** A chapter scope, or null = whole-course (cross-chapter interleaving). */
  scope: string | null
  docId?: string
  title?: string
  onBack: () => void
  /** Bubble up after grading so mastery/forecast refresh. */
  onDone?: () => void
}

/** Adaptive practice drill: quizzes the concepts you most need (missed first, then weakest,
 *  interleaved). Ungraded — it's deliberate practice, not a test. Keyboard 1-9 to answer. */
export function DrillView({ scope, docId, title, onBack, onDone }: DrillViewProps) {
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [fromMisses, setFromMisses] = useState(0)
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [confidences, setConfidences] = useState<(Confidence | null)[]>([])
  const [pending, setPending] = useState<number | null>(null)
  const [result, setResult] = useState<DrillGradeResponse | null>(null)
  const [calibration, setCalibration] = useState<CalibrationResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(() => {
    setBusy(true)
    setError(null)
    setResult(null)
    setIdx(0)
    setAnswers([])
    setConfidences([])
    setPending(null)
    setQuestions(null)
    startDrill(scope, docId, 10)
      .then((r) => {
        if (r.error || !r.questions?.length || !r.sessionId) {
          setError(r.error || "Couldn't build a drill")
          return
        }
        setQuestions(r.questions)
        setSessionId(r.sessionId)
        setFromMisses(r.fromMisses ?? 0)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't build a drill"))
      .finally(() => setBusy(false))
  }, [scope, docId])

  useEffect(() => {
    start()
  }, [start])

  // Pick a choice → rate confidence (the pre-reveal prediction) → commit + advance/grade.
  const commit = useCallback(
    (conf: Confidence) => {
      if (!questions || result || busy || pending === null) return
      const nextA = [...answers, pending]
      const nextC = [...confidences, conf]
      setAnswers(nextA)
      setConfidences(nextC)
      setPending(null)
      if (idx + 1 < questions.length) {
        setIdx(idx + 1)
      } else if (sessionId) {
        setBusy(true)
        gradeDrill(sessionId, nextA, nextC)
          .then((g) => {
            if (g.error) setError(g.error)
            else {
              setResult(g)
              onDone?.()
              fetchCalibration(docId).then((c) => !c.error && setCalibration(c)).catch(() => {})
            }
          })
          .finally(() => setBusy(false))
      }
    },
    [questions, result, busy, pending, answers, confidences, idx, sessionId, onDone, docId],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!questions || result || busy) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (pending === null && /^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1
        if (i < (questions[idx]?.choices.length ?? 0)) {
          e.preventDefault()
          setPending(i)
        }
      } else if (pending !== null && /^[1-3]$/.test(e.key)) {
        e.preventDefault()
        commit(CONF[Number(e.key) - 1].value)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [questions, idx, result, busy, pending, commit])

  const header = (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to course
        </button>
        <span className="flex items-center gap-2 text-sm font-medium">
          <Target className="h-4 w-4 text-brand" />
          {title || "Practice your weak spots"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Adaptive multiple-choice on the concepts you most need — missed first, then weakest, across
        all chapters. Ungraded practice.
      </p>
    </div>
  )

  if (busy && !questions && !result) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Picking the concepts you most need…
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={start}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (result) {
    const review = (result.results || []).filter((r) => !r.correct)
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-lg border bg-card p-6">
          <p className="text-lg font-semibold">
            {result.correct}/{result.total} correct
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {review.length === 0
              ? "Clean sweep — these are sticking."
              : `${review.length} to keep working on:`}
          </p>

          {calibration && calibration.buckets.length > 0 && (
            <div className="mt-3 rounded-md border bg-background/40 p-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Your calibration — how often each confidence level was actually right:
              </p>
              <div className="flex flex-wrap gap-3 text-xs">
                {calibration.buckets.map((b) => (
                  <span key={b.confidence} className="flex items-center gap-1">
                    <span className="capitalize text-foreground/80">{b.confidence}</span>
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        b.confidence === "confident" && b.accuracy < 70
                          ? "text-amber-500"
                          : "text-foreground",
                      )}
                    >
                      {b.accuracy}%
                    </span>
                    <span className="text-muted-foreground">({b.count})</span>
                  </span>
                ))}
              </div>
              {calibration.buckets.some((b) => b.confidence === "confident" && b.accuracy < 70) && (
                <p className="mt-1.5 text-xs text-amber-500">
                  Watch for overconfidence — &ldquo;confident&rdquo; should be near 90%+.
                </p>
              )}
            </div>
          )}
          {review.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {review.map((r, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-foreground">{r.expected}</span>
                  {r.explanation && (
                    <span className="text-muted-foreground"> — {r.explanation}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex gap-2">
            <Button type="button" size="sm" onClick={start}>
              Drill again
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              Done
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!questions) return <div className="space-y-4">{header}</div>
  const q = questions[idx]

  return (
    <div className="space-y-4">
      {header}
      <div className="rounded-lg border bg-card p-6">
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            Question {idx + 1} / {questions.length}
          </span>
          {fromMisses > 0 && idx === 0 && (
            <span className="text-amber-500">{fromMisses} from past misses</span>
          )}
        </div>
        <ConceptMarkdown content={q.stem} className="text-sm" />
        <div className="mt-4 grid gap-2">
          {q.choices.map((c, i) => (
            <button
              key={i}
              type="button"
              disabled={busy || pending !== null}
              onClick={() => setPending(i)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60",
                pending === i ? "border-brand bg-brand/10" : "border-border hover:border-brand/50",
              )}
            >
              <kbd className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{i + 1}</kbd>
              <span>{c}</span>
            </button>
          ))}
        </div>

        {/* Calibration: rate confidence BEFORE the answer is graded. */}
        {pending !== null && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Before you find out — how sure are you?
            </p>
            <div className="flex flex-wrap gap-2">
              {CONF.map((c, i) => (
                <Button
                  key={c.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={busy}
                  onClick={() => commit(c.value)}
                >
                  <kbd className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{i + 1}</kbd>
                  {c.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
