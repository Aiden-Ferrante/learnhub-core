"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { BookOpen } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { EmptyState } from "@/kit/patterns/empty-state"
import { ErrorNotice, roots, useApiMutation } from "@/kit/data"
import { flattenChapterOutline, type LearnTreeNode } from "@/gateways/api/outline"
import { recordEngagement } from "@/gateways/api/progress"
import type { Course } from "@/surfaces/library"
import { useReadingTheme } from "@/surfaces/reading/use-reading-theme"
import { useReadingPrefs } from "@/surfaces/reading/use-reading-prefs"
import { useViewportPin } from "@/surfaces/reading/use-viewport-pin"
import { cn } from "@/kit/lib/utils"
import { resolveGuidedChapter, type StudyDrawer } from "./lib"
import { ChapterBody, SideReadErrors } from "./chapter-body"
import { ConceptPopover } from "./concept-popover"
import { MarginNotes } from "./margin-notes"
import { NarrationBar, useNarration } from "./narration-bar"
import { OutlineRail } from "./outline-rail"
import { PathBar } from "./path-bar"
import { ReadingHeader } from "./reading-header"
import { StudyDrawerPanel } from "./study-drawer"
import { useAnnotatedReader } from "./use-annotated-reader"
import { useChapterDom } from "./use-chapter-dom"
import { useChapterPath } from "./use-chapter-path"
import { useGuidedReadingData } from "./use-guided-reading-data"
import { useConceptHighlight, useWideScreen } from "./use-reader-layout"
import { useReaderScroll } from "./use-reader-scroll"

type GuidedReadingProps = {
  course: Course
  /** Initial position: any section key (e.g. the reading position); resolved to its chapter. */
  scope: string | null
  tree: LearnTreeNode[]
  /** Reports the chapter the reader lands on, so the reading position persists. */
  onScopeChange?: (sectionKey: string) => void
  /** Open a drawer once the chapter resolves (e.g. course-home "Review all" lands here). */
  initialDrawer?: "review" | "walk" | "lockin" | "tutor" | "listen"
}

/** Guided reading: one chapter on the reading paper, with its briefing, annotated prose,
 *  the path stepper and the study drawers. The shell wires state; fetching lives in
 *  use-guided-reading-data / use-chapter-path, the DOM pass in use-chapter-dom, and the
 *  pieces of chrome in their own files. Back to the course is the breadcrumb. */
