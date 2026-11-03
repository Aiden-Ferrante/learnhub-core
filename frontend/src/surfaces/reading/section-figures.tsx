"use client"

import { qk, useApi, AsyncView } from "@/kit/data"
import { fetchSectionFigures, figureUrl, type LearnFigure } from "@/gateways/api/content"

/** Prefer figures on the concept's own pages (±1 for figures pushed to the next page);
 *  fall back to the section's figures when pages are unknown or nothing matches. */
function pickFigures(figs: LearnFigure[], pageStart: number | null | undefined, pageEnd: number | null | undefined, limit: number) {
  const inRange =
    pageStart != null
      ? figs.filter((f) => f.page != null && f.page >= pageStart - 1 && f.page <= (pageEnd ?? pageStart) + 1)
      : []
  return (inRange.length ? inRange : figs).slice(0, limit)
}

/**
 * The captioned figures near a concept: fetched from the concept's section, narrowed to the
 * concept's page range when it has one (a section can span many pages; the figure beside the
 * defining passage is the one worth re-seeing). Renders nothing while loading or when there
 * are none, so every study surface can include this without layout cost; a failed load is
 * one "Couldn't load the figures · Retry" line.
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
  const q = useApi(
    qk.sectionFigures(docId ?? "", sectionKey ?? ""),
    (signal) => fetchSectionFigures(docId ?? "", sectionKey ?? "", signal),
    { enabled: Boolean(docId && sectionKey) },
  )

  if (!docId || !sectionKey) return null
  const pick = (d: LearnFigure[]) => pickFigures(d, pageStart, pageEnd, limit)

  return (
    <AsyncView
      q={q}
      skeleton={<></>}
      error="inline"
      errorTitle="Couldn't load the figures"
      isEmpty={(d) => pick(d).length === 0}
      empty={<></>}
    >
      {(d) => <div className={className}>{pick(d).map((f) => (
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
      ))}</div>}
    </AsyncView>
  )
}
