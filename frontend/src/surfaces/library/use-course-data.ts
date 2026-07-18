"use client"

/** The shared plumbing every course-scoped route needs: the live course (derived from
 *  the documents context so processing→ready updates flow through), its syllabus tree,
 *  mastery, due count, and reading position. This replaces the old LearnTab state
 *  machine — each route page mounts it with the courseId from the URL. */

import { useCallback, useEffect, useMemo, useState } from "react"
import { fetchTocTree, findNodeBySectionKey, type LearnTreeNode } from "@/gateways/api/outline"
import { fetchMastery, type MasteryResponse } from "@/gateways/api/progress"
import { fetchStudyDebt } from "@/gateways/api/progress"
import {
  fetchReadingProgress,
  saveReadingPosition,
  type ReadingProgress,
} from "@/surfaces/reading"
import { courseFromDocument, isCourseReady, type Course } from "@/surfaces/library/courses"
import { useDocuments } from "@/surfaces/processing"

export function useCourseData(courseId: string) {
  const { documents, isInitialized } = useDocuments()

  const course = useMemo<Course | null>(() => {
    const doc = documents.find((d) => d.id === courseId)
    return doc ? courseFromDocument(doc) : null
  }, [documents, courseId])

  const isLive = course ? isCourseReady(course) : false
  // Syllabus, mastery, and reviews are all keyed by learnDocId.
  const docKey = course ? (course.learnDocId ?? course.id) : undefined

  const [tree, setTree] = useState<LearnTreeNode[]>([])
  const [sectionCount, setSectionCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mastery, setMastery] = useState<MasteryResponse | null>(null)
  const [reviewDue, setReviewDue] = useState(0)
  const [readingProgress, setReadingProgress] = useState<ReadingProgress>({})

  const loadTree = useCallback(async (doc: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTocTree(doc)
      if (data.error) {
        setError(data.error)
        setTree([])
        setSectionCount(0)
      } else {
        setTree(data.tree)
        setSectionCount(data.sectionCount)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load syllabus")
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMastery = useCallback(async (doc: string) => {
    try {
      const data = await fetchMastery(doc)
      if (!data.error) setMastery(data)
    } catch {
      // mastery is supplementary — a failure here must not break the page
    }
  }, [])

  const loadDue = useCallback(async (doc: string) => {
    try {
      const debt = await fetchStudyDebt()
      setReviewDue(debt.courses?.find((c) => c.doc === doc)?.dueNow ?? 0)
    } catch {
      setReviewDue(0)
    }
  }, [])

  // One load path: fires on mount and again when the course flips processing→ready.
  useEffect(() => {
    if (isLive && docKey) {
      loadTree(docKey)
      loadMastery(docKey)
      loadDue(docKey)
    }
  }, [isLive, docKey, loadTree, loadMastery, loadDue])

  useEffect(() => {
    fetchReadingProgress().then(setReadingProgress)
  }, [])

  const persistReadingPosition = useCallback(
    (sectionKey: string) => {
      setReadingProgress((prev) => ({ ...prev, [courseId]: sectionKey }))
      saveReadingPosition(courseId, sectionKey)
    },
    [courseId],
  )

  /** Re-pull mastery + due after study activity (review graded, walk finished, …). */
  const refresh = useCallback(() => {
    if (!docKey) return
    loadMastery(docKey)
    loadDue(docKey)
  }, [docKey, loadMastery, loadDue])

  /** Full reload after a transient backend failure. */
  const retry = useCallback(() => {
    if (!docKey) return
    loadTree(docKey)
    loadMastery(docKey)
    loadDue(docKey)
  }, [docKey, loadTree, loadMastery, loadDue])

  const continueSectionKey = readingProgress[courseId]
  const continueNode = continueSectionKey ? findNodeBySectionKey(tree, continueSectionKey) : null

  return {
    course,
    isInitialized,
    isLive,
    docKey,
    tree: isLive ? tree : [],
    sectionCount: isLive ? sectionCount : 0,
    loading: isLive ? loading : false,
    error: isLive ? error : null,
    mastery: isLive ? mastery : null,
    reviewDue,
    continueSectionKey,
    continueNode: isLive ? continueNode : null,
    persistReadingPosition,
    refresh,
    retry,
  }
}
