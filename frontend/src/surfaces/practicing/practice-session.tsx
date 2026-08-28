"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, Dumbbell } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { ConceptMarkdown } from "@/surfaces/concepts"
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

/** The practice session — work a problem, reveal the worked solution, grade yourself.
 *
 *  Deliberately a SEPARATE session from concept review (its own queue, same FSRS engine,
 *  same 1-4 scale): a ten-minute derivation must never land mid-run of twenty-second
 *  concept cards. The reveal's answer/rubric come from the item pool at queue time — an
 *  edit in the Practice tab shows up on the very next session. */
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

  useEffect(() => {
    if (!scope && chapters.length) setScope(chapters[0].sectionKey)
  }, [chapters, scope])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 truncate text-sm font-medium">
            <Dumbbell className="h-4 w-4 text-brand" />
            {courseTitle}
          </h1>
          <p className="text-xs text-muted-foreground">Practice — work it, then grade yourself</p>
        </div>
      </div>

      <div className="flex gap-4">
        {/* The chapter rail, in the same order and naming the syllabus uses. */}
        <nav className="w-56 shrink-0 space-y-0.5">
          {loading && !chapters.length
            ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)
            : chapters.map((c) => {
                const key = c.sectionKey as string
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setScope(key)}
                    className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${
                      key === scope ? "bg-muted font-medium" : "hover:bg-muted/50"
                    }`}
                  >
                    {displaySectionTitle(c.label, c.title)}
                  </button>
                )
              })}
        </nav>

        <div className="min-w-0 flex-1 rounded-lg border bg-card">
          {scope ? (
            <PracticeRun key={scope} scope={scope} docId={docId} onAnswered={onAnswered} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Pick a chapter to practise.</p>
          )}
        </div>
      </div>
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

/** One chapter's run: prompt → work → reveal worked solution + rubric → self-grade. */
function PracticeRun({
  scope,
  docId,
  onAnswered,
}: {
  scope: string
  docId?: string
  onAnswered?: () => void
}) {
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [counts, setCounts] = useState<ReviewQueueResponse["counts"]>({ due: 0, new: 0, later: 0 })
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(0)
  const [stats, setStats] = useState({ good: 0, again: 0 })

  const load = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetchReviewQueue(docId, scope, 40, "practice")
      .then((res) => {
        if (!active) return
        if (res.error) setError(res.error)
        else {
          setCards(res.cards)
          setCounts(res.counts)
          setIdx(0)
          setRevealed(false)
          setDone(0)
          setStats({ good: 0, again: 0 })
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

  const grade = useCallback(
    (g: ReviewGrade) => {
      if (!card?.practiceKey) return
      submitPracticeReviewGrade(card.practiceKey, g, docId).catch(() => {})
      onAnswered?.()
      setDone((d) => d + 1)
      setStats((s) => (g >= 3 ? { ...s, good: s.good + 1 } : { ...s, again: s.again + 1 }))
      setRevealed(false)
      setIdx((i) => i + 1)
    },
    [card, docId, onAnswered],
  )

  useStudyHotkeys((e) => {
    if (!card) return
    if (!revealed && (e.key === " " || e.key === "Enter")) {
      e.preventDefault()
      setRevealed(true)
    } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault()
      grade(Number(e.key) as ReviewGrade)
    }
  })

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading practice queue…</p>
  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>

  if (!card) {
    const finished = done > 0
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        {finished && <div className="text-3xl">💪</div>}
        <p className="text-sm font-medium">
          {finished
            ? `Session done — ${done} worked`
            : counts.later > 0
              ? "Nothing due right now."
              : "No practice items for this chapter yet."}
        </p>
        {finished && (
          <p className="text-xs">
            <span className="text-status-mastered">{stats.good} good</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-destructive">{stats.again} to revisit</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {counts.later > 0
            ? `${counts.later} scheduled for later · ${counts.new} new`
            : "Generate items in the course editor's Practice tab."}
        </p>
        <Button variant="outline" size="sm" onClick={load}>
          {finished ? "Practise again" : "Refresh"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {counts.due} due · {counts.new} new
          </span>
          <span className="tabular-nums">
            {idx + 1} / {cards.length}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${(idx / Math.max(1, cards.length)) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 rounded-lg border bg-card p-5">
        <div className="flex items-center gap-2">
          <span className="rounded bg-brand/15 px-1.5 py-0.5 text-micro font-medium uppercase text-brand">
            {KIND_LABEL[card.practiceKind ?? ""] ?? "practice"}
          </span>
          {card.state === "new" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
              new
            </span>
          )}
        </div>

        <ConceptMarkdown content={card.prompt ?? ""} className="text-sm" />

        {!revealed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-xs text-muted-foreground">
              Work it out — on paper, in your head, or in an editor — then compare.
            </p>
            <Button onClick={() => setRevealed(true)}>
              Reveal worked solution{" "}
              <kbd className="ml-2 rounded bg-muted px-1 text-micro">space</kbd>
            </Button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3 overflow-auto">
            <div className="border-l-2 border-brand/40 pl-3">
              <ConceptMarkdown content={card.answer ?? ""} className="text-sm" />
            </div>
            {card.rubric && (
              <p className="text-xs italic text-muted-foreground">
                A correct answer must: {card.rubric}
              </p>
            )}
          </div>
        )}
      </div>

      {revealed && (
        <div className="grid grid-cols-4 gap-2">
          {GRADES.map(({ grade: g, label, cls }) => (
            <Button
              key={g}
              type="button"
              variant="outline"
              className={`flex-col gap-0.5 ${cls}`}
              onClick={() => grade(g)}
            >
              <span>{label}</span>
              <kbd className="rounded bg-muted px-1 text-micro opacity-70">{g}</kbd>
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
