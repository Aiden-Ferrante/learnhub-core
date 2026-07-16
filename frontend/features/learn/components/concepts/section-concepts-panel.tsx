"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, CheckCircle2, ChevronDown, Zap } from "lucide-react"
import { AnswerFeedback } from "@/features/learn/components/study/answer-feedback"
import { ConceptMarkdown } from "@/features/learn/components/concepts/concept-markdown"
import { MathText } from "@/features/learn/components/reader/markdown-reader"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { fetchSectionConcepts, type ConceptLesson } from "@/features/learn/api/concepts"
import { KIND_CHIP } from "@/features/learn/components/concepts/kind-palette"
import { QuizChoiceList } from "@/features/learn/components/study/quiz-choice-list"
import { useConceptQuizSession } from "@/features/learn/components/study/use-concept-quiz"
import { useStudyHotkeys } from "@/features/learn/hooks/use-study-hotkeys"

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
  const [answered, setAnswered] = useState(0)
  const onQuizAnswered = useCallback(() => {
    setAnswered((n) => n + 1)
    onAnswered?.()
  }, [onAnswered])
  const {
    session,
    picked,
    result,
    loading,
    error,
    start: nextQuestion,
    answer: choose,
  } = useConceptQuizSession(scope, docId, onQuizAnswered)

  const begin = () => {
    setOpen(true)
    setAnswered(0)
    nextQuestion()
  }

  const finished = answered >= QUICK_CHECK_QUESTIONS && !!result

  // Keyboard: 1-9 pick a choice; Enter advances to the next question (matches the kbd hints).
  // useStudyHotkeys registers ONCE — the old inline listener re-registered every render
  // because `choose` wasn't memoized.
  useStudyHotkeys((e) => {
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
  }, open)

  if (!open) {
    return (
      <button
        type="button"
        onClick={begin}
        title="Two quick questions to confirm this subsection landed before you move on"
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
          <QuizChoiceList choices={session.choices} picked={picked} result={result} onPick={choose} size="sm" />
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

type RecallMark = "got" | "fuzzy"

/** One concept as an active-recall row: the NAME alone invites you to describe it from
 *  memory; opening it reveals the definition to check against, then a self-mark. The
 *  definition is deliberately separate from the name — recalling the name is the act. */
function ConceptRecallRow({
  concept,
  index,
  open,
  mark,
  onOpen,
  onMark,
}: {
  concept: ConceptLesson
  index: number
  open: boolean
  mark: RecallMark | undefined
  onOpen: () => void
  onMark: (m: RecallMark) => void
}) {
  return (
    <li
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        open ? "border-brand/40 bg-card" : "bg-card/60 hover:border-border",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
        title={open ? undefined : "Describe it to yourself, then tap to check"}
      >
        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{concept.name}</span>
        {mark === "got" ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
        ) : mark === "fuzzy" ? (
          <span className="shrink-0 text-xs font-semibold text-amber-400">~</span>
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted-foreground/40" />
        )}
      </button>
      {/* Smooth reveal — grid-rows animation, no remount, no layout jump. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-2 border-t px-3 py-2.5 pl-[2.625rem]">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px]",
                  KIND_CHIP[concept.kind] ?? "border-border text-muted-foreground",
                )}
              >
                {concept.kind}
              </span>
            </div>
            <MathText text={concept.signal} className="text-sm text-foreground/90" />
            <div className="flex items-center gap-2 pt-0.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("h-7 gap-1 px-2.5 text-xs", mark === "got" && "border-brand/60 text-brand")}
                onClick={() => onMark("got")}
              >
                <Check className="h-3 w-3" />
                Described it
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "h-7 px-2.5 text-xs",
                  mark === "fuzzy" && "border-amber-400/60 text-amber-400",
                )}
                onClick={() => onMark("fuzzy")}
              >
                Fuzzy
              </Button>
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}

/** The concepts of one leaf TOC section as an ACTIVE-RECALL list: bare names first
 *  (describe each from memory), definitions revealed per concept to check, self-mark,
 *  auto-advance to the next unchecked name. The quick-check MCQs follow as the graded
 *  retrieval. */
export function SectionConceptsPanel({
  scope,
  docId,
  onAnswered,
}: {
  scope: string | null
  docId?: string
  onAnswered?: () => void
}) {
  const [concepts, setConcepts] = useState<ConceptLesson[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [marks, setMarks] = useState<Record<string, RecallMark>>({})

  const marksKey = `txt2k:concept-recall:${docId ?? ""}:${scope ?? ""}`
  useEffect(() => {
    setOpenKey(null)
    try {
      const raw = localStorage.getItem(marksKey)
      setMarks(raw ? (JSON.parse(raw) as Record<string, RecallMark>) : {})
    } catch {
      setMarks({})
    }
  }, [marksKey])

  useEffect(() => {
    if (!scope) {
      setConcepts([])
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    fetchSectionConcepts(scope, docId)
      .then((res) => {
        if (!active) return
        if (res.error) setError(res.error)
        else setConcepts(res.concepts || [])
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
  const keyFor = (c: ConceptLesson, i: number) => c.conceptKey ?? `${c.name}-${i}`
  const markedCount = concepts.filter((c, i) => marks[keyFor(c, i)]).length
  const allMarked = markedCount >= concepts.length

  const markConcept = (key: string, index: number, m: RecallMark) => {
    const next = { ...marks, [key]: m }
    setMarks(next)
    try {
      localStorage.setItem(marksKey, JSON.stringify(next))
    } catch {
      /* storage unavailable */
    }
    // Flow: marking one glides you to the next unchecked name.
    for (let j = index + 1; j < concepts.length + index; j++) {
      const c = concepts[j % concepts.length]
      const k = keyFor(c, j % concepts.length)
      if (!next[k]) {
        setOpenKey(k)
        return
      }
    }
    setOpenKey(null)
  }

  // Names first — the recall act is describing each one before its definition appears.
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          From memory — can you <span className="font-medium text-foreground">describe</span> each
          concept? Tap a name to check yourself.
        </p>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {markedCount}/{concepts.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {concepts.map((c, i) => {
          const k = keyFor(c, i)
          return (
            <ConceptRecallRow
              key={k}
              concept={c}
              index={i}
              open={openKey === k}
              mark={marks[k]}
              onOpen={() => setOpenKey(openKey === k ? null : k)}
              onMark={(m) => markConcept(k, i, m)}
            />
          )
        })}
      </ul>
      {allMarked && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-brand">
          <CheckCircle2 className="h-3.5 w-3.5" />
          All checked — run a quick check to lock them in.
        </p>
      )}
      <ConceptQuickCheck key={scope ?? ""} scope={scope} docId={docId} onAnswered={onAnswered} />
    </div>
  )
}
