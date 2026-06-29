"use client"

import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchChapterProgress, updateChapterStage } from "@/lib/learn-service"
import { PATH_STAGES as STAGES, doneMap } from "@/lib/learn-path"
import type { StudyMode } from "@/components/learn/section-panel"

type ChapterPathProps = {
  scope: string | null
  docId?: string
  studyMode: StudyMode
  onSelect: (mode: StudyMode) => void
  /** Bump to re-read progress after a stage completes elsewhere. */
  refreshKey?: number
}

/** A soft-gated stepper across the 7 learning-path stages: shows ✓/current, navigates on
 *  click, and lets you tick the "soft" stages done. Nothing is locked. */
export function ChapterPath({ scope, docId, studyMode, onSelect, refreshKey }: ChapterPathProps) {
  const [done, setDone] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!scope) return
    let cancelled = false
    fetchChapterProgress(scope, docId)
      .then((p) => {
        if (cancelled) return
        setDone(doneMap(p.stages))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // re-read when the chapter changes, the mode switches, or a completion bumps refreshKey
  }, [scope, docId, studyMode, refreshKey])

  if (!scope) return null

  const currentKey = STAGES.find((s) => !done[s.key])?.key ?? null

  const toggle = (key: string, next: boolean) => {
    setDone((d) => ({ ...d, [key]: next }))
    updateChapterStage(scope, docId, key, { done: next }).catch(() => {})
  }

  const completed = STAGES.filter((s) => done[s.key]).length

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Learning path</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {completed}/{STAGES.length} done
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {STAGES.map((s, i) => {
          const isDone = !!done[s.key]
          const isCurrent = s.key === currentKey
          const isActive = studyMode === s.mode
          return (
            // A div wrapper carries the state styling; inside are two real, keyboard-reachable
            // buttons (toggle done · navigate) — no invalid nested-interactive markup.
            <div
              key={s.key}
              className={cn(
                "flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors",
                isActive
                  ? "border-brand bg-brand/15 text-brand ring-1 ring-brand/40"
                  : isCurrent
                    ? "border-foreground/40 text-foreground"
                    : isDone
                      ? "border-brand/30 text-muted-foreground"
                      : "border-border text-muted-foreground",
              )}
            >
              <button
                type="button"
                aria-pressed={isDone}
                aria-label={isDone ? `${s.label}: done — mark not done` : `Mark ${s.label} done`}
                onClick={() => toggle(s.key, !isDone)}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] tabular-nums",
                  isDone ? "bg-brand text-background" : "bg-muted text-muted-foreground",
                )}
              >
                {isDone ? <Check className="h-3 w-3" /> : i + 1}
              </button>
              <button
                type="button"
                onClick={() => onSelect(s.mode)}
                title={`Go to ${s.label}`}
                className="max-w-full truncate hover:text-foreground"
              >
                {s.label}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
