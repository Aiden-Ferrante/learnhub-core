"use client"

/** The shared plumbing every course-scoped route needs: the live course (derived from
 *  the documents context so processing→ready updates flow through), its syllabus tree,
 *  mastery, due count, and reading position. This replaces the old LearnTab state
 *  machine — each route page mounts it with the courseId from the URL. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchTocTree, findNodeBySectionKey, type LearnTreeNode } from "@/gateways/api/outline"
import { fetchMastery, type MasteryResponse } from "@/gateways/api/progress"
import { fetchStudyDebt } from "@/gateways/api/progress"
import {
  fetchReadingProgress,
  saveReadingPosition,
  type ReadingProgress,
} from "@/surfaces/reading"
import { courseFromDocument, isCourseReady, type Course } from "@/surfaces/library/courses"
import { fetchVersions, type CourseVersion } from "@/gateways/api/versions"
import { useDocuments } from "@/surfaces/processing"

export function useCourseData(courseId: string) {
  const { documents, isInitialized } = useDocuments()

  const card = useMemo<Course | null>(() => {
    const doc = documents.find((d) => d.id === courseId)
    return doc ? courseFromDocument(doc) : null
  }, [documents, courseId])

  const isLive = card ? isCourseReady(card) : false
  // The card points at the BOOK; the course you actually study is one version of it.
  const bookKey = card ? (card.learnDocId ?? card.id) : undefined

  const [versions, setVersions] = useState<CourseVersion[]>([])

  const loadVersions = useCallback(async (doc: string) => {
    try {
      const data = await fetchVersions(doc)
      setVersions(data.error ? [] : data.versions)
    } catch {
      // A book with no version list still reads through its own key — see docKey.
      setVersions([])
    }
  }, [])

  useEffect(() => {
    if (isLive && bookKey) loadVersions(bookKey)
  }, [isLive, bookKey, loadVersions])

  // Syllabus, mastery and reviews are keyed by the ACTIVE version — the book's main one.
  // Falling back to bookKey keeps a course readable if the version list fails or hasn't
  // arrived yet, which is also what makes this safe for books ingested before versions.
  const activeVersion = useMemo(
    () => versions.find((v) => v.isMain) ?? null,
    [versions],
  )
  const docKey = activeVersion?.docId ?? bookKey

  // The course handed to every surface carries the ACTIVE VERSION as its learnDocId. That
  // is the whole propagation: the reader, concepts, the heatmap, the audiobook and skeleton
  // practice all read `course.learnDocId`, so overriding it here is what makes them follow a
  // switch — rather than teaching each one about versions and missing some. `bookKey` stays
  // available for the few things that are genuinely about the book, like the version list.
  const live = useMemo<Course | null>(
    () => (card ? { ...card, learnDocId: docKey ?? card.learnDocId } : null),
    [card, docKey],
  )

  // A course, once found, STAYS found for this mount.
  //
  // `card` is derived from the shared documents list, and a transient failure of that
  // fetch (a 401 on a stale session, a blip) empties it — which turned `course` null,
  // dropped every course page to its CourseFallback, and UNMOUNTED whatever you were
  // doing. Losing a revealed card is irritating; losing a timed Match round mid-game
  // makes the game unplayable, which is how this was found. The last good course is kept
  // and re-served, so a blink in the documents list can no longer destroy study state.
  // Navigating to another course remounts the hook, so this cannot serve a stale book.
  const lastGood = useRef<Course | null>(null)
  useEffect(() => {
    if (live) lastGood.current = live
  }, [live])
  const course = live ?? lastGood.current

  const [tree, setTree] = useState<LearnTreeNode[]>([])
  const [sectionCount, setSectionCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mastery, setMastery] = useState<MasteryResponse | null>(null)
  // null means "we could not find out", which is NOT the same as zero — a failed fetch
  // used to render as "Caught up" and quietly talk the user out of their reviews.
  const [reviewDue, setReviewDue] = useState<number | null>(null)
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

  // Both loaders take the doc they were asked about and a liveness check, because these
  // are course-scoped reads that outlive a course switch. Keeping the previous value on
  // failure meant course B could render with course A's coverage numbers; applying a slow
  // response unconditionally meant A's could land on top of B's.
  const loadMastery = useCallback(async (doc: string, isCurrent: () => boolean) => {
    try {
      const data = await fetchMastery(doc)
      if (!isCurrent()) return
      setMastery(data.error ? null : data)
    } catch {
      if (isCurrent()) setMastery(null)
    }
  }, [])

  const loadDue = useCallback(async (doc: string, isCurrent: () => boolean) => {
    try {
      const debt = await fetchStudyDebt()
      if (!isCurrent()) return
      // The endpoint answers for the whole library, so a course simply being absent is a
      // real zero. An error envelope is not — that is "unknown".
      setReviewDue(debt.error ? null : (debt.courses?.find((c) => c.doc === doc)?.dueNow ?? 0))
    } catch {
      if (isCurrent()) setReviewDue(null)
    }
  }, [])

  // The doc these reads were started for, as of right now. Every course-scoped response
  // checks itself against this before it is applied, so a slow answer about the course you
  // just left can never land on the course you are looking at.
  const docKeyRef = useRef(docKey)
  docKeyRef.current = docKey
  const isCurrentDoc = useCallback((doc: string) => () => docKeyRef.current === doc, [])

  // One load path: fires on mount and again when the course flips processing→ready.
  useEffect(() => {
    if (!isLive || !docKey) return
    // Drop the outgoing course's numbers immediately, so nothing stale is ever on screen
    // next to the new course's title while its own reads are in flight.
    setMastery(null)
    setReviewDue(null)
    loadTree(docKey)
    loadMastery(docKey, isCurrentDoc(docKey))
    loadDue(docKey, isCurrentDoc(docKey))
  }, [isLive, docKey, loadTree, loadMastery, loadDue, isCurrentDoc])

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
    loadMastery(docKey, isCurrentDoc(docKey))
    loadDue(docKey, isCurrentDoc(docKey))
  }, [docKey, loadMastery, loadDue, isCurrentDoc])

  /** Full reload after a transient backend failure. */
  const retry = useCallback(() => {
    if (!docKey) return
    loadTree(docKey)
    loadMastery(docKey, isCurrentDoc(docKey))
    loadDue(docKey, isCurrentDoc(docKey))
  }, [docKey, loadTree, loadMastery, loadDue, isCurrentDoc])

  /** Re-read the version set after creating, switching, renaming or deleting one. A
   *  changed main flips docKey, and the load effect above pulls the new course in. */
  const refreshVersions = useCallback(() => {
    if (bookKey) loadVersions(bookKey)
  }, [bookKey, loadVersions])

  const continueSectionKey = readingProgress[courseId]
  const continueNode = continueSectionKey ? findNodeBySectionKey(tree, continueSectionKey) : null

  return {
    course,
    isInitialized,
    isLive,
    docKey,
    bookKey,
    versions,
    activeVersion,
    refreshVersions,
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
