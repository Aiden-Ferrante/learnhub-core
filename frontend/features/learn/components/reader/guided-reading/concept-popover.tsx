"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { MathText } from "@/features/learn/components/reader/markdown-reader"
import { ConceptMasteryDot } from "@/features/learn/components/concepts/concept-mastery-dot"
import type { ConceptLesson } from "@/features/learn/api/concepts"
import type { ConceptMastery } from "@/features/learn/api/progress"
import { KIND_COLOR } from "./lib"
import { cn } from "@/lib/utils"

function CheckReveal({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
      <div className="font-medium text-foreground/90">
        Check yourself: <MathText text={q} className="inline-block" />
      </div>
      {open ? (
        <MathText text={a} className="mt-1 text-muted-foreground" />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 text-brand hover:underline"
        >
          Reveal answer
        </button>
      )}
    </div>
  )
}

/** The inline concept popover — anchored to the clicked term (or margin note), showing the
 *  concept's signal, mastery dot, and its first check-yourself question. */
export function ConceptPopover({
  concept,
  mastery,
  x,
  y,
  onClose,
}: {
  concept: ConceptLesson
  mastery: ConceptMastery | undefined
  x: number
  y: number
  onClose: () => void
}) {
  return (
    <div
      className="fixed z-50 w-[min(26rem,90vw)] rounded-lg border bg-popover p-3 shadow-xl"
      style={{
        left: Math.min(x, window.innerWidth - Math.min(430, window.innerWidth * 0.92)),
        top: Math.min(y, window.innerHeight - 320),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ConceptMasteryDot mastery={mastery?.mastery} attempts={mastery?.attempts} />
          <span className="text-sm font-semibold">{concept.name}</span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px]",
              KIND_COLOR[concept.kind] ?? "border-border text-muted-foreground",
            )}
          >
            {concept.kind}
          </span>
        </div>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
        <MathText text={concept.signal} className="text-foreground/90" />
        {concept.questions?.[0] && (
          <CheckReveal q={concept.questions[0].q} a={concept.questions[0].a} />
        )}
      </div>
    </div>
  )
}
