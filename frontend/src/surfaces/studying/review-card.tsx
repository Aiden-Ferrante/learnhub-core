"use client"

import { Button } from "@/kit/ui/button"
import { Sheet } from "@/kit/study"
import { KIND_BADGE, ConceptMarkdown } from "@/surfaces/concepts"
import { SectionFigures } from "@/surfaces/reading"
import type { ReviewCard } from "@/gateways/api/review"

/** One review card's face: the name and its kind, the recall prompt until revealed, then
 *  the answer (a concept's signal + source + one figure, or a branch's true structure).
 *  Presentational: the panel owns reveal and grading. */
export function ReviewCardFace({
  card,
  docId,
  revealed,
  onReveal,
}: {
  card: ReviewCard
  docId?: string
  revealed: boolean
  onReveal: () => void
}) {
  const isSkeleton = card.itemType === "skeleton"
  const isChapter = card.itemType === "chapter"
  const kindClass =
    isSkeleton || isChapter ? "bg-brand/15 text-ink-accent" : KIND_BADGE[card.kind] || "bg-muted text-muted-foreground"

  return (
    <Sheet as="article" className="flex-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{card.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-micro font-medium uppercase ${kindClass}`}>
          {isSkeleton ? "structure" : isChapter ? "resurface" : card.kind}
        </span>
        {card.state === "new" && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">new</span>
        )}
      </div>

      {!revealed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {isSkeleton
              ? "Rebuild this branch from memory — what sits under it, and what does each part say?"
              : isChapter
                ? "You read this chapter a while ago — recall its main threads before they fade."
                : "Recall what this concept means."}
          </p>
          <Button type="button" onClick={onReveal}>
            Reveal <kbd className="ml-2 rounded bg-muted px-1 text-micro text-muted-foreground">space</kbd>
          </Button>
        </div>
      ) : isSkeleton || isChapter ? (
        <ul className="flex-1 space-y-1.5 text-sm">
          {(card.children ?? []).map((c, i) => (
            <li key={i} className="leading-snug">
              <span className="font-medium">{c.heading}</span>
              {c.essence && <span className="text-muted-foreground"> — {c.essence}</span>}
            </li>
          ))}
          {!(card.children ?? []).length && (
            <li className="text-muted-foreground">No structure snapshot for this branch.</li>
          )}
        </ul>
      ) : (
        <div className="flex flex-1 flex-col gap-3 overflow-auto">
          <ConceptMarkdown content={card.signal} className="text-sm" />
          {card.source && (
            <div className="border-l-2 border-muted pl-3 text-xs italic text-muted-foreground">
              <ConceptMarkdown content={card.source} />
            </div>
          )}
          <SectionFigures
            docId={card.docId ?? docId}
            sectionKey={card.sectionKey}
            pageStart={card.pageStart}
            pageEnd={card.pageEnd}
            limit={1}
            className="space-y-2"
          />
        </div>
      )}
    </Sheet>
  )
}
