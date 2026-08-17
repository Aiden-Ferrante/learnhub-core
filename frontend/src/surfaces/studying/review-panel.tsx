"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/kit/ui/button"
import { KIND_BADGE } from "@/surfaces/concepts"
import { ConceptMarkdown } from "@/surfaces/concepts"
import { SectionFigures } from "@/surfaces/reading"
import { fetchReviewQueue, submitReviewGrade, type ReviewCard, type ReviewGrade, type ReviewQueueResponse } from "@/gateways/api/review"
import { GRADES } from "@/surfaces/studying/grade-scale"
import { useStudyHotkeys } from "@/surfaces/studying/use-study-hotkeys"

/** Spaced-repetition recall: name → recall → reveal signal/source → self-grade (Again/Hard/Good/Easy).
 *  Keyless. `scope` = the chapter/section being studied (sessions are chapter-scoped). */
export function ReviewPanel({
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

  // `load` returns a cleanup that ignores an in-flight response, so a rapid
  // scope/doc switch can't let a stale queue overwrite the fresh one.
  const load = useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetchReviewQueue(docId, scope)
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
        if (active) setError(e instanceof Error ? e.message : "Failed to load review queue")
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
      if (!card) return
      submitReviewGrade(card.conceptKey, g, docId).catch(() => {})
      onAnswered?.()
      setDone((d) => d + 1)
      setStats((s) => (g >= 3 ? { ...s, good: s.good + 1 } : { ...s, again: s.again + 1 }))
      setRevealed(false)
      setIdx((i) => i + 1)
    },
    [card, docId, scope, onAnswered],
  )

  // Keyboard: space/enter reveals; 1-4 grade once revealed.
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

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading review queue…</p>
  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>

  if (!card) {
    const finished = done > 0
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        {finished && <div className="text-3xl">🎉</div>}
        <p className="text-sm font-medium">
          {finished ? `Session done — ${done} reviewed` : "Nothing due right now."}
        </p>
        {finished && (
          <p className="text-xs">
            <span className="text-status-mastered">{stats.good} good</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-destructive">{stats.again} to revisit</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {counts.later} scheduled for later · {counts.new} new
        </p>
        <Button variant="outline" size="sm" onClick={load}>
          {finished ? "Review again" : "Refresh"}
        </Button>
      </div>
    )
  }

  const isSkeleton = card.itemType === "skeleton"
  const isChapter = card.itemType === "chapter"
  const kindClass =
    isSkeleton || isChapter
      ? "bg-brand/15 text-brand"
      : KIND_BADGE[card.kind] || "bg-muted text-muted-foreground"

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
          <span className="text-lg font-semibold">{card.name}</span>
          <span className={`rounded px-1.5 py-0.5 text-micro font-medium uppercase ${kindClass}`}>
            {isSkeleton ? "structure" : isChapter ? "resurface" : card.kind}
          </span>
          {card.state === "new" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">new</span>
          )}
        </div>

        {!revealed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-auto text-center">
            <p className="text-sm text-muted-foreground">
              {isSkeleton
                ? "Rebuild this branch from memory — what sits under it, and what does each part say?"
                : isChapter
                  ? "You read this chapter a while ago — recall its main threads before they fade."
                  : "Recall what this concept means."}
            </p>
            <Button onClick={() => setRevealed(true)}>
              Reveal <kbd className="ml-2 rounded bg-muted px-1 text-micro">space</kbd>
            </Button>
          </div>
        ) : isSkeleton || isChapter ? (
          <ul className="flex-1 space-y-1.5 text-sm">
            {(card.children ?? []).map((c, i) => (
              <li key={i} className="leading-snug">
                <span className="font-medium">{c.heading}</span>
                {c.essence && <span className="text-muted-foreground"> — {c.essence}</span>}
              </li>
            ))}
            {!(card.children ?? []).length && (
              <li className="text-muted-foreground">No structure snapshot for this branch.</li>
            )}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col gap-3 overflow-auto">
            <ConceptMarkdown content={card.signal} className="text-sm" />
            {card.source && (
              <div className="border-l-2 border-muted pl-3 text-xs italic text-muted-foreground">
                <ConceptMarkdown content={card.source} />
              </div>
            )}
            <SectionFigures
              docId={card.docId ?? docId}
              sectionKey={card.sectionKey}
              pageStart={card.pageStart}
              pageEnd={card.pageEnd}
              limit={1}
              className="space-y-2"
            />
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
