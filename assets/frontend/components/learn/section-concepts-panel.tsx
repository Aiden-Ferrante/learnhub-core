"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Zap } from "lucide-react"
import { AnswerFeedback } from "@/components/learn/answer-feedback"
import { ConceptCard } from "@/components/learn/concept-card"
import { ConceptMarkdown } from "@/components/learn/concept-markdown"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  displaySectionTitle,
  fetchConceptMastery,
  fetchSectionConcepts,
  startConceptQuiz,
  submitConceptAnswer,
  type ConceptLesson,
  type ConceptMasteryResponse,
  type ConceptQuizResult,
  type ConceptQuizSession,
} from "@/lib/learn-service"

type ConceptSection = { sectionKey: string; title: string; essence?: string; depth?: number }

const QUICK_CHECK_QUESTIONS = 2

/** A compact, collapsible "study → check → next" loop scoped to one sub-section: a couple of
 *  concept MCQs so you retrieve right after encoding, instead of reading the whole chapter
 *  then quizzing at the end. Records study events so mastery moves. */
function ConceptQuickCheck({
  scope,
  docId,
  onAnswered,
}: {
  scope: string
  docId?: string
  onAnswered?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<ConceptQuizSession | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [result, setResult] = useState<ConceptQuizResult | null>(null)
  const [answered, setAnswered] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const nextQuestion = useCallback(() => {
    setLoading(true)
    setError(null)
    setResult(null)
    setPicked(null)
    setSession(null)
    startConceptQuiz(scope, docId)
      .then((s) => (s.error ? setError(s.error) : setSession(s)))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't build a check"))
      .finally(() => setLoading(false))
  }, [scope, docId])

  const begin = () => {
    setOpen(true)
    setAnswered(0)
    nextQuestion()
  }

  const choose = (i: number) => {
    if (!session || result) return
    setPicked(i)
    submitConceptAnswer(session.sessionId, i)
      .then((r) => {
        if (r.error) {
          setError(r.error)
          return
        }
        setResult(r)
        setAnswered((n) => n + 1)
        onAnswered?.()
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to submit"))
  }

  const finished = answered >= QUICK_CHECK_QUESTIONS && !!result

  // Keyboard: 1-9 pick a choice; Enter advances to the next question (matches the kbd hints).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (session && !result && /^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1
        if (i < session.choices.length) {
          e.preventDefault()
          choose(i)
        }
      } else if (result && !finished && e.key === "Enter") {
        e.preventDefault()
        nextQuestion()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, session, result, finished, choose, nextQuestion])

  if (!open) {
    return (
      <button
        type="button"
        onClick={begin}
        className="flex items-center gap-1.5 self-start rounded-md border border-dashed px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/50 hover:text-brand"
      >
        <Zap className="h-3.5 w-3.5" />
        Quick check
      </button>
    )
  }

  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-brand" />
          Quick check
        </span>
        <span className="tabular-nums">
          {Math.min(answered + (result ? 0 : 1), QUICK_CHECK_QUESTIONS)}/{QUICK_CHECK_QUESTIONS}
        </span>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={nextQuestion}>
            Retry
          </Button>
        </div>
      ) : loading ? (
        <p className="text-xs text-muted-foreground">Building a question…</p>
      ) : finished ? (
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-brand">
            <CheckCircle2 className="h-4 w-4" />
            Checked — on to the next section.
          </p>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
            Hide
          </Button>
        </div>
      ) : session ? (
        <div className="flex flex-col gap-2">
          <ConceptMarkdown content={session.stem} className="text-sm" />
          <div className="grid gap-1.5">
            {session.choices.map((c, i) => {
              const isCorrect = result && c === result.expected
              const isPicked = picked === i
              const cls = !result
                ? "border-border hover:border-brand/50"
                : isCorrect
                  ? "border-emerald-500/60 bg-emerald-500/10"
                  : isPicked
                    ? "border-rose-500/60 bg-rose-500/10"
                    : "border-border opacity-60"
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!!result}
                  onClick={() => choose(i)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                    cls,
                  )}
                >
                  <kbd className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {i + 1}
                  </kbd>
                  <span>{c}</span>
                </button>
              )
            })}
          </div>
          {result && (
            <div className="flex flex-col gap-2 pt-0.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-xs font-medium",
                    result.correct ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {result.correct ? "✓ Correct" : `✗ ${result.expected}`}
                </span>
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={nextQuestion}>
                  Next
                  <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
                </Button>
              </div>
              <AnswerFeedback signal={result.signal} source={result.source} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** State of the top-down sub-section walk, reported up so the lesson Continue footer can drive it. */
export type ConceptWalkState = { index: number; total: number; next: (() => void) | null } | null

/** The concepts extracted from a TOC section. For a chapter scope this is a guided top-down WALK —
 *  one sub-section at a time. `onWalk` lets the lesson Continue footer step the walk. */
export function SectionConceptsPanel({
  scope,
  docId,
  onAnswered,
  onWalk,
}: {
  scope: string | null
  docId?: string
  onAnswered?: () => void
  onWalk?: (state: ConceptWalkState) => void
}) {
  const [concepts, setConcepts] = useState<ConceptLesson[]>([])
  const [sections, setSections] = useState<ConceptSection[]>([])
  const [mastery, setMastery] = useState<ConceptMasteryResponse["byConcept"]>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Index into the top-down sub-section walk (Pass 2: one sub-section at a time).
  const [step, setStep] = useState(0)

  // Report walk position up so the lesson Continue footer / → key can advance subsections.
  const total = sections.length
  const walkActive = total > 1
  const idx = Math.min(step, Math.max(0, total - 1))
  useEffect(() => {
    if (!onWalk) return
    if (!walkActive) {
      onWalk(null)
      return
    }
    onWalk({
      index: idx,
      total,
      next: idx < total - 1 ? () => setStep((n) => Math.min(total - 1, n + 1)) : null,
    })
  }, [onWalk, walkActive, idx, total])

  useEffect(() => {
    if (!scope) {
      setConcepts([])
      setSections([])
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    setStep(0)
    Promise.all([fetchSectionConcepts(scope, docId), fetchConceptMastery(docId).catch(() => null)])
      .then(([res, m]) => {
        if (!active) return
        if (res.error) setError(res.error)
        else {
          setConcepts(res.concepts || [])
          setSections(res.sections || [])
        }
        if (m && !m.error) setMastery(m.byConcept || {})
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Failed to load concepts"))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [scope, docId])

  if (!scope) {
    return <p className="p-4 text-sm text-muted-foreground">Select a section to see its concepts.</p>
  }
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border bg-card p-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1 h-3 w-4/5" />
          </div>
        ))}
      </div>
    )
  }
  if (error) {
    return <p className="p-4 text-sm text-destructive">{error}</p>
  }
  if (concepts.length === 0) {
    return (
      <div className="m-4 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        No concepts extracted for this section yet. Extract it from the syllabus to build them.
      </div>
    )
  }
  const renderCard = (c: ConceptLesson, i: number) => {
    const m = c.conceptKey ? mastery[c.conceptKey] : undefined
    return (
      <ConceptCard key={c.conceptKey ?? i} concept={c} mastery={m?.mastery} attempts={m?.attempts} />
    )
  }

  // Single sub-section (leaf scope) → flat list. A chapter spanning several sub-sections →
  // a guided top-down WALK: one sub-section at a time. The lesson Continue footer / → key
  // advances the walk (then moves on to quizzes); the chevrons here are for manual nav.
  if (!walkActive) {
    return <ul className="flex flex-col gap-2 p-4">{concepts.map(renderCard)}</ul>
  }

  const s = sections[idx]
  const items = concepts.filter((c) => c.sectionKey === s.sectionKey)
  const depth = Math.min(s.depth ?? 0, 4)

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Walk position + manual nav */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          Subsection {idx + 1} / {total}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={idx === 0}
            onClick={() => setStep((n) => Math.max(0, n - 1))}
            title="Previous subsection"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={idx >= total - 1}
            onClick={() => setStep((n) => Math.min(total - 1, n + 1))}
            title="Next subsection"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Where you are in the outline */}
      <div style={{ marginLeft: `${depth * 0.75}rem` }}>
        <h3 className="text-base font-semibold text-foreground">
          {displaySectionTitle(s.title || s.sectionKey)}
        </h3>
        {s.essence && <p className="mt-0.5 text-sm text-muted-foreground">{s.essence}</p>}
      </div>

      <ul className="flex flex-col gap-2">{items.map(renderCard)}</ul>

      <ConceptQuickCheck key={s.sectionKey} scope={s.sectionKey} docId={docId} onAnswered={onAnswered} />
    </div>
  )
}
