"use client"

import { ConceptMarkdown } from "@/components/learn/concept-markdown"
import { cn } from "@/lib/utils"

/**
 * Source-grounded answer feedback: the concept's definition (the "why") plus the book sentence
 * it was drawn from. Shown after a quiz/check answer so feedback is specific and exemplar-rooted
 * rather than just a correct/incorrect label — the data (signal + source) already rides along on
 * every quiz answer response; this surfaces it.
 */
export function AnswerFeedback({
  signal,
  source,
  className,
}: {
  signal?: string | null
  source?: string | null
  className?: string
}) {
  if (!signal && !source) return null
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-md border-l-2 border-brand/40 bg-muted/20 px-3 py-2 text-xs",
        className,
      )}
    >
      {signal && <ConceptMarkdown content={signal} className="text-foreground/85" />}
      {source && (
        <div className="border-t border-border/40 pt-1.5 italic text-muted-foreground">
          <span className="font-medium not-italic text-muted-foreground">From the text: </span>
          <ConceptMarkdown content={source} className="inline" />
        </div>
      )}
    </div>
  )
}
