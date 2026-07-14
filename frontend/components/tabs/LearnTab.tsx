"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CourseShelf } from "@/components/learn/course-shelf"
import { CourseHome } from "@/components/learn/course-home"
import { ConceptsView } from "@/components/learn/concepts-view"
import { DrillView } from "@/components/learn/drill-view"
import { DumpView } from "@/components/learn/dump-view"
import { PdfBookView } from "@/components/learn/pdf-book-view"
import { DeepChapter } from "@/components/learn/deep-chapter"
import { AskPanel } from "@/components/learn/ask-panel"
import {
  fetchMastery,
  fetchReviewQueue,
  fetchTocTree,
  findNodeBySectionKey,
  type LearnTreeNode,
  type MasteryResponse,
  type WeakestSection,
} from "@/lib/learn-service"
import {
  fetchReadingProgress,
  saveReadingPosition,
  type ReadingProgress,
} from "@/lib/reading-progress"
import { courseFromDocument, isCourseReady, type Course } from "@/lib/courses"
import { useDocuments } from "@/contexts/document-context"

type LearnTabProps = {
  onTabChange?: (tab: string) => void
}

type View = "shelf" | "home" | "read" | "deep" | "concepts" | "drill" | "dump" | "ask"

/** What the deep surface should open with (e.g. "Review all" lands in the review drawer). */
type DeepIntent = {
  drawer?: "quiz" | "review" | "exam" | "walk" | "lockin" | "tutor" | "listen"
  wholeCourseReview?: boolean
} | null

