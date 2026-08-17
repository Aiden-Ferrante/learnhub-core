"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Headphones,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { Switch } from "@/kit/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/kit/ui/dropdown-menu"
import { EmptyState } from "@/kit/patterns/empty-state"
import { MarkdownReader } from "@/surfaces/reading/markdown-reader"
import { ReadingThemeToggle } from "@/surfaces/reading/reading-theme-toggle"
import { ReadingControls } from "@/surfaces/reading/reading-controls"
import { PATH_STAGES, firstIncompleteStage } from "@/surfaces/reading/learn-path"
import {
} from "@/surfaces/reading/chapter-reader"
import { type CourseChapter } from "@/gateways/api/toc"
import { useReadingTheme } from "@/surfaces/reading/use-reading-theme"
import { useReadingPrefs } from "@/surfaces/reading/use-reading-prefs"
import { flattenChapterOutline, type LearnTreeNode, type OutlineEntry } from "@/gateways/api/outline"
import { recordEngagement } from "@/gateways/api/progress"
import type { Course } from "@/surfaces/library"
import { cn } from "@/kit/lib/utils"
import {
  DRAWER_TITLES,
  layoutNotes,
  numberOutlineItems,
  relevelHeadings,
  resolveGuidedChapter,
  type MarginNote,
  type StudyDrawer,
} from "./lib"
import { annotateNode, buildConceptRegex, masteryTint, masteryWash } from "./concept-annotations"
import { BriefingCard } from "./briefing-card"
import { ConceptPopover } from "./concept-popover"
import { MarginNotes } from "./margin-notes"
import { OutlineRail } from "./outline-rail"
import { NarrationBar, useNarration } from "./narration-bar"
import { StudyDrawerPanel } from "./study-drawer"
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
  initialDrawer?: "review" | "walk" | "lockin" | "tutor" | "listen"
}

// ---------------------------------------------------------------------------

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
  // and the mastery layer.
  const {
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
  } = useGuidedReadingData(docId, chapterKey, tree)
  // Path stepper: the chapter's stage machine (orient/read/skeleton/lockin);
  // chapter_progress is the same store the old lesson flow wrote, so history carries over.
  const { stages, loadProgress, markStage } = useChapterPath(chapterKey, docId)
  const [drawer, setDrawer] = useState<StudyDrawer>(null)
  const [notes, setNotes] = useState<MarginNote[]>([])
  const [wide, setWide] = useState(false)
  // Chapter outline (locked to THIS chapter): derived from the rendered headings,
  // so it always matches what's on screen. Scroll-spy highlights where you are.
  const [outlineItems, setOutlineItems] = useState<{ text: string; level: number }[]>([])
  // Concept highlighter wash (default on; toggle lives in the Aa reading settings).
  const [highlightConcepts, setHighlightConcepts] = useState(true)
  // Narration: play the chapter's audiobook file when one has already been generated.
  const { audioReady, playerOpen, togglePlayer } = useNarration(chapterKey, docId)

  useEffect(() => {
    try {
      setHighlightConcepts(localStorage.getItem("txt2k:concept-highlight") !== "0")
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
      return cn(masteryTint(m), highlightConcepts && masteryWash(m))
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
  }, [displayMarkdown, concepts, indexByName, theme, prefs.size, prefs.measure, masteryByKey, highlightConcepts])

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
  // "Needs" = the chapter has no briefing yet (build it from the Process tab).
  const needsPrepare = Boolean(status && !status.briefing)
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
              {preparing && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-brand" />}
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
            {/* Pipeline state for THIS chapter lives with the chapter list, not the toolbar. */}
            {(preparing || needsPrepare) && (
              <>
                {preparing ? (
                  <DropdownMenuItem disabled className="gap-2 text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing…
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="gap-2 text-xs">
                    <Wand2 className="h-3.5 w-3.5" /> Not built yet — build it from the Process tab
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            {chapters.map((c) => (
              <DropdownMenuItem
                key={c.key}
                onSelect={() => goChapter(c.key)}
                className={cn("gap-2", c.key === chapterKey && "text-brand")}
              >
                <span className="truncate">{c.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {audioReady && (
          <Button
            type="button"
            variant={playerOpen ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={togglePlayer}
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
          <span className="mr-1 shrink-0 text-micro font-semibold uppercase tracking-label text-muted-foreground">
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
          <span className="ml-1 shrink-0 text-micro tabular-nums text-muted-foreground">
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
        <NarrationBar chapterKey={chapterKey} docId={docId} onClose={togglePlayer} />
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
          {/* Chapter outline — always in view while reading, locked to THIS chapter. */}
          <OutlineRail
            items={railItems}
            activeIndex={activeRail}
            onJump={(i) => headingEls.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" })}
            paper={paper}
            mutedCls={mutedCls}
          />

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
              <BriefingCard
                key={chapterKey}
                briefing={briefing}
                oriented={!!stages.orient}
                onOrient={() => markStage("orient")}
                conceptIndexByName={indexByName}
                cardCls={cardCls}
                mutedCls={mutedCls}
                containerRef={briefingRef}
              />
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
        <ConceptPopover
          concept={activeConcept}
          mastery={activeMastery}
          x={active.x}
          y={active.y}
          onClose={() => setActive(null)}
        />
      )}

      {/* Study drawer — review / walk / lock-in / tutor / listen over the same surface. */}
      {drawer && (
        <StudyDrawerPanel
          drawer={drawer}
          title={title}
          chapterKey={chapterKey}
          docId={docId}
          tree={tree}
          onClose={() => setDrawer(null)}
          onRefreshMastery={refreshMastery}
          onProgress={loadProgress}
        />
      )}
    </div>
  )
}
