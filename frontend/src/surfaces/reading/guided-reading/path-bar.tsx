"use client"

import { Check, Headphones, MessageCircleQuestion, RotateCcw } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice, type ApiError } from "@/kit/data"
import { PATH_STAGES, firstIncompleteStage } from "@/surfaces/reading/learn-path"
import { cn } from "@/kit/lib/utils"
import type { StudyDrawer } from "./lib"

/** The path stepper: the guided journey compressed to one glance. Done stages are
 *  check-dots, the CURRENT stage keeps its label, the rest are quiet dots. The study
 *  actions (Review / Tutor / Listen) are pinned at the right, always reachable while
 *  reading. A stage mark that didn't save says so here, with Retry. */
export function PathBar({
  stages,
  onRunStage,
  dueCount,
  onOpenDrawer,
  markError,
  onRetryMark,
}: {
  stages: Record<string, boolean>
  onRunStage: (key: string) => void
  dueCount: number
  onOpenDrawer: (d: Exclude<StudyDrawer, null>) => void
  markError: ApiError | null
  onRetryMark: () => void
}) {
  const next = firstIncompleteStage(stages)
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b bg-card/60 px-3 py-1">
      <span className="mr-1 shrink-0 text-micro font-semibold uppercase tracking-label text-muted-foreground">
        Path
      </span>
      {PATH_STAGES.map((s) => {
        const done = !!stages[s.key]
        if (!done && next.key === s.key) {
          return (
            <Button
              key={s.key}
              type="button"
              variant="outline"
              size="sm"
              title={s.lead}
              onClick={() => onRunStage(s.key)}
              className="h-6 shrink-0 gap-1.5 rounded-full border-brand/40 bg-brand/10 px-2 text-xs text-ink-accent hover:bg-brand/20 hover:text-ink-accent"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              {s.label}
            </Button>
          )
        }
        return (
          <Button
            key={s.key}
            type="button"
            variant="ghost"
            size="icon"
            title={`${s.label} — ${s.lead}`}
            aria-label={`${s.label}${done ? " (done)" : ""}`}
            onClick={() => onRunStage(s.key)}
            className="h-6 w-6 shrink-0 rounded-full hover:bg-muted/60"
          >
            {done ? (
              <Check className="h-3 w-3 text-ink-ok" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            )}
          </Button>
        )
      })}
      <span className="ml-1 shrink-0 text-micro tabular-nums text-muted-foreground">
        {PATH_STAGES.filter((s) => stages[s.key]).length}/{PATH_STAGES.length}
      </span>
      {markError && (
        <ErrorNotice compact title="Not saved" error={markError} onRetry={onRetryMark} className="ml-2 shrink-0" />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-6 gap-1 px-2 text-xs", dueCount > 0 && "text-ink-warn hover:text-ink-warn")}
          onClick={() => onOpenDrawer("review")}
        >
          <RotateCcw className="h-3 w-3" />
          Review{dueCount > 0 ? ` · ${dueCount}` : ""}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => onOpenDrawer("tutor")}>
          <MessageCircleQuestion className="h-3 w-3" />
          Tutor
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => onOpenDrawer("listen")}>
          <Headphones className="h-3 w-3" />
          Listen
        </Button>
      </div>
    </div>
  )
}
