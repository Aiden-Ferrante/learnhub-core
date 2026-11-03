"use client"

/** The shared plumbing every course-scoped route needs: the live course (derived from
 *  the documents context so processing→ready updates flow through), its syllabus tree,
 *  mastery, due count, and reading position. Every read goes through the query cache, so
 *  sub-routes reuse what the course home already loaded and a version switch can never
 *  land a stale response (the key changes; the old request is aborted). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchTocTree, findNodeBySectionKey } from "@/gateways/api/outline"
import { fetchMastery } from "@/gateways/api/progress"
import { fetchVersions } from "@/gateways/api/versions"
import { saveReadingPositionStrict } from "@/gateways/api/user-settings"
import { qk, roots, useApi, useApiMutation, useInvalidate, orThrow } from "@/kit/data"
import { courseFromDocument, isCourseReady, type Course } from "@/surfaces/library/courses"
import { useReadingPositions, useStudyDebt } from "@/surfaces/library/use-library-queries"
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

  const versionsQuery = useApi(
    qk.versions(bookKey ?? ""),
    (signal) => fetchVersions(bookKey as string, signal).then(orThrow),
    { enabled: isLive && !!bookKey },
  )
  const versions = useMemo(() => versionsQuery.data?.versions ?? [], [versionsQuery.data])

  // Syllabus, mastery and reviews are keyed by the ACTIVE version, the book's main one.
  // Falling back to bookKey keeps a course readable when the version list fails, which is
  // also what makes this safe for books ingested before versions. Course reads wait for
  // the list to settle so they don't load the book key first and the version second.
  const activeVersion = useMemo(() => versions.find((v) => v.isMain) ?? null, [versions])
  const docKey = activeVersion?.docId ?? bookKey
  const versionsSettled = versionsQuery.status !== "loading"

  // The course handed to every surface carries the ACTIVE VERSION as its learnDocId: the
  // reader, concepts, the heatmap, the audiobook and skeleton practice all read
  // `course.learnDocId`, so overriding it here is what makes them follow a switch.
  const live = useMemo<Course | null>(
    () => (card ? { ...card, learnDocId: docKey ?? card.learnDocId } : null),
    [card, docKey],
  )

  // A course, once found, STAYS found for this mount. A transient failure of the documents
  // list empties it, which used to drop every course page to its fallback and unmount
  // whatever you were doing. Navigating to another course remounts the hook.
  const lastGood = useRef<Course | null>(null)
  useEffect(() => {
    if (live) lastGood.current = live
  }, [live])
  const course = live ?? lastGood.current

  const enabled = isLive && !!docKey && versionsSettled
  const treeQuery = useApi(qk.tocTree(docKey), (signal) => fetchTocTree(docKey, signal).then(orThrow), { enabled })
  const masteryQuery = useApi(qk.mastery(docKey), (signal) => fetchMastery(docKey, signal).then(orThrow), { enabled })
  const debtQuery = useStudyDebt()
  const positionsQuery = useReadingPositions()

  // null means "we could not find out", which is NOT zero: a failed read once rendered as
  // "Caught up" and quietly talked the user out of their reviews. The endpoint answers for
  // the whole library, so a course simply being absent from it is a real zero.
  const reviewDue = debtQuery.data
    ? (debtQuery.data.courses.find((c) => c.doc === docKey)?.dueNow ?? 0)
    : null

  // Positions written in this mount win over the cached map until it refetches.
  const [localPositions, setLocalPositions] = useState<Record<string, string>>({})
  const savePosition = useApiMutation(
    (v: { courseId: string; sectionKey: string }) => saveReadingPositionStrict(v.courseId, v.sectionKey),
    { serialKey: "reading-position", invalidates: [roots.readingProgress] },
  )
  const { fire: firePosition } = savePosition
  const persistReadingPosition = useCallback(
    (sectionKey: string) => {
      setLocalPositions((prev) => ({ ...prev, [courseId]: sectionKey }))
      firePosition({ courseId, sectionKey })
    },
    [courseId, firePosition],
  )

  const invalidate = useInvalidate()
  /** Re-pull mastery + due after study activity (review graded, walk finished, …). */
  const refresh = useCallback(() => {
    void invalidate(roots.mastery, roots.studyDebt)
  }, [invalidate])

  const { retry: retryTree } = treeQuery
  const { retry: retryMastery } = masteryQuery
  const { retry: retryDebt } = debtQuery
  /** Full reload after a transient backend failure. */
  const retry = useCallback(() => {
    retryTree()
    retryMastery()
    retryDebt()
  }, [retryTree, retryMastery, retryDebt])

  /** Re-read the version set after creating, switching, renaming or deleting one. A
   *  changed main flips docKey, and the keyed reads above pull the new course in. */
  const refreshVersions = useCallback(() => {
    void invalidate(roots.versions)
  }, [invalidate])

  const tree = useMemo(() => (isLive ? (treeQuery.data?.tree ?? []) : []), [isLive, treeQuery.data])
  const continueSectionKey: string | undefined = localPositions[courseId] ?? positionsQuery.data?.[courseId]
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
    tree,
    sectionCount: isLive ? (treeQuery.data?.sectionCount ?? 0) : 0,
    loading: isLive ? treeQuery.status === "loading" : false,
    error: isLive && treeQuery.data === undefined && treeQuery.error ? treeQuery.error.message : null,
    mastery: isLive ? (masteryQuery.data ?? null) : null,
    reviewDue,
    continueSectionKey,
    continueNode: isLive ? continueNode : null,
    persistReadingPosition,
    /** A failed position save (the reading position is a side effect of opening a
     *  chapter, so it is reported here rather than blocking the navigation). */
    positionError: savePosition.error,
    refresh,
    retry,
    queries: { tree: treeQuery, mastery: masteryQuery, debt: debtQuery, versions: versionsQuery },
  }
}

export type CourseData = ReturnType<typeof useCourseData>
