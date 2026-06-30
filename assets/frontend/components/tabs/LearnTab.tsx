"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CourseShelf } from "@/components/learn/course-shelf"
import { CourseHome } from "@/components/learn/course-home"
import { LessonView } from "@/components/learn/lesson-view"
import { ConceptsView } from "@/components/learn/concepts-view"
import { DrillView } from "@/components/learn/drill-view"
import { DumpView } from "@/components/learn/dump-view"
import { BookReader } from "@/components/learn/book-reader"
import { AskPanel } from "@/components/learn/ask-panel"
import { type StudyMode } from "@/components/learn/section-panel"
import {
  fetchChapterProgress,
  fetchMastery,
  fetchReviewQueue,
  fetchTocTree,
  findNodeBySectionKey,
  flattenSections,
  type LearnTreeNode,
  type MasteryResponse,
  type WeakestSection,
} from "@/lib/learn-service"
import { doneMap, firstIncompleteStage } from "@/lib/learn-path"
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

type View = "shelf" | "home" | "lesson" | "read" | "concepts" | "drill" | "dump" | "ask"

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
  const [selectedNode, setSelectedNode] = useState<LearnTreeNode | null>(null)
  const [studyMode, setStudyMode] = useState<StudyMode>(null)
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

  const sections = useMemo(() => flattenSections(tree), [tree])

  const { prevSection, nextSection } = useMemo(() => {
    if (!selectedScope) return { prevSection: null, nextSection: null }
    const idx = sections.findIndex((s) => s.sectionKey === selectedScope)
    return {
      prevSection: idx > 0 ? sections[idx - 1] : null,
      nextSection: idx >= 0 && idx < sections.length - 1 ? sections[idx + 1] : null,
    }
  }, [sections, selectedScope])

  // The chapter after the one currently in scope — top-level tree nodes are chapters. Used by
  // the Continue engine to hop chapters at the end of a path. Null when the scope isn't under
  // a recognizable top-level chapter (the engine then just offers "back to outline").
  const nextChapter = useMemo(() => {
    if (!selectedScope || tree.length === 0) return null
    const chapters = tree.filter((n) => n.isSection && n.sectionKey)
    if (chapters.length === 0) return null
    const idx = chapters.findIndex((c) => findNodeBySectionKey([c], selectedScope))
    if (idx < 0) return null
    return idx < chapters.length - 1 ? chapters[idx + 1] : null
  }, [tree, selectedScope])

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
    setSelectedNode(null)
    setStudyMode(null)
    setView("home")
    // Prime the readiness tracker so the live-refresh effect doesn't double-load.
    wasReadyRef.current = isCourseReady(course)
    if (isCourseReady(course)) {
      loadTree(course.learnDocId ?? course.id)
      loadMastery(course.learnDocId ?? course.id)
      loadDue(course.learnDocId ?? course.id)
    }
  }

  const backToShelf = () => {
    setView("shelf")
    setSelectedCourseId(null)
    loadTree()
    loadMastery()
  }

  const openSection = (scope: string | null, node: LearnTreeNode | null) => {
    setSelectedScope(scope)
    setSelectedNode(node)
    // Open a chapter at the start of its learning path (Orient → Learn → …).
    setStudyMode(scope ? "orient" : null)
    setView("lesson")
    if (scope) persistReadingPosition(scope)
  }

  // Whole-course review: jump into the Review mode over the full due queue (scope=null).
  const reviewAll = () => {
    setSelectedScope(null)
    setSelectedNode(null)
    setStudyMode("review")
    setView("lesson")
  }

  const navigateSection = (node: LearnTreeNode) => {
    setSelectedScope(node.sectionKey)
    setSelectedNode(node)
    if (node.sectionKey) persistReadingPosition(node.sectionKey)
  }

  // Jump to any chapter/subsection (or whole course) from inside the lesson view,
  // keeping the current study mode — used by the in-lesson scope picker.
  const selectScope = (scope: string | null, node: LearnTreeNode | null) => {
    setSelectedScope(scope)
    setSelectedNode(node)
    if (scope) persistReadingPosition(scope)
  }

  // Start a chapter at the top of its path (Orient) — the Continue engine's "next chapter" hop.
  const startChapterPath = (node: LearnTreeNode) => {
    setSelectedScope(node.sectionKey)
    setSelectedNode(node)
    setStudyMode("orient")
    setView("lesson")
    if (node.sectionKey) persistReadingPosition(node.sectionKey)
  }

  // Resume the learning path: drop into the last-studied chapter at its first incomplete stage.
  const handleResumePath = async () => {
    if (!continueSectionKey) return
    setSelectedScope(continueSectionKey)
    setSelectedNode(continueNode)
    setView("lesson")
    setStudyMode("orient") // optimistic — refined once progress loads
    try {
      const learnDoc = selectedCourse?.learnDocId ?? selectedCourse?.id
      const p = await fetchChapterProgress(continueSectionKey, learnDoc)
      setStudyMode(firstIncompleteStage(doneMap(p.stages)).mode)
    } catch {
      // optimistic orient stands if progress can't load
    }
  }

  const handleReview = (section: WeakestSection) => {
    const node = findNodeBySectionKey(tree, section.sectionKey)
    setSelectedScope(section.sectionKey)
    setSelectedNode(node)
    setStudyMode("review")
    setView("lesson")
  }

  const continueSectionKey = selectedCourseId
    ? readingProgress[selectedCourseId]
    : undefined
  const continueNode = continueSectionKey
    ? findNodeBySectionKey(tree, continueSectionKey)
    : null

  const handleContinueReading = () => {
    if (!continueSectionKey) return
    setSelectedScope(continueSectionKey)
    setSelectedNode(continueNode)
    setStudyMode("read")
    setView("lesson")
  }

  const backToCourseHome = () => {
    setView("home")
    setStudyMode(null)
    loadMastery(selectedCourse ? (selectedCourse.learnDocId ?? selectedCourse.id) : undefined)
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
      <BookReader
        course={selectedCourse}
        tree={isLive ? tree : []}
        loading={isLive ? loading : false}
        mastery={isLive ? mastery : null}
        onBack={backToCourseHome}
        onSectionRead={persistReadingPosition}
      />
    )
  }

  if (view === "concepts" && selectedCourse) {
    return <ConceptsView course={selectedCourse} onBack={backToCourseHome} />
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

  if (view === "lesson" && selectedCourse) {
    return (
      <LessonView
        course={selectedCourse}
        scope={selectedScope}
        node={selectedNode}
        studyMode={studyMode}
        onStudyModeChange={setStudyMode}
        sectionMastery={selectedScope ? mastery?.bySection[selectedScope] : undefined}
        onBack={backToCourseHome}
        onAnswered={() => {
          const d = selectedCourse.learnDocId ?? selectedCourse.id
          loadMastery(d)
          loadDue(d)
        }}
        prevSection={prevSection}
        nextSection={nextSection}
        onNavigate={navigateSection}
        tree={isLive ? tree : []}
        masteryBySection={isLive ? mastery?.bySection : undefined}
        onSelectScope={selectScope}
        nextChapter={nextChapter}
        onStartChapter={startChapterPath}
      />
    )
  }

  if (view === "ask" && selectedCourse) {
    return (
      <AskPanel
        course={selectedCourse}
        onBack={backToCourseHome}
        onOpenSection={(scope) => openSection(scope, scope ? findNodeBySectionKey(tree, scope) : null)}
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
        onViewConcepts={() => setView("concepts")}
        onAsk={() => setView("ask")}
        onDrill={() => setView("drill")}
        onBrainDump={() => setView("dump")}
        onBackToShelf={backToShelf}
        continueNode={isLive ? continueNode : null}
        onContinueReading={handleContinueReading}
        onResumePath={handleResumePath}
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
    />
  )
}
