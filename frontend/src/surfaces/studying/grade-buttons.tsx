"use client"

import { Button } from "@/kit/ui/button"
import { ErrorNotice, type ApiError } from "@/kit/data"
import type { ReviewGrade } from "@/gateways/api/review"
import { GRADES } from "@/surfaces/studying/grade-scale"
import { cn } from "@/kit/lib/utils"

/** The Again/Hard/Good/Easy row every studying grade uses, with the "Not saved · Retry"
 *  line under it when the last grade failed. Buttons are disabled while a grade is in
 *  flight, so a double press can't send two. `compact` is the small inline row (skeleton
 *  recall); the default is the big 4-up grid with the 1–4 hotkey hints (review). */
export function GradeButtons({
  onGrade,
  pending,
  error,
  onRetry,
  compact = false,
}: {
  onGrade: (g: ReviewGrade) => void
  pending: boolean
  error: ApiError | null
  onRetry: () => void
  compact?: boolean
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
            className={cn(!compact && "flex-col gap-0.5", cls)}
            onClick={() => onGrade(g)}
          >
            <span>{label}</span>
            {!compact && <kbd className="rounded bg-muted px-1 text-micro opacity-70">{g}</kbd>}
          </Button>
        ))}
      </div>
      {error && <ErrorNotice compact title="Not saved" error={error} onRetry={onRetry} />}
    </div>
  )
}
