"use client"

import { useState } from "react"
import { Check, Eye, GripVertical, Sparkles, X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { GRADE_INVALIDATES, useApiMutation, unwrap } from "@/kit/data"
import { submitSkeletonReviewGrade, type ReviewGrade } from "@/gateways/api/review"
import { GradeButtons } from "@/kit/study"
import { shuffled, type PracticeItem } from "@/surfaces/studying/skeleton-items"
import { cn } from "@/kit/lib/utils"

/** What a structural recall grade writes: the FSRS skeleton item for `scope`, with the
 *  true children snapshotted for the review reveal. Null = drill only (nothing written). */
export type RecallTarget = { docId: string; scope: string; heading: string; chapterScope?: string } | null

/** Recall: produce the list from memory, reveal, self-grade. A structural grade is saved
 *  to the review schedule and shows "Graded — scheduled." only once it landed; a failure
 *  reads "Not saved · Retry". Remount (a new `key`) to start a new round. */
export function RecallDrill({
  items,
  target,
  onAnswered,
}: {
  items: PracticeItem[]
  target: RecallTarget
  onAnswered?: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [graded, setGraded] = useState<ReviewGrade | null>(null)
  const [last, setLast] = useState<ReviewGrade | null>(null)

  const save = useApiMutation(
    (g: ReviewGrade) =>
      unwrap(
        submitSkeletonReviewGrade(target!.docId, target!.scope, g, {
          heading: target!.heading,
          chapterScope: target!.chapterScope,
          children: items.map((it) => ({ heading: it.label, essence: it.detail ?? "" })),
        }),
      ),
    {
      invalidates: GRADE_INVALIDATES,
      onSuccess: (_res, g) => {
        setGraded(g)
        onAnswered?.()
      },
    },
  )

  const grade = (g: ReviewGrade) => {
    if (!target) return setGraded(g)
    setLast(g)
    save.fire(g)
  }

  if (!revealed) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {items.length} item{items.length === 1 ? "" : "s"} to recall. Say them out loud or write them down, then
          reveal.
        </p>
        <Button className="self-start gap-1.5" onClick={() => setRevealed(true)}>
          <Eye className="h-4 w-4" />
          Reveal
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col divide-y divide-border/40">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-start gap-2 py-1.5">
            <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 text-sm leading-snug">
              <span className="block">{it.label}</span>
              {it.detail && <span className="block text-xs text-muted-foreground">{it.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {graded ? (
        <span className="flex items-center gap-1.5 text-sm text-ink-accent">
          <Check className="h-4 w-4" />
          Graded{target ? " — scheduled." : "."}
        </span>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">How did you do?</span>
          <GradeButtons
            compact
            onGrade={grade}
            pending={save.pending}
            error={save.error}
            onRetry={() => last && save.fire(last)}
          />
        </div>
      )}
    </div>
  )
}

/** Sort: drag the shuffled items into order, then check. Practice only — it writes
 *  nothing. Seeds its shuffle on mount; remount (a new `key`) to reshuffle. */
export function SortDrill({ items }: { items: PracticeItem[] }) {
  const [order, setOrder] = useState(() => shuffled(items))
  const [checked, setChecked] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)

  const correctAt = (key: string, i: number) => items[i]?.key === key
  const correctCount = order.filter((it, i) => correctAt(it.key, i)).length

  const moveOver = (overKey: string) =>
    setOrder((cur) => {
      const from = cur.findIndex((x) => x.key === dragKey)
      const to = cur.findIndex((x) => x.key === overKey)
      if (from < 0 || to < 0 || from === to) return cur
      const next = [...cur]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Drag the {items.length} item{items.length === 1 ? "" : "s"} into the right order, then check.
      </p>
      <ul className="flex flex-col gap-1">
        {order.map((it, i) => {
          const ok = correctAt(it.key, i)
          return (
            <li
              key={it.key}
              draggable={!checked}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move"
                e.dataTransfer.setData("text/plain", it.key) // Firefox needs data to drag
                setDragKey(it.key)
              }}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => {
                if (!dragKey || checked || dragKey === it.key) return
                e.preventDefault()
                moveOver(it.key)
              }}
              onDrop={(e) => e.preventDefault()}
              className={cn(
                "flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm",
                !checked && "cursor-grab border-border/60 bg-card hover:border-border active:cursor-grabbing",
                dragKey === it.key && "opacity-40",
                checked && ok && "border-status-mastered/40 bg-status-mastered/10",
                checked && !ok && "border-destructive/40 bg-destructive/10",
              )}
            >
              <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              {!checked ? (
                <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-ok" />
              ) : (
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-danger" />
              )}
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block">{it.label}</span>
                {checked && !ok && (
                  <span className="block text-xs text-muted-foreground">
                    belongs at #{items.findIndex((x) => x.key === it.key) + 1}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {checked ? (
        <p className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-ink-accent" />
          <span className="tabular-nums">
            {correctCount}/{order.length} in place
          </span>
          <span className="text-xs text-muted-foreground">Practice only — nothing was written to your schedule.</span>
        </p>
      ) : (
        <Button className="self-start gap-1.5" onClick={() => setChecked(true)}>
          <Check className="h-4 w-4" />
          Check order
        </Button>
      )}
    </div>
  )
}
