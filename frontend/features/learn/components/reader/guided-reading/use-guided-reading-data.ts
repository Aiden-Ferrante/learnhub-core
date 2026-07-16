"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchGuidedReading, type GuidedReadingResponse } from "@/features/learn/api/chapter"
import { fetchOutline, type LearnTreeNode, type OutlineEntry } from "@/features/learn/api/outline"
import {
  cancelChapterBuild,
  enqueueChapterBuild,
  fetchChaptersReadiness,
  type ChapterReadiness,
} from "@/features/learn/api/pipeline"
import { fetchConceptMastery, type ConceptMastery } from "@/features/learn/api/progress"
import { fetchReviewQueue } from "@/features/learn/api/review"
import { useCourseChapters } from "@/features/learn/hooks/use-course-chapters"
import { guidedChapters } from "./lib"
import { usePolling } from "@/hooks/use-polling"

/** Everything the guided-reading surface FETCHES, in one hook: the document outline, the
 *  canonical chapter list, the chapter payload (with its prepare-poll), the per-chapter
 *  readiness ladder (with its build-poll + build-completion reload), build enqueue/cancel,
 *  and the mastery/due-count layer. The shell consumes plain values and callbacks — no
 *  fetch, poll, or interval lives outside this hook. */
export function useGuidedReadingData(docId: string, chapterKey: string | null, tree: LearnTreeNode[]) {
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [outlineReady, setOutlineReady] = useState(false)
  const [data, setData] = useState<GuidedReadingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [readiness, setReadiness] = useState<Record<string, ChapterReadiness>>({})
  const [masteryByKey, setMasteryByKey] = useState<Record<string, ConceptMastery>>({})
  const [masteredThreshold, setMasteredThreshold] = useState(0.75)
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

  // Per-chapter readiness ladder (raw → partial → deep) + any build jobs.
  const loadReadiness = useCallback(async () => {
    if (chapters.length === 0) return
    try {
      const r = await fetchChaptersReadiness(docId, chapters.map((c) => c.key))
      setReadiness(r.chapters || {})
    } catch {
      // readiness is supplementary — never break the reader
    }
  }, [docId, chapters])

  useEffect(() => {
    loadReadiness()
  }, [loadReadiness])

  const currentBuild = chapterKey ? readiness[chapterKey]?.build ?? null : null
  const building = currentBuild?.status === "running"
  const queuedBuild = currentBuild?.status === "queued"
  const anyBuildActive = useMemo(
    () =>
      Object.values(readiness).some(
        (r) => r.build && (r.build.status === "queued" || r.build.status === "running"),
      ),
    [readiness],
  )

  // Keep the ladder live while anything is queued/building, and reload the open
  // chapter the moment its own build lands.
  usePolling(loadReadiness, anyBuildActive ? 10000 : null)

  const prevBuildStatus = useRef<string | null>(null)
  useEffect(() => {
    const s = currentBuild?.status ?? null
    if (prevBuildStatus.current === "running" && s !== "running") load()
    prevBuildStatus.current = s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBuild?.status])

  // Poll while a prepare/build pass runs so explanations stream in as they finish.
  usePolling(async () => {
    if (!chapterKey) return
    try {
      const d = await fetchGuidedReading(docId, chapterKey)
      setData(d)
      if (!d.status?.running) setPreparing(false)
    } catch {
      setPreparing(false)
    }
  }, preparing || building ? 6000 : null)

  const startBuild = async (at?: number | null) => {
    if (!chapterKey) return
    try {
      await enqueueChapterBuild(docId, chapterKey, at)
    } catch {
      // surfaced via readiness on the next poll
    }
    loadReadiness()
  }

  const cancelBuildJob = async () => {
    if (!chapterKey) return
    try {
      await cancelChapterBuild(docId, chapterKey)
    } catch {
      // ignore
    }
    loadReadiness()
  }

  // Mastery layer: per-concept mastery for tint/wash + the chapter's due count.
  const refreshMastery = useCallback(() => {
    fetchConceptMastery(docId)
      .then((r) => {
        setMasteryByKey(r.byConcept || {})
        if (r.masteredThreshold) setMasteredThreshold(r.masteredThreshold)
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
    readiness,
    currentBuild,
    building,
    queuedBuild,
    startBuild,
    cancelBuildJob,
    masteryByKey,
    masteredThreshold,
    dueCount,
    refreshMastery,
  }
}
