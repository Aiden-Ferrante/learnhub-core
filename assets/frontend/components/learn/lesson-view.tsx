"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  GraduationCap,
  Headphones,
  Route,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SyllabusTree } from "@/components/learn/syllabus-tree"
import { type StudyMode } from "@/components/learn/section-panel"
import { nextStage, stageForMode, stageIndexForMode } from "@/lib/learn-path"
import { ChapterWalk } from "@/components/learn/chapter-walk"
import { OrientPanel } from "@/components/learn/orient-panel"
import { ExamPanel } from "@/components/learn/exam-panel"
import { LockInPanel } from "@/components/learn/lockin-panel"
import { ChapterPath } from "@/components/learn/chapter-path"
import { LessonPanel } from "@/components/learn/lesson-panel"
import { ReviewPanel } from "@/components/learn/review-panel"
import { ConceptQuizPanel } from "@/components/learn/concept-quiz-panel"
import { GuidedReader } from "@/components/learn/guided-reader"
import { AudiobookPanel } from "@/components/learn/audiobook-panel"
import { ReadingThemeToggle } from "@/components/learn/reading-theme-toggle"
import { ReadingControls } from "@/components/learn/reading-controls"
import {
  displaySectionTitle,
  type LearnTreeNode,
  type SectionMastery,
} from "@/lib/learn-service"
import { type Course } from "@/lib/courses"
import { useReadingTheme } from "@/hooks/use-reading-theme"
import { useReadingPrefs } from "@/hooks/use-reading-prefs"
import { cn } from "@/lib/utils"

type LessonViewProps = {
  course: Course
  scope: string | null
  node: LearnTreeNode | null
  studyMode: StudyMode
  onStudyModeChange: (mode: StudyMode) => void
  sectionMastery?: SectionMastery
  onBack: () => void
  onAnswered: () => void
  prevSection?: LearnTreeNode | null
  nextSection?: LearnTreeNode | null
  onNavigate?: (node: LearnTreeNode) => void
  tree?: LearnTreeNode[]
  masteryBySection?: Record<string, SectionMastery>
  onSelectScope?: (scope: string | null, node: LearnTreeNode | null) => void
  nextChapter?: LearnTreeNode | null
  onStartChapter?: (node: LearnTreeNode) => void
}

const PANEL_TITLE: Record<Exclude<StudyMode, null>, string> = {
  orient: "Orient",
  learn: "Learn",
  lesson: "Lesson",
  review: "Review",
  conceptQuiz: "Quizzes",
  exam: "Exam",
  lockin: "Lock in",
  read: "Read",
  listen: "Audiobook",
}

