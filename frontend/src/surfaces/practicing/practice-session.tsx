"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Dumbbell, Grid3x3, Loader2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/kit/ui/select"
import {
  MarkdownReader,
  ReadingControls,
  useReadingPrefs,
  useReadingTheme,
  type ReadingPrefs,
  type ReadingTheme,
} from "@/surfaces/reading"
import { displaySectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import {
  fetchReviewQueue,
  submitPracticeReviewGrade,
  type ReviewCard,
  type ReviewGrade,
  type ReviewQueueResponse,
} from "@/gateways/api/review"
import { GRADES } from "@/surfaces/studying"
import { useStudyHotkeys } from "@/surfaces/studying"
import { MatchGame } from "@/surfaces/practicing/match-game"
import { cn } from "@/kit/lib/utils"

/** The surface's modes. Session is graded and scheduled; Match is drill only. */
type Mode = "session" | "match"

const MODES = [
  { value: "session" as const, label: "Session", icon: Dumbbell },
  { value: "match" as const, label: "Match", icon: Grid3x3 },
]

/** The practice session — work a problem, reveal the worked solution, grade yourself.
 *
 *  Shaped like a real exam rather than a flashcard drill: the whole paper is on screen as a
 *  numbered navigator you can jump around in, because a ten-minute derivation is not a card
 *  you flip once. Grading advances to the next UNGRADED question rather than the next
 *  index, so skipping around never loses your place, and a graded question stays visitable
 *  with its grade shown.
 *
 *  Deliberately a SEPARATE session from concept review (its own queue, same FSRS engine,
 *  same 1-4 scale): a derivation must never land mid-run of twenty-second concept cards.
 *  Reveal fields come from the item pool at queue time — an edit in the Practice tab shows
 *  up on the very next session.
 *
 *  Prompts and worked solutions render through the READER's own renderer at the reader's
 *  prose size, not the chrome's dense admin scale: this is a surface you sit and read at,
 *  the items are the book's material, and the Practice tab already edits them through the
 *  same renderer. Size and measure are the shared reading prefs, adjustable in the header —
 *  one control, one setting, everywhere text is read. */
export function PracticeSession({
  courseTitle,
  docId,
  tree,
  loading,
  onBack,
  onAnswered,
}: {
  courseTitle: string
  docId: string
  tree: LearnTreeNode[]
  loading: boolean
  onBack: () => void
  onAnswered?: () => void
}) {
  const chapters = useMemo(() => tree.filter((n) => n.sectionKey), [tree])
  const [scope, setScope] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("session")
  const [prefs, setPrefs] = useReadingPrefs()
  const [theme] = useReadingTheme()

  useEffect(() => {
    if (!scope && chapters.length) setScope(chapters[0].sectionKey)
  }, [chapters, scope])

  const chapterLabel = useMemo(() => {
    const c = chapters.find((n) => n.sectionKey === scope)
    return c ? displaySectionTitle(c.label, c.title) : undefined
  }, [chapters, scope])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 truncate text-base font-medium">
            <Dumbbell className="h-4 w-4 shrink-0 text-brand" />
            {courseTitle}
          </h1>
          <p className="text-xs text-muted-foreground">
            {mode === "session"
              ? "Practice — work it, then grade yourself"
              : "Match — pair the terms, race your own clock"}
          </p>
        </div>
        {/* The chapter is a picker, not a rail: the left column belongs to the questions. */}
        <div className="ml-auto flex items-center gap-2">
          {/* Modes on ONE surface. `99e4279` deleted seven study modules for being too
              many activities; this arc adds modes, not nav tabs. */}
          <div className="flex gap-1">
            {MODES.map((m) => (
              <Button
                key={m.value}
                type="button"
                variant={mode === m.value ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
                onClick={() => setMode(m.value)}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </Button>
            ))}
          </div>
          {mode === "session" && <ReadingControls prefs={prefs} onChange={setPrefs} />}
          <div className="w-64">
            {loading && !chapters.length ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={scope ?? undefined} onValueChange={setScope}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Pick a chapter" />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((c) => (
                    <SelectItem key={c.id} value={c.sectionKey as string}>
                      {displaySectionTitle(c.label, c.title)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      {!scope ? (
        <p className="p-6 text-sm text-muted-foreground">Pick a chapter to practise.</p>
      ) : mode === "session" ? (
        <PracticeRun
          key={scope}
          scope={scope}
          docId={docId}
          onAnswered={onAnswered}
          theme={theme}
          prefs={prefs}
        />
      ) : (
        <MatchGame key={scope} scope={scope} docId={docId} chapterLabel={chapterLabel} />
      )}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  retrieve: "retrieval",
  problem: "problem",
  mcq: "multiple choice",
  order: "ordering",
  code: "code",
}

/** Navigator swatch per question state — the same vocabulary as the grade scale, so a
 *  green square and a green "Good" button mean the same thing. */
function navClass(state: "current" | "again" | "hard" | "good" | "easy" | "seen" | "todo") {
  switch (state) {
    case "current":
      return "border-brand bg-brand/15 font-semibold text-brand ring-1 ring-brand"
    case "again":
      return "border-rose-500/50 bg-rose-500/10 text-rose-400"
    case "hard":
      return "border-amber-500/50 bg-amber-500/10 text-amber-400"
    case "good":
      return "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
    case "easy":
      return "border-blue-500/50 bg-blue-500/10 text-blue-400"
    default:
      return "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
  }
}

const GRADE_STATE = { 1: "again", 2: "hard", 3: "good", 4: "easy" } as const

/** One chapter's paper: prompt → work → reveal worked solution + rubric → self-grade. */
function PracticeRun({
  scope,
  docId,
  onAnswered,
  theme,
  prefs,
}: {
  scope: string
  docId?: string
  onAnswered?: () => void
  theme: ReadingTheme
  prefs: ReadingPrefs
}) {
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [counts, setCounts] = useState<ReviewQueueResponse["counts"]>({ due: 0, new: 0, later: 0 })
  const [idx, setIdx] = useState(0)
  // Reveal + grade are per QUESTION, not per position: jumping back to one you have already
  // opened must not hide its solution again.
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [grades, setGrades] = useState<Record<string, ReviewGrade>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetchReviewQueue(docId, scope, 100, "practice")
      .then((res) => {
        if (!active) return
        if (res.error) setError(res.error)
        else {
          setCards(res.cards)
          setCounts(res.counts)
          setIdx(0)
          setRevealed({})
          setGrades({})
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load practice queue")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [docId, scope])

  useEffect(() => load(), [load])

  const card = cards[idx]
  const cardKey = card?.practiceKey ?? ""
  const isRevealed = !!revealed[cardKey]
  const doneCount = Object.keys(grades).length

  const grade = useCallback(
    (g: ReviewGrade) => {
      if (!card?.practiceKey) return
      const key = card.practiceKey
      submitPracticeReviewGrade(key, g, docId).catch(() => {})
      onAnswered?.()
      setGrades((prev) => {
        const next = { ...prev, [key]: g }
        // Advance to the next question nobody has graded yet — wrapping — so jumping
        // around the paper never strands you on the last index.
        const order = [...cards.slice(idx + 1), ...cards.slice(0, idx + 1)]
        const target = order.find((c) => c.practiceKey && !next[c.practiceKey])
        if (target) setIdx(cards.findIndex((c) => c.practiceKey === target.practiceKey))
        return next
      })
    },
    [card, cards, idx, docId, onAnswered],
  )

  const reveal = useCallback(() => {
    if (cardKey) setRevealed((r) => ({ ...r, [cardKey]: true }))
  }, [cardKey])

  const go = useCallback(
    (delta: number) => setIdx((i) => Math.min(cards.length - 1, Math.max(0, i + delta))),
    [cards.length],
  )

  // Keyboard: space/enter reveals · 1-4 grade once revealed · arrows move through the paper.
  useStudyHotkeys((e) => {
    if (!card) return
    if (e.key === "ArrowRight") {
      e.preventDefault()
      go(1)
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      go(-1)
    } else if (!isRevealed && (e.key === " " || e.key === "Enter")) {
      e.preventDefault()
      reveal()
    } else if (isRevealed && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault()
      grade(Number(e.key) as ReviewGrade)
    }
  })

  if (loading)
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading practice queue…
      </div>
    )
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>

  if (!cards.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-10 text-center">
        <p className="text-base font-medium">
          {counts.later > 0 ? "Nothing due right now." : "No practice items for this chapter yet."}
        </p>
        <p className="text-sm text-muted-foreground">
          {counts.later > 0
            ? `${counts.later} scheduled for later`
            : "Generate a set in the course editor's Practice tab."}
        </p>
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>
    )
  }

  const finished = doneCount === cards.length

  return (
    <div className="flex gap-5">
      {/* The paper's navigator: every question at once, click to jump — an exam, not a deck. */}
      <nav className="w-52 shrink-0 space-y-3">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Questions</span>
          <span className="tabular-nums">
            {doneCount}/{cards.length}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {cards.map((c, i) => {
            const k = c.practiceKey ?? String(i)
            const g = grades[k]
            const state =
              i === idx
                ? "current"
                : g
                  ? GRADE_STATE[g]
                  : revealed[k]
                    ? "seen"
                    : "todo"
            return (
              <button
                key={k}
                type="button"
                onClick={() => setIdx(i)}
                title={`${i + 1}. ${(c.prompt ?? "").slice(0, 80)}`}
                className={cn(
                  "flex h-9 items-center justify-center rounded border text-sm tabular-nums transition-colors",
                  navClass(state as Parameters<typeof navClass>[0]),
                )}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
        <ul className="space-y-1 text-micro text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-emerald-500/50 bg-emerald-500/10" />
            answered well
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-rose-500/50 bg-rose-500/10" />
            to revisit
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-border" />
            not answered
          </li>
        </ul>
        <p className="text-micro text-muted-foreground">
          {counts.due} due · {counts.new} new
          {counts.later > 0 && ` · ${counts.later} later`}
        </p>
      </nav>

      <div className="min-w-0 flex-1">
        {finished && (
          <p className="mb-3 rounded border border-emerald-500/40 bg-emerald-500/5 px-4 py-2 text-sm">
            🎉 Every question answered — {doneCount} worked. Revisit any of them above, or
            <button type="button" className="ml-1 underline" onClick={load}>
              reload the paper
            </button>
            .
          </p>
        )}

        <article className="rounded-lg border bg-card p-6">
          <header className="mb-4 flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums text-muted-foreground">
              Question {idx + 1}
            </span>
            <span className="rounded bg-brand/15 px-2 py-0.5 text-micro font-medium uppercase text-brand">
              {KIND_LABEL[card.practiceKind ?? ""] ?? "practice"}
            </span>
            {card.state === "new" && (
              <span className="rounded bg-muted px-2 py-0.5 text-micro text-muted-foreground">
                new
              </span>
            )}
            {grades[cardKey] && (
              <span className="ml-auto text-xs text-muted-foreground">
                graded {GRADES.find((g) => g.grade === grades[cardKey])?.label.toLowerCase()}
              </span>
            )}
          </header>

          {/* The prompt is the thing you are working on — reading size, the reader's own
              renderer, left-aligned rather than the reader's centred column. */}
          <MarkdownReader
            content={card.prompt ?? ""}
            theme={theme}
            proseSize={prefs.size}
            measure={prefs.measure}
            className="mx-0 max-w-none"
          />

          {!isRevealed ? (
            <div className="mt-6 flex items-center gap-3">
              <Button size="lg" onClick={reveal}>
                Reveal worked solution
                <kbd className="ml-2 rounded bg-background/20 px-1.5 text-micro">space</kbd>
              </Button>
              <span className="text-xs text-muted-foreground">
                Work it out first — on paper, in your head, or in an editor.
              </span>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <div className="rounded-md border-l-2 border-brand/50 bg-muted/30 py-3 pl-4 pr-3">
                <p className="mb-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                  Worked solution
                </p>
                <MarkdownReader
                  content={card.answer ?? ""}
                  theme={theme}
                  proseSize={prefs.size}
                  measure={prefs.measure}
                  className="mx-0 max-w-none"
                />
              </div>
              {card.rubric && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">A correct answer must:</span>{" "}
                  {card.rubric}
                </p>
              )}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {GRADES.map(({ grade: g, label, cls }) => (
                  <Button
                    key={g}
                    type="button"
                    variant="outline"
                    size="lg"
                    className={cn("flex-col gap-0.5", cls)}
                    onClick={() => grade(g)}
                  >
                    <span className="text-sm">{label}</span>
                    <kbd className="rounded bg-muted px-1 text-micro opacity-70">{g}</kbd>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </article>

        <div className="mt-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={idx === 0}
            onClick={() => go(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={idx >= cards.length - 1}
            onClick={() => go(1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