export function LearnTab({ onTabChange }: LearnTabProps) {
  const { documents } = useDocuments()
  const [tree, setTree] = useState<LearnTreeNode[]>([])
  const [edgeCount, setEdgeCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mastery, setMastery] = useState<MasteryResponse | null>(null)

  const [view, setView] = useState<View>("shelf")
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [selectedScope, setSelectedScope] = useState<string | null>(null)
  const [deepIntent, setDeepIntent] = useState<DeepIntent>(null)
  const [readingProgress, setReadingProgress] = useState<ReadingProgress>({})
  const [reviewDue, setReviewDue] = useState(0)

  // Live course: derived from documents so the shelf and open course pick up
  // status changes (processing → ready) without leaving the Learn tab.
  const selectedCourse = useMemo<Course | null>(() => {
    if (!selectedCourseId) return null
    const doc = documents.find((d) => d.id === selectedCourseId)
    return doc ? courseFromDocument(doc) : null
  }, [documents, selectedCourseId])

  const loadDue = useCallback(async (doc?: string) => {
    try {
      const data = await fetchReviewQueue(doc, null, 1)
      setReviewDue(data.counts?.due ?? 0)
    } catch {
      setReviewDue(0)
    }
  }, [])

  const loadMastery = useCallback(async (doc?: string) => {
    try {
      const data = await fetchMastery(doc)
      if (!data.error) setMastery(data)
    } catch {
      // mastery is supplementary — a failure here must not break the hub
    }
  }, [])

  const loadTree = useCallback(async (doc?: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTocTree(doc)
      if (data.error) {
        setError(data.error)
        setTree([])
        setEdgeCount(0)
      } else {
        setTree(data.tree)
        setEdgeCount(data.edgeCount)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load syllabus")
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTree()
    loadMastery()
    fetchReadingProgress().then(setReadingProgress)
  }, [loadTree, loadMastery])

  // Reload course data when the open course finishes processing.
  const wasReadyRef = useRef(false)
  useEffect(() => {
    const ready = selectedCourse ? isCourseReady(selectedCourse) : false
    if (ready && !wasReadyRef.current && selectedCourse && view !== "shelf") {
      // Syllabus + concept mastery are both keyed by learnDocId.
      loadTree(selectedCourse.learnDocId ?? selectedCourse.id)
      loadMastery(selectedCourse.learnDocId ?? selectedCourse.id)
      loadDue(selectedCourse.learnDocId ?? selectedCourse.id)
    }
    wasReadyRef.current = ready
  }, [selectedCourse, view, loadTree, loadMastery, loadDue])

  const persistReadingPosition = useCallback(
    (sectionKey: string) => {
      if (!selectedCourseId) return
      setReadingProgress((prev) => ({ ...prev, [selectedCourseId]: sectionKey }))
      saveReadingPosition(selectedCourseId, sectionKey)
    },
    [selectedCourseId],
  )

  const openCourse = (course: Course) => {
    setSelectedCourseId(course.id)
    setSelectedScope(null)
    setDeepIntent(null)
    setView("home")
    // Prime the readiness tracker so the live-refresh effect doesn't double-load.
    wasReadyRef.current = isCourseReady(course)
    if (isCourseReady(course)) {
      loadTree(course.learnDocId ?? course.id)
      loadMastery(course.learnDocId ?? course.id)
      loadDue(course.learnDocId ?? course.id)
    }
  }

  const backToShelf = useCallback(() => {
    setView("shelf")
    setSelectedCourseId(null)
    loadTree()
    loadMastery()
  }, [loadTree, loadMastery])

  // The header brand broadcasts this when clicked while the Learn tab is already
  // active (no hashchange fires) — reset to the course shelf.
  useEffect(() => {
    window.addEventListener("learnhub:home", backToShelf)
    return () => window.removeEventListener("learnhub:home", backToShelf)
  }, [backToShelf])

  const continueSectionKey = selectedCourseId
    ? readingProgress[selectedCourseId]
    : undefined
  const continueNode = continueSectionKey
    ? findNodeBySectionKey(tree, continueSectionKey)
    : null

  // EVERY study entrance lands on the deep surface now — the lesson mode-flow is
  // retired; the path lives as a rail (and drawers) on the reader itself.
  const openDeep = (scope: string | null, intent: DeepIntent = null) => {
    setSelectedScope(scope)
    setDeepIntent(intent)
    setView("deep")
    if (scope) persistReadingPosition(scope)
  }

  const openSection = (scope: string | null, node: LearnTreeNode | null) => {
    void node
    openDeep(scope)
  }

  // Whole-course review: the deep surface opens with the review drawer over the full queue.
  const reviewAll = () => openDeep(continueSectionKey ?? null, { drawer: "review", wholeCourseReview: true })

  const handleReview = (section: WeakestSection) =>
    openDeep(section.sectionKey, { drawer: "review" })

  const openDeepRead = () => openDeep(continueSectionKey ?? null)

  const backToCourseHome = () => {
    setView("home")
    setDeepIntent(null)
    setConceptFocusKey(null)
    loadMastery(selectedCourse ? (selectedCourse.learnDocId ?? selectedCourse.id) : undefined)
    loadDue(selectedCourse ? (selectedCourse.learnDocId ?? selectedCourse.id) : undefined)
  }

  // A concept clicked as a leaf in the course outline — open its detail in ConceptsView.
  const [conceptFocusKey, setConceptFocusKey] = useState<string | null>(null)
  const openConceptDetail = (conceptKey: string) => {
    setConceptFocusKey(conceptKey)
    setView("concepts")
  }

  // Re-run the course loads after a transient backend failure (e.g. ArangoDB still booting).
  const retryCourseLoad = useCallback(() => {
    if (!selectedCourse) return
    const d = selectedCourse.learnDocId ?? selectedCourse.id
    loadTree(d)
    loadMastery(d)
    loadDue(d)
  }, [selectedCourse, loadTree, loadMastery, loadDue])

  const isLive = selectedCourse ? isCourseReady(selectedCourse) : false

  if (view === "read" && selectedCourse) {
    return (
      <PdfBookView
        course={selectedCourse}
        tree={isLive ? tree : []}
        loading={isLive ? loading : false}
        mastery={isLive ? mastery : null}
        onBack={backToCourseHome}
        onSectionRead={persistReadingPosition}
      />
    )
  }

  if (view === "deep" && selectedCourse) {
    return (
      <DeepChapter
        course={selectedCourse}
        scope={selectedScope}
        tree={isLive ? tree : []}
        onBack={backToCourseHome}
        onScopeChange={(sectionKey) => {
          setSelectedScope(sectionKey)
          persistReadingPosition(sectionKey)
        }}
        initialDrawer={deepIntent?.drawer}
        reviewWholeCourse={deepIntent?.wholeCourseReview}
      />
    )
  }

  if (view === "concepts" && selectedCourse) {
    return (
      <ConceptsView
        course={selectedCourse}
        onBack={backToCourseHome}
        initialConceptKey={conceptFocusKey}
      />
    )
  }

  if (view === "drill" && selectedCourse) {
    return (
      <DrillView
        scope={null}
        docId={selectedCourse.learnDocId ?? selectedCourse.id}
        onBack={backToCourseHome}
        onDone={() => {
          const d = selectedCourse.learnDocId ?? selectedCourse.id
          loadMastery(d)
          loadDue(d)
        }}
      />
    )
  }

  if (view === "dump" && selectedCourse) {
    return (
      <DumpView
        chapters={isLive ? tree : []}
        docId={selectedCourse.learnDocId ?? selectedCourse.id}
        onBack={backToCourseHome}
        onDone={() => loadMastery(selectedCourse.learnDocId ?? selectedCourse.id)}
      />
    )
  }

  if (view === "ask" && selectedCourse) {
    return (
      <AskPanel
        course={selectedCourse}
        onBack={backToCourseHome}
        onOpenSection={(scope) => openDeep(scope)}
      />
    )
  }

  if (view === "home" && selectedCourse) {
    return (
      <CourseHome
        course={selectedCourse}
        tree={isLive ? tree : []}
        edgeCount={isLive ? edgeCount : 0}
        loading={isLive ? loading : false}
        error={isLive ? error : null}
        mastery={isLive ? mastery : null}
        onOpenSection={openSection}
        onReview={handleReview}
        onReadBook={() => setView("read")}
        onDeepRead={openDeepRead}
        onViewConcepts={() => setView("concepts")}
        onOpenConcept={openConceptDetail}
        onAsk={() => setView("ask")}
        onDrill={() => setView("drill")}
        onBrainDump={() => setView("dump")}
        onBackToShelf={backToShelf}
        continueNode={isLive ? continueNode : null}
        dueCount={reviewDue}
        onReviewAll={reviewAll}
        onRetry={retryCourseLoad}
      />
    )
  }

  return (
    <CourseShelf
      liveTree={tree}
      liveMastery={mastery}
      liveLoading={loading}
      liveCourseId={selectedCourseId}
      onSelect={openCourse}
      onNewCourse={onTabChange ? () => onTabChange("upload") : undefined}
      onProcess={onTabChange ? () => onTabChange("configure") : undefined}
    />
  )
}
