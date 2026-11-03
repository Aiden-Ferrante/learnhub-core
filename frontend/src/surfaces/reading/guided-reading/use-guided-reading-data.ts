"use client"

import { useCallback, useMemo } from "react"
import { qk, roots, useApi, useInvalidate } from "@/kit/data"
import { fetchGuidedReading } from "@/gateways/api/chapter"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { fetchConceptMastery, type ConceptMastery } from "@/gateways/api/progress"
import { fetchReviewQueue } from "@/gateways/api/review"
import { outlineEntries, useChapterList, useOutline } from "@/surfaces/reading/use-reading-data"
import { guidedChapters } from "./lib"

const NO_MASTERY: Record<string, ConceptMastery> = {}

/** Everything the guided-reading surface FETCHES, in one hook: the document outline, the
 *  canonical chapter list, the chapter payload (polled while a prepare pass runs), and the
 *  mastery/due-count layer. Every read is a keyed query, so a chapter switch drops the old
 *  chapter's request and its response can never land on the new chapter. */
export function useGuidedReadingData(docId: string, chapterKey: string | null, tree: LearnTreeNode[]) {
  const outlineQ = useOutline(docId)
  const outline = outlineEntries(outlineQ)
  // A failed outline still lets the reader resolve a chapter (from the tree / chapter list).
  const outlineReady = outlineQ.status !== "loading"

  // The canonical list; guidedChapters' outline rule only covers the moment before the
  // fetch lands (or a backend error).
  const chapterFallback = useMemo(() => guidedChapters(outline, tree), [outline, tree])
  const { chapters, query: chaptersQ } = useChapterList(docId, chapterFallback)

  // The chapter payload. Polls every 6 s while a prepare pass runs, so explanations stream
  // in as they finish; the poll stops by itself once `status.running` goes false.
  const chapter = useApi(
    qk.guidedReading(docId, chapterKey ?? ""),
    (signal) => fetchGuidedReading(docId, chapterKey ?? "", signal),
    { enabled: Boolean(chapterKey), poll: (d) => (d?.status?.running ? 6000 : false) },
  )

  // Mastery layer: per-concept mastery for tint/wash + this chapter's due count.
  const masteryQ = useApi(qk.conceptMastery(docId), (signal) => fetchConceptMastery(docId, signal))
  const dueQ = useApi(
    qk.reviewQueue(docId, chapterKey ?? "", 1),
    (signal) => fetchReviewQueue(docId, chapterKey ?? "", 1, signal),
    { enabled: Boolean(chapterKey) },
  )

  // The study drawers report answers through this; the grades' own mutations may already
  // invalidate these roots, and a second invalidation is a cheap no-op refetch.
  const invalidate = useInvalidate()
  const refreshMastery = useCallback(() => {
    void invalidate(roots.conceptMastery, roots.reviewQueue)
  }, [invalidate])

  return {
    outline,
    outlineReady,
    outlineQ,
    chapters,
    chaptersQ,
    chapter,
    preparing: Boolean(chapter.data?.status?.running),
    masteryByKey: masteryQ.data?.byConcept ?? NO_MASTERY,
    masteryQ,
    dueCount: dueQ.data?.counts?.due ?? 0,
    refreshMastery,
  }
}
