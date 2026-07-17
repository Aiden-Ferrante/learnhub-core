"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react"
import { ConceptMarkdown } from "@/surfaces/concepts/concept-markdown"
import { ConceptMasteryDot } from "@/surfaces/concepts/concept-mastery-dot"
import { cn } from "@/kit/lib/utils"
import { type ConceptLesson } from "@/gateways/api/concepts"
import { KIND_BADGE, KIND_BORDER } from "@/surfaces/concepts/kind-palette"

export function prettyScope(key?: string): string {
  if (!key) return ""
  return key.replace(/^toc:/, "").replace(/-/g, " ")
}

/** One expandable concept card: name + kind + 1-line signal; expands to source/Q&A.
 *  Self-contained (owns its open state) so it's reusable across the document and section views. */
export function ConceptCard({
  concept: c,
  mastery,
  attempts,
  onOpen,
}: {
  concept: ConceptLesson
  mastery?: number
  attempts?: number
  /** When set, shows an "open lesson" button that routes to the focused concept view. */
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const kindClass = KIND_BADGE[c.kind] || "bg-muted text-muted-foreground"
  const elsewhere = (c.appearsIn || []).filter((p) => p.sectionKey !== c.sectionKey)
  const pageLabel = c.pageStart
    ? c.pageEnd && c.pageEnd !== c.pageStart
      ? `pp. ${c.pageStart}–${c.pageEnd}`
      : `p. ${c.pageStart}`
    : null

  return (
    <li className={cn("rounded-lg border border-l-2 bg-card p-3", KIND_BORDER[c.kind] || "border-l-border")}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex flex-1 flex-wrap items-center gap-2">
            {mastery !== undefined && <ConceptMasteryDot mastery={mastery} attempts={attempts} />}
            <span className="font-medium">{c.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${kindClass}`}>
              {c.kind}
            </span>
            {elsewhere.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                also in {elsewhere.map((p) => "§" + prettyScope(p.sectionKey)).join(", ")}
              </span>
            )}
            {pageLabel && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {pageLabel}
              </span>
            )}
          </span>
        </button>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            aria-label="Open concept lesson"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>
        )}
      </div>

      <ConceptMarkdown content={c.signal} className="mt-1 pl-6 text-sm text-muted-foreground" />

      {open && (
        <div className="mt-3 space-y-3 pl-6">
          {c.source && (
            <div className="border-l-2 border-muted pl-3 text-xs italic text-muted-foreground">
              <ConceptMarkdown content={c.source} />
            </div>
          )}
          {(c.questions || []).length > 0 && (
            <ul className="space-y-1.5">
              {c.questions!.map((q, qi) => (
                <li key={qi} className="text-xs">
                  <span className="font-medium">Q: {q.q}</span>
                  <br />
                  <span className="text-muted-foreground">A: {q.a}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
