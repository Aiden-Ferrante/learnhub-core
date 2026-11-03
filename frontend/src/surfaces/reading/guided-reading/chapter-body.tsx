"use client"

import type React from "react"
import type { RefObject } from "react"
import { BookOpen, ChevronRight } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { EmptyState } from "@/kit/patterns/empty-state"
import { AsyncView, ErrorNotice, type ApiQuery } from "@/kit/data"
import type { GuidedReadingResponse } from "@/gateways/api/chapter"
import type { CourseChapter } from "@/gateways/api/toc"
import { cn } from "@/kit/lib/utils"
import { BriefingCard } from "./briefing-card"

function ChapterSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading chapter">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/** One compact "Couldn't load … · Retry" line per side read that failed (the outline, the
 *  mastery layer, the canonical chapter list). Each only degrades the page (heading levels,
 *  tint, the picker), so the chapter keeps rendering under them. */
export function SideReadErrors({ reads }: { reads: { title: string; q: ApiQuery<unknown> }[] }) {
  const failed = reads.filter((r) => r.q.status === "error")
  if (failed.length === 0) return null
  return (
    <div className="mb-4 space-y-1">
      {failed.map((r) => (
        <ErrorNotice key={r.title} compact title={r.title} error={r.q.error} onRetry={r.q.retry} />
      ))}
    </div>
  )
}

/** The reading column: the briefing, the annotated prose, and the hand-off to the next
 *  chapter, rendered through AsyncView (skeleton, error with Retry, empty). Before a
 *  chapter is resolved it shows the skeleton, or `noChapter` once it's known there is none. */
export function ChapterBody({
  chapter,
  chapterKey,
  noChapter,
  reader,
  stagesOriented,
  onOrient,
  conceptIndexByName,
  cardCls,
  mutedCls,
  briefingRef,
  paper,
  chapterIdx,
  chapterCount,
  nextChapter,
  onGoChapter,
}: {
  chapter: ApiQuery<GuidedReadingResponse>
  chapterKey: string | null
  noChapter: React.ReactNode | null
  reader: React.ReactNode
  stagesOriented: boolean
  onOrient: () => void
  conceptIndexByName: Map<string, number>
  cardCls: string
  mutedCls: string
  briefingRef: RefObject<HTMLDivElement | null>
  paper: boolean
  chapterIdx: number
  chapterCount: number
  nextChapter: CourseChapter | null
  onGoChapter: (key: string) => void
}) {
  if (!chapterKey) return <>{noChapter ?? <ChapterSkeleton />}</>
  return (
    <AsyncView q={chapter} skeleton={<ChapterSkeleton />} errorTitle="Couldn't load this chapter">
      {(data) => (
        <>
          {/* Briefing: what this chapter teaches, assembled from the pre-generated layer. */}
          {data.briefing && (
            <BriefingCard
              key={chapterKey}
              briefing={data.briefing}
              oriented={stagesOriented}
              onOrient={onOrient}
              conceptIndexByName={conceptIndexByName}
              cardCls={cardCls}
              mutedCls={mutedCls}
              containerRef={briefingRef}
            />
          )}

          {/* The reader spine. */}
          {reader}
          {!data.markdown && (
            <EmptyState
              icon={<BookOpen />}
              title="Nothing to read here"
              description="This scope has no readable content of its own — it may be a Part divider or front matter."
              action={
                nextChapter ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() => onGoChapter(nextChapter.key)}
                  >
                    Next: {nextChapter.title} <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                ) : undefined
              }
            />
          )}

          {/* End of chapter: the study actions live pinned in the path bar above. */}
          {data.markdown && nextChapter && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onGoChapter(nextChapter.key)}
              className={cn(
                "mt-10 h-auto w-full justify-between gap-3 whitespace-normal px-5 py-3 text-left text-sm font-normal",
                cardCls,
                paper ? "hover:bg-paper-card hover:text-paper-ink" : "hover:bg-muted/40 hover:text-foreground",
              )}
            >
              <span className={cn("shrink-0 text-xs", mutedCls)}>
                Up next · Chapter {chapterIdx + 2} of {chapterCount}
              </span>
              <span className="flex min-w-0 items-center gap-1 font-medium">
                <span className="truncate">{nextChapter.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0" />
              </span>
            </Button>
          )}
        </>
      )}
    </AsyncView>
  )
}
