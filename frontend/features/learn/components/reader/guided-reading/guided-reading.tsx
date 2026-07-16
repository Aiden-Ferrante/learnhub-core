"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Headphones,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/patterns/empty-state"
import { MarkdownReader, MathText } from "@/features/learn/components/reader/markdown-reader"
import { ReadingThemeToggle } from "@/features/learn/components/reader/reading-theme-toggle"
import { ReadingControls } from "@/features/learn/components/reader/reading-controls"
import { ConceptMasteryDot } from "@/features/learn/components/concepts/concept-mastery-dot"
import { ConceptQuizPanel } from "@/features/learn/components/study/concept-quiz-panel"
import { ReviewPanel } from "@/features/learn/components/study/review-panel"
import { ExamPanel } from "@/features/learn/components/study/exam-panel"
import { ChapterWalk } from "@/features/learn/components/study/chapter-walk"
import { LockInPanel } from "@/features/learn/components/study/lockin-panel"
import { LessonPanel } from "@/features/learn/components/study/lesson-panel"
import { AudiobookPanel } from "@/features/learn/components/reader/audiobook-panel"
import { PATH_STAGES, firstIncompleteStage } from "@/features/learn/lib/learn-path"
import {
} from "@/features/learn/components/reader/chapter-reader"
import { type CourseChapter } from "@/features/learn/lib/toc"
import { useReadingTheme } from "@/features/learn/hooks/use-reading-theme"
import { useReadingPrefs } from "@/features/learn/hooks/use-reading-prefs"
import { audiobookFileUrl, getAudiobookStatus } from "@/features/learn/api/audiobook"
import { flattenChapterOutline, type LearnTreeNode, type OutlineEntry } from "@/features/learn/api/outline"
import { recordEngagement } from "@/features/learn/api/progress"
import type { Course } from "@/features/learn/lib/courses"
import { cn } from "@/lib/utils"
import {
  DRAWER_TITLES,
  HALF_MEASURE,
  KIND_COLOR,
  layoutNotes,
  numberOutlineItems,
  relevelHeadings,
  resolveGuidedChapter,
  type MarginNote,
  type StudyDrawer,
  nextNightEpoch,
} from "./lib"
import { annotateNode, buildConceptRegex, masteryTint, masteryWash } from "./concept-annotations"
import { useChapterPath } from "./use-chapter-path"
import { useGuidedReadingData } from "./use-guided-reading-data"
import { useReaderScroll } from "./use-reader-scroll"

type GuidedReadingProps = {
  course: Course
  /** Initial position — any section key (e.g. the reading position); resolved to its chapter. */
  scope: string | null
  tree: LearnTreeNode[]
  onBack: () => void
  /** Reports the chapter the reader lands on, so the reading position persists. */
  onScopeChange?: (sectionKey: string) => void
  /** Open a drawer once the chapter resolves (e.g. course-home "Review all" lands here). */
  initialDrawer?: "quiz" | "review" | "exam" | "walk" | "lockin" | "tutor" | "listen"
}

// ---------------------------------------------------------------------------

function CheckReveal({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
      <div className="font-medium text-foreground/90">
        Check yourself: <MathText text={q} className="inline-block" />
      </div>
      {open ? (
        <MathText text={a} className="mt-1 text-muted-foreground" />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 text-brand hover:underline"
        >
          Reveal answer
        </button>
      )}
    </div>
  )
}

