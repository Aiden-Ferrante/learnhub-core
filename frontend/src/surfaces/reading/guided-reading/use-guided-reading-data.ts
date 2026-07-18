"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { fetchGuidedReading, type GuidedReadingResponse } from "@/gateways/api/chapter"
import { fetchOutline, type LearnTreeNode, type OutlineEntry } from "@/gateways/api/outline"
import { fetchConceptMastery, type ConceptMastery } from "@/gateways/api/progress"
import { fetchReviewQueue } from "@/gateways/api/review"
import { useCourseChapters } from "@/surfaces/library"
import { guidedChapters } from "./lib"
import { usePolling } from "@/kit/hooks/use-polling"

/** Everything the guided-reading surface FETCHES, in one hook: the document outline, the
 *  canonical chapter list, the chapter payload (with its prepare-poll), and the
 *  mastery/due-count layer. The shell consumes plain values and callbacks — no
 *  fetch, poll, or interval lives outside this hook. */
export function useGuidedReadingData(docId: string, chapterKey: string | null, tree: LearnTreeNode[]) {
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [outlineReady, setOutlineReady] = useState(false)
  const [data, setData] = useState<GuidedReadingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [masteryByKey, setMasteryByKey] = useState<Record<string, ConceptMastery>>({})
  const [dueCount, setDueCount] = useState(0)

  // Chapter list inputs: the outline (numbered chapters where available)…
  useEffect(() => {
    let alive = true
    fetchOutline(docId)
      .then((o) => alive && setOutline(o.outline || []))
      .catch(() => {})
      .finally(() => alive && setOutlineReady(true))
    return () => {
      alive = false
    }
  }, [docId])

  // …and the canonical list (see useCourseChapters); guidedChapters' outline rule
  // only covers the moment before the fetch lands (or a backend error).
  const chapterFallback = useMemo(() => guidedChapters(outline, tree), [outline, tree])
  const chapters = useCourseChapters(docId, chapterFallback)

  // The chapter payload itself.
  const load = useCallback(async () => {
    if (!chapterKey) return
    setLoading(true)
    setError(null)
    try {
      const d = await fetchGuidedReading(docId, chapterKey)
      setData(d)
      setPreparing(Boolean(d.status?.running))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chapter")
    } finally {
      setLoading(false)
    }
  }, [docId, chapterKey])

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  // Poll while a prepare pass runs so explanations stream in as they finish.
  usePolling(async () => {
    if (!chapterKey) return
    try {
      const d = await fetchGuidedReading(docId, chapterKey)
      setData(d)
      if (!d.status?.running) setPreparing(false)
    } catch {
      setPreparing(false)
    }
  }, preparing ? 6000 : null)

  // Mastery layer: per-concept mastery for tint/wash + the chapter's due count.
  const refreshMastery = useCallback(() => {
    fetchConceptMastery(docId)
      .then((r) => {
        setMasteryByKey(r.byConcept || {})
      })
      .catch(() => {})
    if (chapterKey) {
      fetchReviewQueue(docId, chapterKey, 1)
        .then((r) => setDueCount(r.counts?.due ?? 0))
        .catch(() => {})
    }
  }, [docId, chapterKey])

  useEffect(() => {
    refreshMastery()
  }, [refreshMastery])

  return {
    outline,
    outlineReady,
    chapters,
    data,
    loading,
    error,
    preparing,
    load,
    masteryByKey,
    dueCount,
    refreshMastery,
  }
}
