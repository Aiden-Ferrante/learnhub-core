"use client"

import { CheckCircle2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { AsyncView } from "@/kit/data"
import { Track } from "@/kit/study"
import { EmptyState } from "@/kit/patterns/empty-state"
import type { ReviewGrade } from "@/gateways/api/review"
import { GradeButtons } from "@/surfaces/studying/grade-buttons"
import { ReviewCardFace } from "@/surfaces/studying/review-card"
import { useReviewSession } from "@/surfaces/studying/use-review-session"
import { useStudyHotkeys } from "@/surfaces/studying/use-study-hotkeys"

/** Spaced-repetition recall: name → recall → reveal signal/source → self-grade (Again/Hard/Good/Easy).
 *  `scope` = the chapter/section being studied, or "course" for every due card in the
 *  course (/courses/[id]/review). A card advances only once its grade is saved; a failed
 *  grade says "Not saved · Retry" and keeps the card up. `onAnswered` fires after a saved
 *  grade (the shared cache is invalidated regardless). */
export function ReviewPanel({
  scope,
  docId,
  onAnswered,
}: {
  scope: string
  docId?: string
  onAnswered?: () => void
}) {
  const s = useReviewSession(docId, scope, onAnswered)
  const { card, revealed, run } = s

  // Keyboard: space/enter reveals; 1-4 grade once revealed.
  useStudyHotkeys((e) => {
    if (!card) return
    if (!revealed && (e.key === " " || e.key === "Enter")) {
      e.preventDefault()
      s.setRevealed(true)
    } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault()
      s.submit(Number(e.key) as ReviewGrade)
    }
  })

  return (
    <AsyncView q={s.q} errorTitle="Couldn't load the review queue">
      {(data) => {
        if (!run) return null
        const { counts } = data
        if (!card) {
          const finished = run.done > 0
          return (
            <EmptyState
              icon={finished ? <CheckCircle2 className="text-ink-ok" /> : undefined}
              title={finished ? `Session done — ${run.done} reviewed` : "Nothing due right now"}
              description={
                (finished ? `${run.good} good · ${run.again} to revisit. ` : "") +
                `${counts.later} scheduled for later · ${counts.new} new`
              }
              action={
                <Button variant="outline" size="sm" onClick={s.restart}>
                  {finished ? "Review again" : "Refresh"}
                </Button>
              }
            />
          )
        }
        return (
          <div className="flex h-full flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {counts.due} due · {counts.new} new
                </span>
                <span className="tabular-nums">
                  {run.idx + 1} / {run.cards.length}
                </span>
              </div>
              <Track tone="ok" label="Session progress" value={(run.idx / Math.max(1, run.cards.length)) * 100} />
            </div>

            <ReviewCardFace card={card} docId={docId} revealed={revealed} onReveal={() => s.setRevealed(true)} />

            {revealed && (
              <GradeButtons
                onGrade={s.submit}
                pending={s.grade.pending}
                error={s.grade.error}
                onRetry={s.retryGrade}
              />
            )}
          </div>
        )
      }}
    </AsyncView>
  )
}
