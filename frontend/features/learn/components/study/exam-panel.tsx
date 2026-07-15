"use client"

import { useCallback, useEffect, useState } from "react"
import { ClipboardCheck, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { AnswerFeedback } from "@/features/learn/components/study/answer-feedback"
import { cn } from "@/lib/utils"
import {
  gradeExam,
  startExam,
  type ExamGradeResponse,
  type ExamQuestion,
  type ExamStartResponse,
} from "@/features/learn/api"

type ExamPanelProps = {
  scope: string | null
  docId?: string
  /** Bubble up after grading (the path uses the exam result for its soft gate). */
  onGraded?: () => void
  /** Result-screen guidance: jump to the quiz drawer to drill what was missed (fail). */
  onDrillMisses?: () => void
  /** Result-screen guidance: jump to the lock-in drawer (pass). */
  onLockIn?: () => void
}

/** Comprehensive chapter exam: a fixed, interleaved MCQ set, answered then scored. */
export function ExamPanel({ scope, docId, onGraded, onDrillMisses, onLockIn }: ExamPanelProps) {
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [passPct, setPassPct] = useState(80)
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [result, setResult] = useState<ExamGradeResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const begin = useCallback(async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    const r = await startExam(scope, docId, 12).catch(
      (e): ExamStartResponse => ({ error: String(e?.message || e) }),
    )
    setBusy(false)
    if (r.error || !r.questions?.length || !r.sessionId) {
      setError(r.error || "Could not build the exam.")
      return
    }
    setQuestions(r.questions)
    setSessionId(r.sessionId)
    setPassPct(r.passPct ?? 80)
    setIdx(0)
    setAnswers([])
  }, [scope, docId])

  // Reset when the chapter changes.
  useEffect(() => {
    setQuestions(null)
    setSessionId(null)
    setResult(null)
    setIdx(0)
    setAnswers([])
    setError(null)
  }, [scope, docId])

  const answer = useCallback(
    async (choice: number) => {
      if (!questions || !sessionId) return
      const next = [...answers, choice]
      if (idx + 1 < questions.length) {
        setAnswers(next)
        setIdx(idx + 1)
        return
      }
      // last question → grade
      setBusy(true)
      const g = await gradeExam(sessionId, next).catch(
        (e): ExamGradeResponse => ({ error: String(e?.message || e) }),
      )
      setBusy(false)
      if (g.error) {
        setError(g.error)
        return
      }
      setResult(g)
      onGraded?.()
    },
    [questions, sessionId, answers, idx, onGraded],
  )

  // Number keys 1-9 answer the current question (guard inputs).
  useEffect(() => {
    if (!questions || result || busy) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return
      const n = Number(e.key)
      const choices = questions[idx]?.choices.length ?? 0
      if (Number.isInteger(n) && n >= 1 && n <= choices) {
        e.preventDefault()
        answer(n - 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [questions, idx, result, busy, answer])

  if (!scope) {
    return <p className="p-6 text-sm text-muted-foreground">Open a chapter to take its exam.</p>
  }

  // ── Result screen ──────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-semibold tabular-nums",
              result.pass ? "bg-brand/15 text-brand" : "bg-amber-500/15 text-amber-400",
            )}
          >
            {result.score}%
          </div>
          <div>
            <p className="font-medium">{result.pass ? "Passed — chapter exam cleared." : "Not yet — give it another pass."}</p>
            <p className="text-sm text-muted-foreground">
              {result.correct}/{result.total} correct · pass mark {passPct}%
            </p>
          </div>
        </div>
        <ol className="space-y-1.5">
          {result.results?.map((r, i) => (
            <li key={i} className="text-sm">
              <div className="flex gap-2">
                <span className={cn("mt-0.5", r.correct ? "text-brand" : "text-destructive")}>
                  {r.correct ? "✓" : "✗"}
                </span>
                <span className={r.correct ? "text-muted-foreground" : "text-foreground/90"}>
                  {r.expected}
                </span>
              </div>
              {!r.correct && (
                <AnswerFeedback signal={r.explanation} source={r.source} className="ml-6 mt-1" />
              )}
            </li>
          ))}
        </ol>
        {/* What now? Failing without a next step strands the learner on this screen. */}
        <div className="rounded-lg border bg-muted/20 p-3 text-sm">
          {result.pass ? (
            <p className="text-muted-foreground">
              Chapter cleared — lock it in so its concepts drop into spaced review.
            </p>
          ) : (
            <p className="text-muted-foreground">
              {(result.total ?? 0) - (result.correct ?? 0)} missed. Drill those concepts with the chapter
              quiz first — retaking cold usually repeats the same misses.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {result.pass && onLockIn && (
              <Button type="button" size="sm" onClick={onLockIn}>
                Lock in the chapter
              </Button>
            )}
            {!result.pass && onDrillMisses && (
              <Button type="button" size="sm" onClick={onDrillMisses}>
                Drill the chapter quiz
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={begin} disabled={busy}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Retake exam
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── In progress ────────────────────────────────────────────────────────
  if (questions && sessionId) {
    const q = questions[idx]
    const pct = Math.round((100 * idx) / questions.length)
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Question {idx + 1} / {questions.length}
          </span>
          <span>Chapter exam · pass {passPct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{q.stem}</pre>
        <div className="grid gap-2">
          {q.choices.map((c, i) => (
            <Button
              key={i}
              type="button"
              variant="outline"
              className="h-auto justify-start gap-3 whitespace-normal py-3 text-left"
              disabled={busy}
              onClick={() => answer(i)}
            >
              <kbd className="mt-0.5 shrink-0 rounded border border-border bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {i + 1}
              </kbd>
              <span>{c}</span>
            </Button>
          ))}
        </div>
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scoring…
          </p>
        )}
      </div>
    )
  }

  // ── Idle / start ───────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-brand" />
        <span className="text-sm font-medium">Chapter exam</span>
      </div>
      <p className="text-sm text-muted-foreground">
        A comprehensive exam mixing concepts from across the whole chapter — interleaved, so you
        retrieve, not just recognize. Pass mark is {passPct}%.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" onClick={begin} disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
        Start exam
      </Button>
    </div>
  )
}
