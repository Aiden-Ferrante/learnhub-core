"use client"

import { MathText } from "@/surfaces/reading/markdown-reader"
import type { Measure } from "@/surfaces/reading/use-reading-prefs"
import { HALF_MEASURE, type MarginNote } from "./lib"
import { cn } from "@/kit/lib/utils"

/** Margin notes (wide screens): each concept's FIRST mention surfaces as a Tufte-style
 *  sidenote beside the prose. Positions are measured by the shell's DOM pass (the impure
 *  layout effect that also dedupes annotations and feeds the outline rail — it stays there
 *  by design); this component only renders. Clicking opens the concept popover to the left. */
export function MarginNotes({
  notes,
  measure,
  paper,
  mutedCls,
  onOpen,
}: {
  notes: MarginNote[]
  measure: Measure
  paper: boolean
  mutedCls: string
  onOpen: (idx: number, x: number, y: number) => void
}) {
  return (
    <>
      {notes.map((n) => (
        <button
          key={n.key}
          type="button"
          className={cn(
            "absolute hidden w-52 rounded-md border border-transparent p-1.5 text-left transition-colors min-[1440px]:block",
            paper ? "hover:border-paper-border hover:bg-paper-card" : "hover:border-border hover:bg-card",
          )}
          style={{ top: n.top, left: `calc(50% + ${HALF_MEASURE[measure]} + 28px)` }}
          onClick={(e) => {
            e.stopPropagation()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onOpen(n.idx, Math.max(16, r.left - 440), r.top)
          }}
        >
          <div className={cn("truncate text-xs font-medium", paper ? "text-paper-ink-strong" : "text-foreground/90")}>
            {n.name}
          </div>
          <div className={cn("mt-0.5 line-clamp-3 text-micro leading-snug", mutedCls)}>
            <MathText text={n.signal} />
          </div>
        </button>
      ))}
    </>
  )
}
