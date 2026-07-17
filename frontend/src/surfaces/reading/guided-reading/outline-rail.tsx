"use client"

import { cn } from "@/kit/lib/utils"

export type RailItem = {
  key: string
  number: string
  text: string
  depthPad: number
  /** Rendered-heading index to jump to (-1 when the text has no match). */
  target: number
}

/** The chapter outline rail — always in view while reading, locked to THIS chapter.
 *  Fills the dead left margin; scroll-spy highlights where you are. Items come from the
 *  shell (canonical tree outline when available, else synthesized heading numbering),
 *  and jumps go through onJump so the shell owns the rendered-heading list. */
export function OutlineRail({
  items,
  activeIndex,
  onJump,
  paper,
  mutedCls,
}: {
  items: RailItem[]
  activeIndex: number
  onJump: (headingIndex: number) => void
  paper: boolean
  mutedCls: string
}) {
  if (items.length === 0) return null
  return (
    <nav className="sticky top-0 hidden max-h-[calc(100dvh-220px)] w-56 shrink-0 self-start overflow-y-auto pb-4 pr-1 pt-1 lg:block">
      <div className={cn("mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide", mutedCls)}>
        In this chapter
      </div>
      <div className="space-y-0.5">
        {items.map((it, j) => (
          <button
            key={it.key}
            type="button"
            title={it.number ? `${it.number} ${it.text}` : it.text}
            onClick={(e) => {
              e.stopPropagation()
              if (it.target >= 0) onJump(it.target)
            }}
            className={cn(
              "block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors",
              j === activeIndex
                ? "bg-brand/10 font-medium text-brand"
                : cn(mutedCls, paper ? "hover:bg-paper-card" : "hover:bg-muted/50", "hover:opacity-100"),
              it.target < 0 && "cursor-default opacity-60",
            )}
            style={{ paddingLeft: `${8 + it.depthPad * 12}px` }}
          >
            {it.number && <span className="mr-1.5 tabular-nums opacity-60">{it.number}</span>}
            {it.text}
          </button>
        ))}
      </div>
    </nav>
  )
}
