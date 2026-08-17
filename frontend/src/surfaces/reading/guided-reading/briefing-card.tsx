"use client"

import { useState, type RefObject } from "react"
import { BookOpen, Check, ChevronDown } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { MathText } from "@/surfaces/reading/markdown-reader"
import type { GuidedReadingBriefing } from "@/gateways/api/chapter"
import { KIND_CHIP } from "@/surfaces/concepts"
import { cn } from "@/kit/lib/utils"

/** The chapter briefing — what this chapter teaches, assembled from the pre-generated layer.
 *  Folds to one line once oriented (the prose is the point). Concept chips carry
 *  data-concept indices so the shell's delegated click handler opens the popover.
 *  Mount with key={chapterKey} — the chip-cloud expansion resets per chapter. */
export function BriefingCard({
  briefing,
  oriented,
  onOrient,
  conceptIndexByName,
  cardCls,
  mutedCls,
  containerRef,
}: {
  briefing: GuidedReadingBriefing
  oriented: boolean
  onOrient: () => void
  conceptIndexByName: Map<string, number>
  cardCls: string
  mutedCls: string
  /** The shell scrolls here when the path rail's orient stage is clicked. */
  containerRef: RefObject<HTMLDivElement | null>
}) {
  // Briefing concept-chip cloud: capped at 8 until expanded.
  const [allChips, setAllChips] = useState(false)

  return (
    <div ref={containerRef} className={cn("mb-6 rounded-lg border p-4", cardCls)}>
      {/* Once oriented, the briefing folds to one line — the prose is the point. */}
      <details open={!oriented}>
        <summary className="flex cursor-pointer list-none items-center gap-2">
          <BookOpen className={cn("h-4 w-4", mutedCls)} />
          <span className="text-sm font-semibold">Chapter briefing</span>
          {oriented ? (
            <span className="flex items-center gap-1 text-xs text-status-mastered">
              <Check className="h-3 w-3" /> oriented
            </span>
          ) : (
            <span className={cn("text-xs", mutedCls)}>what this chapter teaches</span>
          )}
          <ChevronDown className={cn("ml-auto h-3.5 w-3.5", mutedCls)} />
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {briefing.objectives.length > 0 && (
            <div>
              <div className={cn("mb-1.5 text-xs font-semibold uppercase tracking-label", mutedCls)}>
                You&apos;ll be able to
              </div>
              <ul className="space-y-1 text-sm opacity-90">
                {briefing.objectives.map((o, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-brand">•</span>
                    <MathText text={o} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {briefing.watchFor.length > 0 && (
            <div>
              <div className={cn("mb-1.5 text-xs font-semibold uppercase tracking-label", mutedCls)}>
                Watch for
              </div>
              <ul className="space-y-1 text-sm opacity-90">
                {briefing.watchFor.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-status-due">•</span>
                    <MathText text={w} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {briefing.sections.length > 0 && (
          <details className="mt-4 border-t pt-3 lg:hidden" open={briefing.sections.length <= 8}>
            <summary className={cn("cursor-pointer text-xs font-semibold uppercase tracking-label", mutedCls)}>
              The road through · {briefing.sections.length} sections
            </summary>
            <div className="mt-1.5 space-y-1">
              {briefing.sections.map((s, i) => (
                <div key={`${s.sectionKey}-${i}`} className="text-sm" style={{ paddingLeft: `${(s.depth ?? 0) * 12}px` }}>
                  <span className="opacity-90">{s.heading}</span>
                  {s.essence && <span className={mutedCls}> — {s.essence}</span>}
                </div>
              ))}
            </div>
          </details>
        )}
        {!oriented && (
          <div className="mt-4 border-t pt-3">
            <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={onOrient}>
              <Check className="h-3.5 w-3.5" />
              I&apos;m oriented — start reading
            </Button>
          </div>
        )}
        {briefing.keyConcepts.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t pt-3">
            {(allChips ? briefing.keyConcepts : briefing.keyConcepts.slice(0, 8)).map((c, i) => {
              const idx = conceptIndexByName.get(c.name.trim().toLowerCase())
              return (
                <button
                  key={`${c.name}-${i}`}
                  type="button"
                  data-concept={idx}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs",
                    KIND_CHIP[c.kind] ?? "border-border text-muted-foreground",
                  )}
                  title={c.signal}
                >
                  {c.name}
                </button>
              )
            })}
            {!allChips && briefing.keyConcepts.length > 8 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setAllChips(true)
                }}
                className={cn("rounded-full border border-dashed px-2 py-0.5 text-xs", mutedCls, "hover:text-brand")}
              >
                +{briefing.keyConcepts.length - 8} more
              </button>
            )}
          </div>
        )}
      </details>
    </div>
  )
}
