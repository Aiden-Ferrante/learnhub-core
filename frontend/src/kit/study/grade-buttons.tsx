"use client"

import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data/error-notice"
import type { ApiError } from "@/gateways/api/http"
import type { ReviewGrade } from "@/gateways/api/review"
import { cn } from "@/kit/lib/utils"

/** THE recall grade scale (1=Again … 4=Easy) with its button styling. Review, skeleton
 *  recall, the concept detail and a pack's written-answer marks all render this one scale.
 *  Fill tokens carry the border and wash, ink tokens the word:
 *  Again = danger, Hard = warn, Good = ok, Easy = accent. */
export const GRADES: { grade: ReviewGrade; label: string; cls: string }[] = [
  { grade: 1, label: "Again", cls: "border-destructive/40 text-ink-danger hover:bg-destructive/10" },
  { grade: 2, label: "Hard", cls: "border-status-due/40 text-ink-warn hover:bg-status-due/10" },
  { grade: 3, label: "Good", cls: "border-status-mastered/40 text-ink-ok hover:bg-status-mastered/10" },
  { grade: 4, label: "Easy", cls: "border-brand/40 text-ink-accent hover:bg-brand/10" },
]

/** The Again/Hard/Good/Easy row every grade uses, with the "Not saved · Retry" line under
 *  it when the last grade failed. Buttons are disabled while a grade is in flight, so a
 *  double press can't send two. `compact` is the small inline row; the default is the
 *  4-up grid. `hints` shows the 1–4 hotkey under each label (default: on in the grid). */
export function GradeButtons({
  onGrade,
  pending,
  error,
  onRetry,
  compact = false,
  hints = !compact,
}: {
  onGrade: (g: ReviewGrade) => void
  pending: boolean
  error: ApiError | null
  /** Re-send the last grade. Omit when there is nothing to resend. */
  onRetry?: () => void
  compact?: boolean
  hints?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn(compact ? "flex flex-wrap gap-1.5" : "grid grid-cols-2 gap-2 sm:grid-cols-4")}>
        {GRADES.map(({ grade: g, label, cls }) => (
          <Button
            key={g}
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            disabled={pending}
            className={cn(hints && "flex-col gap-0.5", cls)}
            onClick={() => onGrade(g)}
          >
            <span>{label}</span>
            {hints && <kbd className="rounded bg-muted px-1 text-micro opacity-70">{g}</kbd>}
          </Button>
        ))}
      </div>
      {error && <ErrorNotice compact title="Not saved" error={error} onRetry={onRetry} />}
    </div>
  )
}
