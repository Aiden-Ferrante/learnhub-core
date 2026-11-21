"use client"

/** Small pieces every search board shares: the Meaning / Exact words switch, status labels,
 *  highlighted text, the match bar and a book's colour dot. */

import { cn } from "@/kit/lib/utils"
import { coverColor } from "@/surfaces/library/cover"
import { highlight, STATUS_LABEL, type MemoryStatus } from "@/surfaces/searching/search-model"

/** Exact words works today; Meaning waits for the semantic backend and says so. */
export function ModeSwitch({ className }: { className?: string }) {
  return (
    <div role="radiogroup" aria-label="Search mode" className={cn("flex shrink-0 items-center rounded-lg border border-border bg-background p-0.5 text-micro", className)}>
      <span
        role="radio"
        aria-checked={false}
        aria-disabled
        title="Search by meaning is coming: it needs the semantic index. Exact words for now."
        className="flex cursor-not-allowed items-center gap-1 rounded-md px-2 py-1 text-muted-foreground/70"
      >
        Meaning
        <span className="rounded bg-muted px-1 text-[0.65rem] uppercase tracking-label">soon</span>
      </span>
      <span role="radio" aria-checked className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">
        Exact words
      </span>
    </div>
  )
}

const STATUS_CLASS: Record<MemoryStatus, string> = {
  due: "border-status-due/50 text-status-due",
  new: "border-border text-muted-foreground",
  learned: "border-status-mastered/50 text-status-mastered",
  shaky: "border-status-due/40 text-status-due/90",
  fading: "border-status-fading/50 text-status-fading",
}

export function StatusPill({ status, className }: { status: MemoryStatus; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[0.68rem] font-medium leading-4", STATUS_CLASS[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function Highlighted({ text, terms, className }: { text: string; terms: string[]; className?: string }) {
  return (
    <span className={className}>
      {highlight(text, terms).map((r, i) =>
        r.hit ? (
          <mark key={i} className="rounded-sm bg-brand/25 px-px text-foreground">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </span>
  )
}

/** How much of the query matched, 0–1. */
export function MatchBar({ share, className }: { share: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[0.68rem] tabular-nums text-muted-foreground", className)} title="Share of your search words it contains">
      <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      {Math.round(share * 100)}%
    </span>
  )
}

export function BookDot({ title, className }: { title: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: coverColor(title) }} />
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-background px-1 font-sans text-[0.68rem] text-muted-foreground">{children}</kbd>
}