export function GuidedReading({
  course,
  scope,
  tree,
  onBack,
  onScopeChange,
  initialDrawer,
}: GuidedReadingProps) {
  const docId = course.learnDocId ?? course.id
  const [theme] = useReadingTheme()
  const [prefs, setPrefs] = useReadingPrefs()
  const [chapterKey, setChapterKey] = useState<string | null>(null)
  // Everything fetched — outline, chapters, the chapter payload (+ prepare poll),
  // readiness (+ build poll), build actions, and the mastery layer.
  const {
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
  } = useGuidedReadingData(docId, chapterKey, tree)
  // Path stepper: the chapter's stage machine (orient/read/skeleton/quizzes/exam/lockin);
  // chapter_progress is the same store the old lesson flow wrote, so history carries over.
  const { stages, loadProgress, markStage, noteQuizAnswer } = useChapterPath(chapterKey, docId)
  const [drawer, setDrawer] = useState<StudyDrawer>(null)
  // Briefing concept-chip cloud: capped at 8 until expanded.
  const [allChips, setAllChips] = useState(false)
  const [notes, setNotes] = useState<MarginNote[]>([])
  const [wide, setWide] = useState(false)
  // Chapter outline (locked to THIS chapter): derived from the rendered headings,
  // so it always matches what's on screen. Scroll-spy highlights where you are.
  const [outlineItems, setOutlineItems] = useState<{ text: string; level: number }[]>([])
  // Concept highlighter wash (default on; toggle lives in the Aa reading settings).
  const [highlightConcepts, setHighlightConcepts] = useState(true)
  // Narration: play the chapter's audiobook file when one has already been generated.
  const [audioReady, setAudioReady] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [narrSpeed, setNarrSpeed] = useState(1)
  const narrAudioRef = useRef<HTMLAudioElement>(null)
  const narrSaveAt = useRef(0)

  useEffect(() => {
    try {
      setHighlightConcepts(localStorage.getItem("txt2k:concept-highlight") !== "0")
      const s = Number(localStorage.getItem("txt2k:audio-speed"))
      if (s >= 0.5 && s <= 3) setNarrSpeed(s)
    } catch {
      // storage unavailable
    }
  }, [])

  const toggleHighlight = (v: boolean) => {
    setHighlightConcepts(v)
    try {
      localStorage.setItem("txt2k:concept-highlight", v ? "1" : "0")
    } catch {
      // storage unavailable
    }
  }

  // Inline concept popover (event-delegated so the reader never re-renders on open/close).
  const [active, setActive] = useState<{ idx: number; x: number; y: number } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const briefingRef = useRef<HTMLDivElement>(null)
  const headingEls = useRef<HTMLElement[]>([])

  const paper = theme === "paper"
  // Cards sit on the reading surface, so they follow it: warm on paper, app-dark otherwise.
  const cardCls = paper ? "border-paper-border bg-paper-card text-paper-ink" : "bg-card"
  const mutedCls = paper ? "text-paper-muted" : "text-muted-foreground"

  // The surface lives inside the app's padded, page-scrolling container — pin its height to
  // the viewport so the READER owns the scroll (scroll persistence, margin notes, and the
  // sticky chrome all depend on the inner scroller actually scrolling).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const size = () => {
      window.scrollTo(0, 0)
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top))
      el.style.height = `calc(100dvh - ${top}px - 12px)`
    }
    size()
    window.addEventListener("resize", size)
    return () => window.removeEventListener("resize", size)
  }, [])

  // Margin notes only when there's real margin to use.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1440px)")
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  // Within-chapter outline from the SAME tree + numbering the dashboard renders.
  const treeOutline = useMemo(
    () => (chapterKey ? flattenChapterOutline(tree, chapterKey) : []),
    [tree, chapterKey],
  )
  // treeOutline item index → rendered-heading index (or -1 when the text has no match).
  const [railTargets, setRailTargets] = useState<number[]>([])

  // Resolve the incoming position (any section key, or nothing) to its owning chapter.
  useEffect(() => {
    if (chapterKey || !outlineReady || chapters.length === 0) return
    const resolved = resolveGuidedChapter(chapters, tree, scope)
    if (resolved) setChapterKey(resolved)
  }, [chapterKey, outlineReady, chapters, tree, scope])

  // Chapter switch: close transient UI (popover/drawer/notes/chip cloud).
  useEffect(() => {
    setActive(null)
    setDrawer(null)
    setNotes([])
    setAllChips(false)
  }, [docId, chapterKey])

  // Scroll: persist/restore, progress %, resumed chip, scroll-spy, read soft gate.
  const {
    scrollRef,
    readPct,
    resumed,
    dismissResumed,
    activeOutline,
    setActiveOutline,
    handleScroll,
  } = useReaderScroll({
    scrollKey: `txt2k:deep-scroll:${docId}:${chapterKey ?? ""}`,
    contentReady: Boolean(data?.markdown),
    alreadyRead: !!stages.read,
    onReadEnd: () => markStage("read"),
    getHeadings: () => headingEls.current,
  })

  useEffect(() => {
    if (data?.markdown && chapterKey) recordEngagement("read", chapterKey, docId)
  }, [data?.markdown, chapterKey, docId])

  // Narration availability: show the play control only when this chapter's audiobook
  // file already exists — generation stays an explicit act (the Listen drawer).
  useEffect(() => {
    setAudioReady(false)
    setPlayerOpen(false)
    if (!chapterKey) return
    let alive = true
    getAudiobookStatus(chapterKey, docId, "text")
      .then((st) => {
        if (alive && st.status === "done") setAudioReady(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [chapterKey, docId])

  const cycleNarrSpeed = () => {
    const steps = [1, 1.25, 1.5, 1.75, 2]
    const next = steps[(steps.indexOf(narrSpeed) + 1) % steps.length] ?? 1
    setNarrSpeed(next)
    if (narrAudioRef.current) narrAudioRef.current.playbackRate = next
    try {
      localStorage.setItem("txt2k:audio-speed", String(next))
    } catch {
      // storage unavailable
    }
  }

  const goChapter = (key: string) => {
    setChapterKey(key)
    onScopeChange?.(key)
  }

  // Entry intent (e.g. "Review all" from course home) — open the drawer once, after
  // the chapter resolves; chapter switches afterwards close drawers as usual.
  const initialDrawerDone = useRef(false)
  useEffect(() => {
    if (initialDrawerDone.current || !chapterKey || !initialDrawer) return
    initialDrawerDone.current = true
    setDrawer(initialDrawer)
  }, [chapterKey, initialDrawer])

  // Rail click → the stage's home on this surface: orient/read scroll, the rest are drawers.
  const runStage = (key: string) => {
    switch (key) {
      case "orient":
        briefingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        break
      case "read":
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
        break
      case "skeleton":
        setDrawer("walk")
        break
      case "quizzes":
        setDrawer("quiz")
        break
      case "exam":
        setDrawer("exam")
        break
      case "lockin":
        setDrawer("lockin")
        break
    }
  }

  const concepts = useMemo(() => data?.concepts ?? [], [data])
  const conceptsRef = useRef(concepts)
  conceptsRef.current = concepts

  const indexByName = useMemo(() => {
    const m = new Map<string, number>()
    concepts.forEach((c, i) => {
      const k = c.name.trim().toLowerCase()
      if (!m.has(k)) m.set(k, i)
    })
    return m
  }, [concepts])

  // Flat `##` walls → real hierarchy, from the outline's nesting.
  const displayMarkdown = useMemo(
    () => (data?.markdown ? relevelHeadings(data.markdown, outline, chapterKey) : ""),
    [data?.markdown, outline, chapterKey],
  )

  // The reader element is memoized: popover/selection/drawer state changes must not
  // re-parse a whole chapter of markdown.
  const reader = useMemo(() => {
    if (!displayMarkdown) return null
    const regex = buildConceptRegex(concepts)
    const classFor = (idx: number) => {
      const c = concepts[idx]
      const m = c?.conceptKey ? masteryByKey[c.conceptKey] : undefined
      return cn(masteryTint(m, masteredThreshold), highlightConcepts && masteryWash(m, masteredThreshold))
    }
    const annotate = (children: React.ReactNode) =>
      regex ? annotateNode(children, regex, indexByName, new Set<string>(), classFor) : children
    return (
      <MarkdownReader
        content={displayMarkdown}
        theme={theme}
        proseSize={prefs.size}
        measure={prefs.measure}
        // content-visibility keeps 50–90K-char chapters snappy: below-fold blocks skip
        // layout/paint until scrolled near.
        className="[&>*]:[content-visibility:auto] [&>*]:[contain-intrinsic-size:auto_150px]"
        components={
          regex
            ? {
                p: ({ node: _n, children, ...props }) => <p {...props}>{annotate(children)}</p>,
                li: ({ node: _n, children, ...props }) => <li {...props}>{annotate(children)}</li>,
              }
            : undefined
        }
      />
    )
  }, [displayMarkdown, concepts, indexByName, theme, prefs.size, prefs.measure, masteryByKey, masteredThreshold, highlightConcepts])

  // Post-render pass over the committed DOM: (1) dedupe underlines to the FIRST mention of
  // each concept in the chapter (per-paragraph marking alone is too noisy — "response time"
  // would be underlined a dozen times); (2) place margin notes beside the kept spans on wide
  // screens. Positions are measured synchronously and re-measured on scroll: below-fold
  // content-visibility blocks report ESTIMATED offsets until rendered, so the throttled
  // re-measure self-corrects any drift as the reader scrolls. (No rAF/IntersectionObserver —
  // those never fire in hidden tabs.)
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !displayMarkdown) return
    const seen = new Set<string>()
    const kept: HTMLElement[] = []
    wrapper.querySelectorAll<HTMLElement>(".markdown-reader [data-concept]").forEach((el) => {
      const k = el.dataset.concept!
      if (seen.has(k)) el.replaceWith(document.createTextNode(el.textContent || ""))
      else {
        seen.add(k)
        kept.push(el)
      }
    })

    // Chapter outline from the rendered headings (guaranteed to match the reader).
    // Ignore the number spans WE inject into headings, or re-runs would read
    // "1.2 Reliability" as the book's own number and skip renumbering.
    const heads = Array.from(wrapper.querySelectorAll<HTMLElement>(".markdown-reader h2, .markdown-reader h3, .markdown-reader h4"))
    headingEls.current = heads
    const ownText = (el: HTMLElement) =>
      Array.from(el.childNodes)
        .filter((n) => !(n instanceof HTMLElement && n.classList.contains("dc-heading-num")))
        .map((n) => n.textContent)
        .join("")
        .trim()
    setOutlineItems(heads.map((el) => ({ text: ownText(el), level: Number(el.tagName[1]) || 2 })))
    setActiveOutline(-1)

    if (!wide || kept.length === 0) {
      setNotes([])
      return
    }
    const measure = () => {
      const wrapRect = wrapper.getBoundingClientRect()
      const list: MarginNote[] = []
      for (const el of kept) {
        if (!el.isConnected) continue
        const idx = Number(el.dataset.concept)
        const c = conceptsRef.current[idx]
        if (!c) continue
        list.push({
          key: c.conceptKey || String(idx),
          idx,
          top: el.getBoundingClientRect().top - wrapRect.top,
          name: c.name,
          signal: c.signal,
        })
      }
      setNotes(layoutNotes(list))
    }
    measure()
    const scroller = scrollRef.current
    let last = 0
    const remeasure = () => {
      const now = Date.now()
      if (now - last < 250) return
      last = now
      measure()
    }
    scroller?.addEventListener("scroll", remeasure, { passive: true })
    window.addEventListener("resize", remeasure)
    return () => {
      scroller?.removeEventListener("scroll", remeasure)
      window.removeEventListener("resize", remeasure)
    }
  }, [reader, displayMarkdown, wide])

  // Event delegation: clicks on annotated terms open the concept popover in place.
  const handleReaderClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[data-concept]") as HTMLElement | null
    if (el) {
      const idx = Number(el.dataset.concept)
      const r = el.getBoundingClientRect()
      setActive({ idx, x: r.left, y: r.bottom + 6 })
      e.stopPropagation()
      return
    }
    setActive(null)
  }

  const numberedOutline = useMemo(
    () => numberOutlineItems(outlineItems, chapterKey),
    [outlineItems, chapterKey],
  )

  // Rail ↔ text binding: match the canonical outline items to the rendered headings
  // and stamp the DASHBOARD's numbers onto them (idempotent DOM pass). Falls back to
  // the synthesized positional numbering only when the tree has no entry for this
  // chapter — so the rail, the in-text numbers, and the course dashboard cannot drift.
  useEffect(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
    const headNorms = outlineItems.map((it) => norm(it.text))
    const stamp = (el: HTMLElement, num: string) => {
      if (!num || el.dataset.numbered) return
      el.dataset.numbered = "1"
      const span = document.createElement("span")
      span.className = "dc-heading-num"
      span.textContent = num
      span.style.opacity = "0.45"
      span.style.fontVariantNumeric = "tabular-nums"
      span.style.marginRight = "0.45em"
      span.style.fontWeight = "500"
      el.prepend(span)
    }
    if (treeOutline.length) {
      const used = new Set<number>()
      const targets = treeOutline.map((item) => {
        const t = norm(item.title)
        if (!t) return -1
        for (let i = 0; i < headNorms.length; i++) {
          if (used.has(i)) continue
          const h = headNorms[i]
          if (h === t || h.startsWith(t) || t.startsWith(h)) {
            used.add(i)
            return i
          }
        }
        return -1
      })
      setRailTargets(targets)
      treeOutline.forEach((item, j) => {
        const el = targets[j] >= 0 ? headingEls.current[targets[j]] : null
        if (el) stamp(el, item.number)
      })
    } else {
      setRailTargets([])
      numberedOutline.forEach((it, i) => {
        const el = headingEls.current[i]
        if (el) stamp(el, it.num)
      })
    }
  }, [treeOutline, outlineItems, numberedOutline])

  // Rail items: the canonical (dashboard) outline when the tree knows this chapter,
  // else the synthesized heading outline. `target` = rendered-heading index to jump to.
  const railItems = useMemo(
    () =>
      treeOutline.length
        ? treeOutline.map((it, j) => ({
            key: `${it.sectionKey}-${j}`,
            number: it.number,
            text: it.title,
            depthPad: it.depth,
            target: railTargets[j] ?? -1,
          }))
        : numberedOutline.map((it, i) => ({
            key: `${it.text}-${i}`,
            number: it.num,
            text: it.text,
            depthPad: Math.max(0, it.level - 2),
            target: i,
          })),
    [treeOutline, railTargets, numberedOutline],
  )
  const activeRail = useMemo(
    () =>
      treeOutline.length
        ? railItems.reduce((acc, it, j) => (it.target >= 0 && it.target <= activeOutline ? j : acc), -1)
        : activeOutline,
    [treeOutline.length, railItems, activeOutline],
  )

  const chapterIdx = useMemo(
    () => chapters.findIndex((c) => c.key === chapterKey),
    [chapters, chapterKey],
  )
  const prevChapter = chapterIdx > 0 ? chapters[chapterIdx - 1] : null
  const nextChapter = chapterIdx >= 0 && chapterIdx < chapters.length - 1 ? chapters[chapterIdx + 1] : null

  const briefing = data?.briefing
  const status = data?.status
  // Prefer the readiness ladder (knows about raw chapters); fall back to the
  // response status until it loads. "Needs" = anything short of fully deep.
  const cr = chapterKey ? readiness[chapterKey] : undefined
  const needsPrepare = cr
    ? cr.concepts === 0 || !cr.briefing
    : Boolean(status && !status.briefing)
  const activeConcept = active ? concepts[active.idx] : null
  const activeMastery =
    activeConcept?.conceptKey != null ? masteryByKey[activeConcept.conceptKey] : undefined
  const title = chapters[chapterIdx]?.title || data?.blocks?.[0]?.heading || "Chapter"

  return (
    <div ref={rootRef} className="relative flex h-full flex-col">
      {/* Header — the only chrome; everything else happens on the one surface. */}
      <div className="flex items-center gap-2 border-b bg-card/80 px-3 py-2 backdrop-blur">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onBack}>
          <ChevronLeft className="h-3.5 w-3.5" />
          {course.title}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-sm font-medium hover:text-brand"
              title="Jump to a chapter"
            >
              <span className="truncate">{title}</span>
              {(building || preparing) && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-brand" />}
              {queuedBuild && <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
            {/* Pipeline state for THIS chapter lives with the chapter list, not the toolbar. */}
            {(building || queuedBuild || preparing || needsPrepare) && (
              <>
                {building ? (
                  <DropdownMenuItem disabled className="gap-2 text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Building
                    {currentBuild?.phase === "extract" && currentBuild.total
                      ? ` · extracting ${currentBuild.done}/${currentBuild.total}`
                      : currentBuild?.phase === "deep"
                        ? " · guided layer"
                        : "…"}
                  </DropdownMenuItem>
                ) : queuedBuild ? (
                  <DropdownMenuItem onSelect={cancelBuildJob} className="gap-2 text-xs">
                    <Clock className="h-3.5 w-3.5" />
                    {currentBuild?.notBefore
                      ? `Queued · ${new Date(currentBuild.notBefore * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                      : "Queued"}
                    <span className="ml-auto text-muted-foreground">cancel</span>
                  </DropdownMenuItem>
                ) : preparing ? (
                  <DropdownMenuItem disabled className="gap-2 text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing…
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onSelect={() => startBuild(null)} className="gap-2 text-xs">
                      <Wand2 className="h-3.5 w-3.5" /> Build this chapter now
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => startBuild(nextNightEpoch())} className="gap-2 text-xs">
                      <Clock className="h-3.5 w-3.5" /> Build tonight · 2:00 AM
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            {chapters.map((c) => {
              const r = readiness[c.key]
              const b = r?.build
              // Readiness ladder dot: building / queued / deep / partial / raw.
              const dot =
                b?.status === "running" ? (
                  <Loader2 className="h-3 w-3 animate-spin text-brand" />
                ) : b?.status === "queued" ? (
                  <Clock className="h-3 w-3 text-muted-foreground" />
                ) : r && r.concepts > 0 && r.briefing ? (
                  <span className="h-2 w-2 rounded-full bg-brand" title="Guided reading — ready" />
                ) : r && r.concepts > 0 ? (
                  <span className="h-2 w-2 rounded-full border border-brand bg-brand/30" title="Partially built" />
                ) : (
                  <span className="h-2 w-2 rounded-full border border-muted-foreground/40" title="Not built yet" />
                )
              return (
                <DropdownMenuItem
                  key={c.key}
                  onSelect={() => goChapter(c.key)}
                  className={cn("gap-2", c.key === chapterKey && "text-brand")}
                >
                  <span className="flex w-3 shrink-0 items-center justify-center">{dot}</span>
                  <span className="truncate">{c.title}</span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {audioReady && (
          <Button
            type="button"
            variant={playerOpen ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setPlayerOpen((o) => !o)}
            title="Narration — this chapter has generated audio"
          >
            <Headphones className="h-3.5 w-3.5" />
            Narrate
          </Button>
        )}
        <ReadingControls
          prefs={prefs}
          onChange={setPrefs}
          extras={
            <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Highlight concepts</span>
              <Switch checked={highlightConcepts} onCheckedChange={toggleHighlight} />
            </label>
          }
        />
        <ReadingThemeToggle />
      </div>

      {/* Path stepper — the guided journey compressed to one glance: done stages are
          check-dots, the CURRENT stage keeps its label, the rest are quiet dots. */}
      {chapterKey && (
        <div className="flex items-center gap-1 overflow-x-auto border-b bg-card/60 px-3 py-1">
          <span className="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Path
          </span>
          {PATH_STAGES.map((s) => {
            const done = !!stages[s.key]
            const isNext = !done && firstIncompleteStage(stages).key === s.key
            if (isNext) {
              return (
                <button
                  key={s.key}
                  type="button"
                  title={s.lead}
                  onClick={() => runStage(s.key)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                  {s.label}
                </button>
              )
            }
            return (
              <button
                key={s.key}
                type="button"
                title={`${s.label} — ${s.lead}`}
                onClick={() => runStage(s.key)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted/60"
              >
                {done ? (
                  <Check className="h-3 w-3 text-status-mastered" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                )}
              </button>
            )
          })}
          <span className="ml-1 shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {PATH_STAGES.filter((s) => stages[s.key]).length}/{PATH_STAGES.length}
          </span>
          {/* Study actions, pinned to the bar — always reachable while reading. */}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("h-6 gap-1 px-2 text-xs", dueCount > 0 && "text-status-due hover:text-status-due")}
              onClick={() => setDrawer("review")}
            >
              <RotateCcw className="h-3 w-3" />
              Review{dueCount > 0 ? ` · ${dueCount}` : ""}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => setDrawer("tutor")}>
              <MessageCircleQuestion className="h-3 w-3" />
              Tutor
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => setDrawer("listen")}>
              <Headphones className="h-3 w-3" />
              Listen
            </Button>
          </div>
        </div>
      )}

      {/* Narration mini-player — read along; position/speed persist (shared with the Listen drawer). */}
      {playerOpen && audioReady && chapterKey && (
        <div className="flex items-center gap-2 border-b bg-card/70 px-4 py-1.5">
          <audio
            ref={narrAudioRef}
            controls
            preload="metadata"
            src={audiobookFileUrl(chapterKey, docId, "text")}
            className="h-8 min-w-0 flex-1 max-w-2xl"
            onLoadedMetadata={() => {
              const el = narrAudioRef.current
              if (!el) return
              el.playbackRate = narrSpeed
              try {
                const t = Number(localStorage.getItem(`txt2k:audio-pos:${chapterKey}:text`))
                if (t > 0 && t < el.duration - 2) el.currentTime = t
              } catch {
                // storage unavailable
              }
            }}
            onTimeUpdate={() => {
              const el = narrAudioRef.current
              if (!el) return
              const now = Date.now()
              if (now - narrSaveAt.current < 2000) return
              narrSaveAt.current = now
              try {
                localStorage.setItem(`txt2k:audio-pos:${chapterKey}:text`, String(Math.floor(el.currentTime)))
              } catch {
                // storage unavailable
              }
            }}
          />
          <button
            type="button"
            onClick={cycleNarrSpeed}
            className="rounded border px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground hover:text-foreground"
            title="Playback speed"
          >
            {narrSpeed}×
          </button>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setPlayerOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Reading-progress hairline — how far through the chapter you are. */}
      <div className="h-0.5 shrink-0 bg-border/40">
        <div
          className="h-full bg-brand/80 transition-[width] duration-150 ease-out"
          style={{ width: `${readPct}%` }}
        />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-5", paper && "reading-surface-paper")}
        onClick={handleReaderClick}
       
      >
        <div className="mx-auto flex max-w-[110rem] justify-center gap-8">
          {/* Chapter outline — always in view while reading, locked to THIS chapter.
              Fills the dead left margin; scroll-spy shows where you are. */}
          {railItems.length > 0 && (
            <nav className="sticky top-0 hidden max-h-[calc(100dvh-220px)] w-56 shrink-0 self-start overflow-y-auto pb-4 pr-1 pt-1 lg:block">
              <div className={cn("mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide", mutedCls)}>
                In this chapter
              </div>
              <div className="space-y-0.5">
                {railItems.map((it, j) => (
                  <button
                    key={it.key}
                    type="button"
                    title={it.number ? `${it.number} ${it.text}` : it.text}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (it.target >= 0)
                        headingEls.current[it.target]?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }}
                    className={cn(
                      "block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors",
                      j === activeRail
                        ? "bg-brand/10 font-medium text-brand"
                        : cn(mutedCls, paper ? "hover:bg-paper-card" : "hover:bg-muted/50", "hover:opacity-100"),
                      it.target < 0 && "cursor-default opacity-60",
                    )}
                    style={{ paddingLeft: `${8 + it.depthPad * 12}px` }}
                  >
                    {it.number && <span className="mr-1.5 tabular-nums opacity-60">{it.number}</span>}
                    {it.text}
                  </button>
                ))}
              </div>
            </nav>
          )}

          <div ref={wrapperRef} className="relative min-w-0 flex-1">
            <div className="mx-auto max-w-[104ch]">
            {loading && !data && (
              <div className="space-y-3">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-64 w-full" />
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                {error}
                <Button type="button" variant="outline" size="sm" className="ml-3 h-7 text-xs" onClick={load}>
                  Retry
                </Button>
              </div>
            )}

            {/* Briefing — what this chapter teaches, assembled from the pre-generated layer. */}
            {briefing && (
              <div ref={briefingRef} className={cn("mb-6 rounded-lg border p-4", cardCls)}>
                {/* Once oriented, the briefing folds to one line — the prose is the point. */}
                <details open={!stages.orient}>
                  <summary className="flex cursor-pointer list-none items-center gap-2">
                    <BookOpen className={cn("h-4 w-4", mutedCls)} />
                    <span className="text-sm font-semibold">Chapter briefing</span>
                    {stages.orient ? (
                      <span className="flex items-center gap-1 text-xs text-status-mastered">
                        <Check className="h-3 w-3" /> oriented
                      </span>
                    ) : (
                      <span className={cn("text-xs", mutedCls)}>what this chapter teaches</span>
                    )}
                    <ChevronDown className={cn("ml-auto h-3.5 w-3.5", mutedCls)} />
                  </summary>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {briefing.objectives.length > 0 && (
                    <div>
                      <div className={cn("mb-1.5 text-xs font-semibold uppercase tracking-wide", mutedCls)}>
                        You&apos;ll be able to
                      </div>
                      <ul className="space-y-1 text-sm opacity-90">
                        {briefing.objectives.map((o, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-brand">•</span>
                            <MathText text={o} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {briefing.watchFor.length > 0 && (
                    <div>
                      <div className={cn("mb-1.5 text-xs font-semibold uppercase tracking-wide", mutedCls)}>
                        Watch for
                      </div>
                      <ul className="space-y-1 text-sm opacity-90">
                        {briefing.watchFor.map((w, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-amber-400">•</span>
                            <MathText text={w} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {briefing.sections.length > 0 && (
                  <details className="mt-4 border-t pt-3 lg:hidden" open={briefing.sections.length <= 8}>
                    <summary className={cn("cursor-pointer text-xs font-semibold uppercase tracking-wide", mutedCls)}>
                      The road through · {briefing.sections.length} sections
                    </summary>
                    <div className="mt-1.5 space-y-1">
                      {briefing.sections.map((s, i) => (
                        <div key={`${s.sectionKey}-${i}`} className="text-sm" style={{ paddingLeft: `${(s.depth ?? 0) * 12}px` }}>
                          <span className="opacity-90">{s.heading}</span>
                          {s.essence && <span className={mutedCls}> — {s.essence}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {!stages.orient && (
                  <div className="mt-4 border-t pt-3">
                    <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => markStage("orient")}>
                      <Check className="h-3.5 w-3.5" />
                      I&apos;m oriented — start reading
                    </Button>
                  </div>
                )}
                {briefing.keyConcepts.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t pt-3">
                    {(allChips ? briefing.keyConcepts : briefing.keyConcepts.slice(0, 8)).map((c, i) => {
                      const idx = indexByName.get(c.name.trim().toLowerCase())
                      return (
                        <button
                          key={`${c.name}-${i}`}
                          type="button"
                          data-concept={idx}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs",
                            KIND_COLOR[c.kind] ?? "border-border text-muted-foreground",
                          )}
                          title={c.signal}
                        >
                          {c.name}
                        </button>
                      )
                    })}
                    {!allChips && briefing.keyConcepts.length > 8 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAllChips(true)
                        }}
                        className={cn("rounded-full border border-dashed px-2 py-0.5 text-xs", mutedCls, "hover:text-brand")}
                      >
                        +{briefing.keyConcepts.length - 8} more
                      </button>
                    )}
                  </div>
                )}
                </details>
              </div>
            )}

            {/* The reader spine. */}
            {reader}
            {!loading && !error && data && !data.markdown && (
              <EmptyState
                icon={<BookOpen />}
                title="Nothing to read here"
                description="This scope has no readable content of its own — it may be a Part divider or front matter."
                action={
                  nextChapter ? (
                    <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={() => goChapter(nextChapter.key)}>
                      Next: {nextChapter.title} <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  ) : undefined
                }
              />
            )}

            {/* End of chapter — the study actions live pinned in the path bar above. */}
            {!loading && data?.markdown && nextChapter && (
              <button
                type="button"
                onClick={() => goChapter(nextChapter.key)}
                className={cn(
                  "mt-10 flex w-full items-center justify-between gap-3 rounded-lg border px-5 py-3 text-left text-sm transition-colors",
                  cardCls,
                  paper ? "hover:bg-paper-card" : "hover:bg-muted/40",
                )}
              >
                <span className={cn("shrink-0 text-xs", mutedCls)}>
                  Up next · Chapter {chapterIdx + 2} of {chapters.length}
                </span>
                <span className="flex min-w-0 items-center gap-1 font-medium">
                  <span className="truncate">{nextChapter.title}</span>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </span>
              </button>
            )}
          </div>

          {/* Margin notes (wide screens): first mentions surface as Tufte-style sidenotes. */}
          {wide &&
            notes.map((n) => (
              <button
                key={n.key}
                type="button"
                className={cn(
                  "absolute hidden w-52 rounded-md border border-transparent p-1.5 text-left transition-colors min-[1440px]:block",
                  paper ? "hover:border-paper-border hover:bg-paper-card" : "hover:border-border hover:bg-card",
                )}
                style={{ top: n.top, left: `calc(50% + ${HALF_MEASURE[prefs.measure]} + 28px)` }}
                onClick={(e) => {
                  e.stopPropagation()
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setActive({ idx: n.idx, x: Math.max(16, r.left - 440), y: r.top })
                }}
              >
                <div className={cn("truncate text-xs font-medium", paper ? "text-paper-ink-strong" : "text-foreground/90")}>
                  {n.name}
                </div>
                <div className={cn("mt-0.5 line-clamp-3 text-[11px] leading-snug", mutedCls)}>
                  <MathText text={n.signal} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Resumed-position chip. */}
      {resumed && (
        <button
          type="button"
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border bg-popover px-3 py-1.5 text-xs shadow-lg hover:bg-muted"
          onClick={() => {
            scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
            dismissResumed()
          }}
        >
          Resumed where you left off — back to top
        </button>
      )}

      {/* Concept popover — anchored to the clicked term. */}
      {activeConcept && active && (
        <div
          className="fixed z-50 w-[min(26rem,90vw)] rounded-lg border bg-popover p-3 shadow-xl"
          style={{
            left: Math.min(active.x, window.innerWidth - Math.min(430, window.innerWidth * 0.92)),
            top: Math.min(active.y, window.innerHeight - 320),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <ConceptMasteryDot mastery={activeMastery?.mastery} attempts={activeMastery?.attempts} />
              <span className="text-sm font-semibold">{activeConcept.name}</span>
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px]",
                  KIND_COLOR[activeConcept.kind] ?? "border-border text-muted-foreground",
                )}
              >
                {activeConcept.kind}
              </span>
            </div>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setActive(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
            <MathText text={activeConcept.signal} className="text-foreground/90" />
            {activeConcept.questions?.[0] && (
              <CheckReveal q={activeConcept.questions[0].q} a={activeConcept.questions[0].a} />
            )}
          </div>
        </div>
      )}

      {/* Study drawer — quiz / review / exam over the same surface (spec §8 step 5). */}
      {drawer && (
        <div className="absolute inset-y-0 right-0 z-40 flex w-[min(30rem,95vw)] flex-col border-l bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="text-xs font-medium text-muted-foreground">
              {DRAWER_TITLES[drawer]} · {title}
            </div>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setDrawer(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {drawer === "quiz" && (
              <ConceptQuizPanel
                scope={chapterKey}
                docId={docId}
                onAnswered={() => {
                  refreshMastery()
                  // Quizzes soft gate: a real round of retrieval marks the stage.
                  noteQuizAnswer()
                }}
              />
            )}
            {drawer === "review" && chapterKey && (
              <ReviewPanel scope={chapterKey} docId={docId} onAnswered={refreshMastery} />
            )}
            {drawer === "exam" && (
              <ExamPanel
                scope={chapterKey}
                docId={docId}
                onGraded={() => {
                  refreshMastery()
                  loadProgress() // exam stage is written server-side on a passing grade
                }}
                onDrillMisses={() => setDrawer("quiz")}
                onLockIn={() => setDrawer("lockin")}
              />
            )}
            {drawer === "walk" && (
              <ChapterWalk
                scope={chapterKey}
                docId={docId}
                tree={tree}
                onAnswered={refreshMastery}
                onComplete={() => loadProgress()} // walk grades the skeleton stage itself
              />
            )}
            {drawer === "lockin" && <LockInPanel scope={chapterKey} docId={docId} onDone={loadProgress} />}
            {drawer === "tutor" && <LessonPanel scope={chapterKey} docId={docId} onAnswered={refreshMastery} />}
            {drawer === "listen" && <AudiobookPanel scope={chapterKey} docId={docId} />}
          </div>
        </div>
      )}
    </div>
  )
}