export function GuidedReading({ course, scope, tree, onScopeChange, initialDrawer }: GuidedReadingProps) {
  const docId = course.learnDocId ?? course.id
  const [theme] = useReadingTheme()
  const [prefs, setPrefs] = useReadingPrefs()
  const [chapterKey, setChapterKey] = useState<string | null>(null)
  const data = useGuidedReadingData(docId, chapterKey, tree)
  const { chapters, chapter, outline, masteryByKey } = data
  const path = useChapterPath(chapterKey, docId)
  const { stages, markStage } = path
  const [drawer, setDrawer] = useState<StudyDrawer>(null)
  const wide = useWideScreen()
  const [highlightConcepts, setHighlightConcepts] = useConceptHighlight()
  const narration = useNarration(chapterKey, docId)
  // Inline concept popover (event-delegated so the reader never re-renders on open/close).
  const [active, setActive] = useState<{ idx: number; x: number; y: number } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const briefingRef = useRef<HTMLDivElement>(null)
  const headingEls = useRef<HTMLElement[]>([])
  useViewportPin(rootRef)

  const paper = theme === "paper"
  // Cards sit on the reading surface, so they follow it: warm on paper, app-dark otherwise.
  const cardCls = paper ? "border-paper-border bg-paper-card text-paper-ink" : "bg-card"
  const mutedCls = paper ? "text-paper-muted" : "text-muted-foreground"

  // Resolve the incoming position (any section key, or nothing) to its owning chapter.
  useEffect(() => {
    if (chapterKey || !data.outlineReady || chapters.length === 0) return
    const resolved = resolveGuidedChapter(chapters, tree, scope)
    if (resolved) setChapterKey(resolved)
  }, [chapterKey, data.outlineReady, chapters, tree, scope])

  // Chapter switch: close transient UI (popover/drawer).
  useEffect(() => {
    setActive(null)
    setDrawer(null)
  }, [docId, chapterKey])

  const { reader, concepts, conceptsRef, indexByName, displayMarkdown } = useAnnotatedReader({
    data: chapter.data,
    outline,
    chapterKey,
    theme,
    prefs,
    masteryByKey,
    highlightConcepts,
  })

  // Scroll: persist/restore, progress %, resumed chip, scroll-spy, read soft gate.
  const scroll = useReaderScroll({
    scrollKey: `txt2k:deep-scroll:${docId}:${chapterKey ?? ""}`,
    contentReady: Boolean(chapter.data?.markdown),
    alreadyRead: !!stages.read,
    onReadEnd: () => markStage("read"),
    getHeadings: () => headingEls.current,
  })
  const { scrollRef } = scroll

  // Within-chapter outline from the SAME tree + numbering the dashboard renders.
  const treeOutline = useMemo(() => (chapterKey ? flattenChapterOutline(tree, chapterKey) : []), [tree, chapterKey])
  const { notes, railItems, activeRail } = useChapterDom({
    wrapperRef,
    scrollRef,
    headingEls,
    reader,
    displayMarkdown,
    wide,
    conceptsRef,
    treeOutline,
    chapterKey,
    activeOutline: scroll.activeOutline,
    setActiveOutline: scroll.setActiveOutline,
  })

  const hasMarkdown = Boolean(chapter.data?.markdown)
  // A passive "read" event for the heatmap: fired, never awaited; a failure shows below.
  const engage = useApiMutation((v: { scope: string; doc?: string }) => recordEngagement("read", v.scope, v.doc), {
    invalidates: [roots.activity],
  })
  const { fire: fireEngage } = engage
  useEffect(() => {
    if (hasMarkdown && chapterKey) fireEngage({ scope: chapterKey, doc: docId })
  }, [hasMarkdown, chapterKey, docId, fireEngage])

  const goChapter = (key: string) => {
    setChapterKey(key)
    onScopeChange?.(key)
  }

  // Entry intent (e.g. "Review all" from course home): open the drawer once, after the
  // chapter resolves; chapter switches afterwards close drawers as usual.
  const initialDrawerDone = useRef(false)
  useEffect(() => {
    if (initialDrawerDone.current || !chapterKey || !initialDrawer) return
    initialDrawerDone.current = true
    setDrawer(initialDrawer)
  }, [chapterKey, initialDrawer])

  // Rail click → the stage's home on this surface: orient/read scroll, the rest are drawers.
  const runStage = (key: string) => {
    if (key === "orient") briefingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    else if (key === "read") scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
    else if (key === "skeleton") setDrawer("walk")
    else if (key === "lockin") setDrawer("lockin")
  }

  // Event delegation: clicks on annotated terms open the concept popover in place.
  const handleReaderClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[data-concept]") as HTMLElement | null
    if (el) {
      const r = el.getBoundingClientRect()
      setActive({ idx: Number(el.dataset.concept), x: r.left, y: r.bottom + 6 })
      e.stopPropagation()
      return
    }
    setActive(null)
  }

  const chapterIdx = chapters.findIndex((c) => c.key === chapterKey)
  const nextChapter = chapterIdx >= 0 && chapterIdx < chapters.length - 1 ? chapters[chapterIdx + 1] : null
  const status = chapter.data?.status
  // "Needs" = the chapter has no briefing yet (build it from the Process tab).
  const needsPrepare = Boolean(status && !status.briefing)
  const activeConcept = active ? concepts[active.idx] : null
  const activeMastery = activeConcept?.conceptKey != null ? masteryByKey[activeConcept.conceptKey] : undefined
  const title = chapters[chapterIdx]?.title || chapter.data?.blocks?.[0]?.heading || "Chapter"

  // Known to have no chapter to show: the list settled empty (or failed with no fallback).
  const listSettled = data.outlineReady && data.chaptersQ.status !== "loading"
  const noChapter =
    !chapterKey && listSettled && chapters.length === 0 ? (
      data.chaptersQ.error ? (
        <ErrorNotice title="Couldn't load the chapters" error={data.chaptersQ.error} onRetry={data.chaptersQ.retry} />
      ) : (
        <EmptyState
          icon={<BookOpen />}
          title="No chapters yet"
          description="Process this document to read it here."
        />
      )
    ) : null

  return (
    <div ref={rootRef} className="relative flex h-full flex-col">
      <ReadingHeader
        title={title}
        chapters={chapters}
        chapterKey={chapterKey}
        preparing={data.preparing}
        needsPrepare={needsPrepare}
        onGoChapter={goChapter}
        audioReady={narration.audioReady}
        playerOpen={narration.playerOpen}
        onTogglePlayer={narration.togglePlayer}
        prefs={prefs}
        onPrefsChange={setPrefs}
        highlightConcepts={highlightConcepts}
        onHighlightConcepts={setHighlightConcepts}
      />

      {chapterKey && (
        <PathBar
          stages={stages}
          onRunStage={runStage}
          dueCount={data.dueCount}
          onOpenDrawer={setDrawer}
          markError={path.markError}
          onRetryMark={path.retryMark}
        />
      )}

      {/* Narration mini-player: read along; position/speed persist (shared with the Listen drawer). */}
      {narration.playerOpen && chapterKey && (
        <NarrationBar chapterKey={chapterKey} docId={docId} onClose={narration.togglePlayer} />
      )}

      {/* Reading-progress hairline: how far through the chapter you are. */}
      <div className="h-0.5 shrink-0 bg-border/40">
        <div className="h-full bg-brand/80 transition-[width] duration-150 ease-out" style={{ width: `${scroll.readPct}%` }} />
      </div>

      <div
        ref={scrollRef}
        onScroll={scroll.handleScroll}
        className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-5", paper && "reading-surface-paper")}
        onClick={handleReaderClick}
      >
        <div className="mx-auto flex max-w-[110rem] justify-center gap-8">
          {/* Chapter outline: always in view while reading, locked to THIS chapter. */}
          <OutlineRail
            items={railItems}
            activeIndex={activeRail}
            onJump={(i) => headingEls.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" })}
            paper={paper}
            mutedCls={mutedCls}
          />

          <div ref={wrapperRef} className="relative min-w-0 flex-1">
            <div className="mx-auto max-w-[104ch]">
              <SideReadErrors
                reads={[
                  { title: "Couldn't load the outline", q: data.outlineQ },
                  { title: "Couldn't load the chapter list", q: data.chaptersQ },
                  { title: "Couldn't load your mastery", q: data.masteryQ },
                ]}
              />
              {engage.error && chapterKey && (
                <ErrorNotice
                  compact
                  title="Reading time not recorded"
                  error={engage.error}
                  onRetry={() => fireEngage({ scope: chapterKey, doc: docId })}
                />
              )}
              <ChapterBody
                chapter={chapter}
                chapterKey={chapterKey}
                noChapter={noChapter}
                reader={reader}
                stagesOriented={!!stages.orient}
                onOrient={() => markStage("orient")}
                conceptIndexByName={indexByName}
                cardCls={cardCls}
                mutedCls={mutedCls}
                briefingRef={briefingRef}
                paper={paper}
                chapterIdx={chapterIdx}
                chapterCount={chapters.length}
                nextChapter={nextChapter}
                onGoChapter={goChapter}
              />
            </div>

            {/* Margin notes (wide screens): first mentions surface as Tufte-style sidenotes. */}
            {wide && (
              <MarginNotes
                notes={notes}
                measure={prefs.measure}
                paper={paper}
                mutedCls={mutedCls}
                onOpen={(idx, x, y) => setActive({ idx, x, y })}
              />
            )}
          </div>
        </div>
      </div>

      {/* Resumed-position chip. */}
      {scroll.resumed && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="fixed bottom-6 left-1/2 z-40 h-auto -translate-x-1/2 rounded-full bg-popover px-3 py-1.5 text-xs font-normal shadow-lg hover:bg-muted"
          onClick={() => {
            scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
            scroll.dismissResumed()
          }}
        >
          Resumed where you left off — back to top
        </Button>
      )}

      {/* Concept popover: anchored to the clicked term. */}
      {activeConcept && active && (
        <ConceptPopover
          concept={activeConcept}
          mastery={activeMastery}
          x={active.x}
          y={active.y}
          onClose={() => setActive(null)}
        />
      )}

      {/* Study drawer: review / walk / lock-in / tutor / listen over the same surface. */}
      {drawer && (
        <StudyDrawerPanel
          drawer={drawer}
          title={title}
          chapterKey={chapterKey}
          docId={docId}
          tree={tree}
          onClose={() => setDrawer(null)}
          onRefreshMastery={data.refreshMastery}
          onProgress={path.loadProgress}
        />
      )}
    </div>
  )
}
