import type React from "react"
import { cn } from "@/kit/lib/utils"

/** The study ground: graph paper (.study-page) under a 72rem, 24px-gutter column.
 *  Every study screen (Library, course home, review, concepts, skeleton, packs, Plan)
 *  renders inside one. It owns the container, so a screen never picks its own width.
 *
 *  `bar` renders a sticky .study-bar (tabs, clock) that sticks just below the app header.
 *  `narrow` is the 48rem reading column for single-task screens (a review run).
 *
 *  @example
 *  <StudyPage bar={<Tabs ... />}><Sheet title="Today">…</Sheet></StudyPage>
 */
export function StudyPage({
  children,
  bar,
  narrow = false,
  className,
}: {
  children: React.ReactNode
  bar?: React.ReactNode
  narrow?: boolean
  className?: string
}) {
  const column = cn("mx-auto w-full px-6", narrow ? "max-w-3xl" : "max-w-6xl")
  return (
    // min-height excludes the sticky app header, so an empty page does not scroll.
    <div className="study-page min-h-[calc(100vh_-_var(--fleet-header-h))]">
      {bar && (
        <div className="study-bar">
          <div className={cn(column, "flex flex-wrap items-center gap-3 py-2")}>{bar}</div>
        </div>
      )}
      <main className={cn(column, "flex flex-col gap-4 py-6", className)}>{children}</main>
    </div>
  )
}