export function LessonView({
  course,
  scope,
  node,
  studyMode,
  onStudyModeChange,
  sectionMastery,
  onBack,
  onAnswered,
  prevSection,
  nextSection,
  onNavigate,
  tree,
  masteryBySection,
  onSelectScope,
  nextChapter,
  onStartChapter,
}: LessonViewProps) {
  const [readingTheme] = useReadingTheme()
  const [readingPrefs, setReadingPrefs] = useReadingPrefs()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)

  // The Read stage can be read or listened to — same content, two ways to take it in.
  const [readSubmode, setReadSubmode] = useState<"read" | "listen">("read")

  // Bumped whenever a stage reports completion, so the path stepper re-reads its ✓ progress
  // without waiting for a mode switch.
  const [pathRefresh, setPathRefresh] = useState(0)
  const handleAnswered = () => {
    setPathRefresh((n) => n + 1)
    onAnswered()
  }

  // Per-section scroll memory: each (section, mode) remembers where you were.
  const scrollRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scrollKey = `txt2k:lesson-scroll:${course.id}:${scope}:${studyMode}`

  const onScroll = () => {
    if (!scrollRef.current || !scope) return
    clearTimeout(saveTimer.current)
    const top = scrollRef.current.scrollTop
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(scrollKey, String(top))
      } catch {
        // storage unavailable
      }
    }, 200)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = 0 // new section/mode starts clean
    let saved = 0
    try {
      saved = Number(localStorage.getItem(scrollKey)) || 0
    } catch {
      saved = 0
    }
    if (saved <= 0) return
    let tries = 0
    let raf = 0
    const restore = () => {
      const c = scrollRef.current
      if (!c) return
      if (c.scrollHeight - c.clientHeight >= saved || tries > 20) {
        c.scrollTop = saved
        return
      }
      tries += 1
      raf = requestAnimationFrame(restore)
    }
    raf = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(raf)
  }, [scrollKey])

  const title = scope
    ? node?.label
      ? displaySectionTitle(node.label, node.title)
      : displaySectionTitle(scope)
    : "Whole course"
  const masteryPct =
    sectionMastery && sectionMastery.attempts > 0
      ? Math.round(sectionMastery.mastery * 100)
      : null

  // The Continue engine: one next-action that threads stage → stage → next chapter. It only
  // appears while you're on the guided path (a path stage with a real section in scope).
  const onPath = !!scope && stageIndexForMode(studyMode) >= 0
  const ns = nextStage(studyMode)
  const nextChapterTitle = nextChapter
    ? displaySectionTitle(nextChapter.label, nextChapter.title)
    : null
  const continueAction: { label: string; sub: string; run: () => void } | null =
    !onPath || studyMode === "learn"
      ? null
      : ns
        ? { label: `Continue: ${ns.label}`, sub: ns.lead, run: () => onStudyModeChange(ns.mode) }
        : nextChapter && onStartChapter && nextChapterTitle
          ? {
              label: `Next chapter: ${nextChapterTitle}`,
              sub: "Carry the momentum into the next chapter.",
              run: () => onStartChapter(nextChapter),
            }
          : { label: "Back to course outline", sub: "Chapter complete.", run: onBack }

  // → advances to the next step (kept off Enter, which the quiz/exam panels use to go to the
  // next question). Ignored while typing or with a modifier held. A ref keeps the latest
  // action so the listener subscribes once.
  const continueRunRef = useRef<(() => void) | null>(null)
  continueRunRef.current = continueAction?.run ?? null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" || e.metaKey || e.ctrlKey || e.altKey) return
      const run = continueRunRef.current
      if (!run) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (t && t.isContentEditable) return
      e.preventDefault()
      run()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const narration = onPath ? stageForMode(studyMode)?.lead : null
  const isReadStage = studyMode === "read"
  const listening = (isReadStage && readSubmode === "listen") || studyMode === "listen"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Course outline
        </button>
        <div className="flex items-center gap-3">
          {tree && tree.length > 0 && onSelectScope ? (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-[14rem] gap-1.5 px-2 text-sm font-medium"
                  title="Jump to a chapter"
                >
                  <span className="truncate">{title}</span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[22rem] p-0">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  Jump to chapter
                </div>
                <div className="h-[60vh] max-h-[28rem]">
                  <SyllabusTree
                    tree={tree}
                    selectedScope={scope}
                    masteryBySection={masteryBySection}
                    docId={course.learnDocId}
                    chaptersOnly
                    onSelectScope={(s, n) => {
                      onSelectScope(s, n)
                      setPickerOpen(false)
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-sm font-medium">{title}</span>
          )}
          {masteryPct != null && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full bg-nvidia-green"
                style={{ opacity: 0.2 + 0.8 * Math.min(1, sectionMastery!.mastery) }}
              />
              {masteryPct}% mastery
            </span>
          )}
          {onNavigate && (prevSection || nextSection) && (
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!prevSection}
                onClick={() => prevSection && onNavigate(prevSection)}
                title={
                  prevSection
                    ? `Previous: ${displaySectionTitle(prevSection.label, prevSection.title)}`
                    : undefined
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!nextSection}
                onClick={() => nextSection && onNavigate(nextSection)}
                title={
                  nextSection
                    ? `Next: ${displaySectionTitle(nextSection.label, nextSection.title)}`
                    : undefined
                }
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          {scope && (
            <Popover open={toolsOpen} onOpenChange={setToolsOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  title="Supporting tools for this chapter"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Tools
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1">
                <button
                  type="button"
                  onClick={() => {
                    onStudyModeChange("lesson")
                    setToolsOpen(false)
                  }}
                  className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    Lesson
                    <span className="block text-xs text-muted-foreground">
                      Work through it with a tutor
                    </span>
                  </span>
                </button>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-card/40 px-4 py-2.5">
        <ChapterPath
          scope={scope}
          docId={course.learnDocId}
          studyMode={studyMode}
          onSelect={onStudyModeChange}
          refreshKey={pathRefresh}
        />
      </div>

      <div className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex min-h-[280px] flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>{listening ? "Audiobook" : studyMode ? PANEL_TITLE[studyMode] : "Study panel"}</span>
              {isReadStage && (
                <div className="flex items-center gap-0.5 rounded-md border p-0.5" role="group" aria-label="Read or listen">
                  <button
                    type="button"
                    aria-pressed={readSubmode === "read"}
                    onClick={() => setReadSubmode("read")}
                    className={cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                      readSubmode === "read" ? "bg-brand/15 text-brand" : "text-muted-foreground",
                    )}
                  >
                    <FileText className="h-3 w-3" />
                    Read
                  </button>
                  <button
                    type="button"
                    aria-pressed={readSubmode === "listen"}
                    onClick={() => setReadSubmode("listen")}
                    className={cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                      readSubmode === "listen" ? "bg-brand/15 text-brand" : "text-muted-foreground",
                    )}
                  >
                    <Headphones className="h-3 w-3" />
                    Listen
                  </button>
                </div>
              )}
            </div>
            {isReadStage && !listening && (
              <div className="flex items-center gap-2">
                <ReadingThemeToggle />
                <ReadingControls prefs={readingPrefs} onChange={setReadingPrefs} />
              </div>
            )}
          </div>
          {narration && (
            <div className="flex items-start gap-2 border-b bg-brand/5 px-4 py-2 text-xs text-muted-foreground">
              <Route className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
              <span>{narration}</span>
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className={cn(
              "min-h-0 flex-1 overflow-auto transition-colors",
              isReadStage && !listening && readingTheme === "paper" && "reading-surface-paper",
            )}
          >
            {/* Keyed so each stage (and read↔listen) cross-fades in instead of popping. */}
            <div key={`${studyMode}:${listening}`} className="animate-in fade-in-0 duration-200">
            {studyMode === "orient" && (
              <OrientPanel scope={scope} docId={course.learnDocId} onAcknowledge={handleAnswered} />
            )}
            {studyMode === "learn" && (
              <ChapterWalk
                scope={scope}
                docId={course.learnDocId}
                tree={tree}
                onAnswered={handleAnswered}
                onComplete={() => {
                  const n = nextStage("learn")
                  if (n) onStudyModeChange(n.mode)
                }}
              />
            )}
            {studyMode === "lesson" && (
              <LessonPanel scope={scope} docId={course.learnDocId} onAnswered={handleAnswered} />
            )}
            {studyMode === "review" && (
              <ReviewPanel scope={scope} docId={course.learnDocId} onAnswered={handleAnswered} />
            )}
            {studyMode === "conceptQuiz" && (
              <ConceptQuizPanel scope={scope} docId={course.learnDocId} onAnswered={handleAnswered} />
            )}
            {studyMode === "exam" && (
              <ExamPanel scope={scope} docId={course.learnDocId} onGraded={handleAnswered} />
            )}
            {studyMode === "lockin" && (
              <LockInPanel
                scope={scope}
                docId={course.learnDocId}
                nextSection={nextSection}
                onNavigate={onNavigate}
                onDone={handleAnswered}
              />
            )}
            {isReadStage && !listening && (
              <GuidedReader
                scope={scope}
                docId={course.learnDocId}
                theme={readingTheme}
                proseSize={readingPrefs.size}
                measure={readingPrefs.measure}
                onConceptStudied={handleAnswered}
              />
            )}
            {listening && <AudiobookPanel scope={scope} docId={course.learnDocId} />}
            {!studyMode && (
              <p className="p-6 text-sm text-muted-foreground">
                Pick a stage on the learning path above to begin — then use Continue to move
                through the chapter.
              </p>
            )}
            </div>
          </div>
          {continueAction && (
            <div className="flex items-center justify-end gap-3 border-t bg-card px-3 py-2">
              <span className="mr-auto hidden truncate text-xs text-muted-foreground sm:block">
                {continueAction.sub}
              </span>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={continueAction.run}
              >
                {continueAction.label}
                <ArrowRight className="h-3.5 w-3.5" />
                <kbd className="ml-1 hidden rounded bg-background/20 px-1 text-[10px] sm:inline">
                  →
                </kbd>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
