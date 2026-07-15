"use client"

import { useEffect, useState } from "react"
import { fetchSectionFigures, figureUrl, type LearnFigure } from "@/features/learn/api"

/**
 * The captioned figures near a concept: fetched from the concept's section, narrowed to the
 * concept's page range when it has one (a section can span many pages; the figure beside the
 * defining passage is the one worth re-seeing). Renders nothing when there are none — every
 * study surface can include this without layout cost.
 */
export function SectionFigures({
  docId,
  sectionKey,
  pageStart,
  pageEnd,
  limit = 2,
  className,
}: {
  docId?: string | null
  sectionKey?: string | null
  pageStart?: number | null
  pageEnd?: number | null
  limit?: number
  className?: string
}) {
  const [figures, setFigures] = useState<LearnFigure[]>([])

  useEffect(() => {
    if (!docId || !sectionKey) {
      setFigures([])
      return
    }
    let active = true
    fetchSectionFigures(docId, sectionKey)
      .then((figs) => {
        if (!active) return
        // Prefer figures on the concept's own pages (±1 for figures pushed to the next page);
        // fall back to the section's figures when pages are unknown or nothing matches.
        const inRange =
          pageStart != null
            ? figs.filter(
                (f) => f.page != null && f.page >= pageStart - 1 && f.page <= (pageEnd ?? pageStart) + 1,
              )
            : []
        setFigures((inRange.length ? inRange : figs).slice(0, limit))
      })
      .catch(() => {
        if (active) setFigures([])
      })
    return () => {
      active = false
    }
  }, [docId, sectionKey, pageStart, pageEnd, limit])

  if (!docId || !figures.length) return null

  return (
    <div className={className}>
      {figures.map((f) => (
        <figure key={f.order} className="overflow-hidden rounded-lg border bg-background/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={figureUrl(docId, f.order)}
            alt={f.caption ?? ""}
            loading="lazy"
            className="max-h-56 w-full bg-white object-contain"
          />
          <figcaption className="border-t px-2.5 py-1.5 text-xs italic text-muted-foreground">
            {f.caption}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
