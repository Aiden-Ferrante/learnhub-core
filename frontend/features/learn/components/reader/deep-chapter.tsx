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
import { useToast } from "@/hooks/use-toast"
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
import { PATH_STAGES, doneMap, firstIncompleteStage } from "@/features/learn/lib/learn-path"
import {
} from "@/features/learn/components/reader/chapter-reader"
import {
  chaptersFromOutline,
  resolveChapterForScope,
  topLevelChapters,
  type CourseChapter,
} from "@/features/learn/lib/toc"
import { useReadingTheme } from "@/features/learn/hooks/use-reading-theme"
import { useReadingPrefs, type Measure } from "@/features/learn/hooks/use-reading-prefs"
import { audiobookFileUrl, getAudiobookStatus } from "@/features/learn/api/audiobook"
import { fetchChapterProgress, fetchCourseChapters, fetchDeepChapter, updateChapterStage, type DeepChapterResponse } from "@/features/learn/api/chapter"
import { type ConceptLesson } from "@/features/learn/api/concepts"
import { fetchOutline, flattenChapterOutline, type LearnTreeNode, type OutlineEntry } from "@/features/learn/api/outline"
import { cancelChapterBuild, enqueueChapterBuild, fetchChaptersReadiness, type ChapterReadiness } from "@/features/learn/api/pipeline"
import { fetchConceptMastery, recordEngagement, type ConceptMastery } from "@/features/learn/api/progress"
import { fetchReviewQueue } from "@/features/learn/api/review"
import type { Course } from "@/features/learn/lib/courses"
import { cn } from "@/lib/utils"

type DeepChapterProps = {
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

const KIND_COLOR: Record<string, string> = {
  definition: "text-kind-definition border-kind-definition/30 bg-kind-definition/10",
  theorem: "text-kind-theorem border-kind-theorem/30 bg-kind-theorem/10",
  principle: "text-kind-principle border-kind-principle/30 bg-kind-principle/10",
  result: "text-kind-result border-kind-result/30 bg-kind-result/10",
  method: "text-kind-method border-kind-method/30 bg-kind-method/10",
}

/** The reading units for the deep surface. Numbered chapters (`toc:N`) are the real units
 *  wherever they exist — outline depth 0 can be Parts/front-matter (e.g. DDIA), which carry
 *  no section content of their own. Fall back to depth-0 outline entries, then the TOC tree. */
function deepChapters(outline: OutlineEntry[], tree: LearnTreeNode[]): CourseChapter[] {
  const numbered = (outline || []).filter((e) => /^toc:\d+$/.test(e.sectionKey || ""))
  if (numbered.length) return numbered.map((e) => ({ key: e.sectionKey, title: e.title || e.sectionKey }))
  const fromOutline = chaptersFromOutline(outline)
  if (fromOutline.length) return fromOutline
  return topLevelChapters(tree)
}

/** Resolve any incoming position to a key that is GUARANTEED to be one of `chapters` —
 *  resolveChapterForScope's tree fallback can return a top-level Part node, which carries
 *  no section content of its own and would render an empty surface. */
function resolveDeepChapter(chapters: CourseChapter[], tree: LearnTreeNode[], scope: string | null): string | null {
  if (chapters.length === 0) return null
  if (!scope) return chapters[0].key
  if (chapters.some((c) => c.key === scope)) return scope
  const num = /^toc:(\d+)/.exec(scope) // e.g. reading position toc:1.2 → chapter toc:1
  if (num && chapters.some((c) => c.key === `toc:${num[1]}`)) return `toc:${num[1]}`
  const { chapterKey } = resolveChapterForScope(chapters, tree, scope)
  if (chapterKey && chapters.some((c) => c.key === chapterKey)) return chapterKey
  return chapters[0].key
}

function normHeading(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
}

/** The converter stores every heading as `##`, so chapters read as one flat wall. The document
 *  outline knows the real nesting — re-level heading lines (outside code fences) from it. */
function relevelHeadings(markdown: string, outline: OutlineEntry[], chapterKey: string | null): string {
  if (!outline?.length || !chapterKey) return markdown
  const depthByTitle = new Map<string, number>()
  let chapterDepth: number | null = null
  for (const e of outline) {
    const t = normHeading(e.title || "")
    if (t && !depthByTitle.has(t)) depthByTitle.set(t, e.listDepth)
    if (e.sectionKey === chapterKey && chapterDepth === null) chapterDepth = e.listDepth
  }
  if (chapterDepth === null) return markdown
  const base = chapterDepth
  let inFence = false
  return markdown
    .split("\n")
    .map((line) => {
      if (/^(```|~~~)/.test(line)) inFence = !inFence
      if (inFence) return line
      const m = /^(#{1,6})\s+(.*)$/.exec(line)
      if (!m) return line
      const d = depthByTitle.get(normHeading(m[2]))
      if (d === undefined) return line
      const level = Math.min(5, Math.max(2, 2 + (d - base)))
      return "#".repeat(level) + " " + m[2]
    })
    .join("\n")
}

/** Underline tint = live mastery state: unseen (quiet invite), learning, due again (amber),
 *  mastered (solid). This is where the reader meets the retention loop. */
function masteryTint(m: ConceptMastery | undefined, threshold: number): string {
  if (!m || !m.attempts) return "border-dotted border-brand/50"
  if (m.mastery >= threshold) return "border-solid border-brand/60"
  if (m.due != null && m.due <= Date.now() / 1000) return "border-dotted border-amber-400/80"
  return "border-dotted border-brand/90"
}

/** Highlighter wash (toggleable in reading settings): brightest on unseen concepts,
 *  amber when due, nearly invisible once mastered — the chapter fades as you learn it. */
function masteryWash(m: ConceptMastery | undefined, threshold: number): string {
  if (m && m.attempts) {
    if (m.mastery >= threshold) return "rounded-[3px] bg-brand/[0.05]"
    if (m.due != null && m.due <= Date.now() / 1000) return "rounded-[3px] bg-amber-400/10"
  }
  return "rounded-[3px] bg-brand/10"
}

// ---------------------------------------------------------------------------
// Inline concept annotation: concept-name mentions inside prose become live
// spans. Marked first-per-paragraph statelessly here; a post-render DOM pass
// dedupes to first-per-chapter (see the layout effect in the component).
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildConceptRegex(concepts: ConceptLesson[]): RegExp | null {
  const names = Array.from(new Set(concepts.map((c) => c.name.trim()).filter((n) => n.length >= 3)))
  if (names.length === 0) return null
  names.sort((a, b) => b.length - a.length)
  return new RegExp(`\\b(${names.map(escapeRegExp).join("|")})\\b`, "gi")
}

function annotateNode(
  children: React.ReactNode,
  regex: RegExp,
  indexByName: Map<string, number>,
  seen: Set<string>,
  classForIdx: (idx: number) => string,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      const parts: React.ReactNode[] = []
      let last = 0
      regex.lastIndex = 0
      for (let m = regex.exec(child); m; m = regex.exec(child)) {
        const name = m[1].toLowerCase()
        const idx = indexByName.get(name)
        if (idx === undefined || seen.has(name)) continue
        seen.add(name)
        parts.push(child.slice(last, m.index))
        parts.push(
          <button
            key={`${name}-${m.index}`}
            type="button"
            data-concept={idx}
            className={cn(
              "dc-term cursor-pointer rounded-sm border-b bg-transparent p-0 text-inherit hover:bg-brand/10",
              classForIdx(idx),
            )}
          >
            {m[1]}
          </button>,
        )
        last = m.index + m[1].length
      }
      if (parts.length === 0) return child
      parts.push(child.slice(last))
      return parts
    }
    // Recurse into simple inline elements (em/strong/…) but never into code,
    // links, or KaTeX output — annotating those would corrupt them.
    if (React.isValidElement(child)) {
      const tag = typeof child.type === "string" ? child.type : null
      const cls = String((child.props as { className?: string }).className ?? "")
      if (!tag || ["code", "pre", "a"].includes(tag) || /katex|math/.test(cls)) return child
      const inner = (child.props as { children?: React.ReactNode }).children
      if (inner === undefined) return child
      return React.cloneElement(child, undefined, annotateNode(inner, regex, indexByName, seen, classForIdx))
    }
    return child
  })
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

type MarginNote = { key: string; idx: number; top: number; name: string; signal: string }
type StudyDrawer = "quiz" | "review" | "exam" | "walk" | "lockin" | "tutor" | "listen" | null

const DRAWER_TITLES: Record<Exclude<StudyDrawer, null>, string> = {
  quiz: "Chapter quiz",
  review: "Review",
  exam: "Chapter exam",
  walk: "Learn — top-down walk",
  lockin: "Lock in",
  tutor: "Tutor",
  listen: "Listen",
}

/** Half the prose measure — where the margin-note column starts (center + half + gap).
 *  Mirrors MEASURE_CLASS in markdown-reader (70/85/100ch). */
const HALF_MEASURE: Record<Measure, string> = {
  narrow: "35ch",
  normal: "42.5ch",
  wide: "50ch",
}

function layoutNotes(notes: MarginNote[]): MarginNote[] {
  const sorted = [...notes].sort((a, b) => a.top - b.top)
  let floor = 0
  for (const n of sorted) {
    n.top = Math.max(n.top, floor)
    floor = n.top + 84
  }
  return sorted
}

export function DeepChapter({
  course,
  scope,
  tree,
  onBack,
  onScopeChange,
  initialDrawer,
}: DeepChapterProps) {
  const docId = course.learnDocId ?? course.id
  const [theme] = useReadingTheme()
  const [prefs, setPrefs] = useReadingPrefs()
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [outlineReady, setOutlineReady] = useState(false)
  const [chapterKey, setChapterKey] = useState<string | null>(null)
  const [data, setData] = useState<DeepChapterResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [masteryByKey, setMasteryByKey] = useState<Record<string, ConceptMastery>>({})
  const [masteredThreshold, setMasteredThreshold] = useState(0.75)
  const [dueCount, setDueCount] = useState(0)
  const [readiness, setReadiness] = useState<Record<string, ChapterReadiness>>({})
  // Path rail: {stageKey: done} from chapter_progress — the same store the old
  // lesson flow wrote, so history carries over.
  const [stages, setStages] = useState<Record<string, boolean>>({})
  const { toast } = useToast()
  const [drawer, setDrawer] = useState<StudyDrawer>(null)
  const [resumed, setResumed] = useState(false)
  // Briefing concept-chip cloud: capped at 8 until expanded.
  const [allChips, setAllChips] = useState(false)
  // Chapter scroll progress (0–100) — drives the hairline under the chrome.
  const [readPct, setReadPct] = useState(0)
  const [notes, setNotes] = useState<MarginNote[]>([])
  const [wide, setWide] = useState(false)
  // Chapter outline (locked to THIS chapter): derived from the rendered headings,
  // so it always matches what's on screen. Scroll-spy highlights where you are.
  const [outlineItems, setOutlineItems] = useState<{ text: string; level: number }[]>([])
  const [activeOutline, setActiveOutline] = useState(-1)
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const briefingRef = useRef<HTMLDivElement>(null)
  // Soft-gate counters for the two stages nothing else reports.
  const quizAnswers = useRef(0)
  const readMarked = useRef(false)
  const scrollSaveAt = useRef(0)
  const spyAt = useRef(0)
  const headingEls = useRef<HTMLElement[]>([])
  // Where the scroll-restore landed — the resumed chip dismisses once the reader
  // scrolls meaningfully away from it (they've chosen to read on).
  const restoredAt = useRef(0)
  // Last REAL reading position. When leaving a chapter the content unmounts first and the
  // browser clamps scrollTop to 0 before effect cleanups run — saving the live value there
  // would always persist 0. handleScroll keeps this ref honest (and ignores the clamp event,
  // which arrives while data is null).
  const lastScrollTop = useRef(0)

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

  // Chapter list: numbered outline chapters where available (see deepChapters).
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

  // Canonical chapter list from /api/chapters — the SAME derivation the dashboard
  // tree and the Today plan use. The outline-rule fallback only covers the moment
  // before the fetch lands (or a backend error).
  const [canonChapters, setCanonChapters] = useState<CourseChapter[] | null>(null)
  useEffect(() => {
    let alive = true
    fetchCourseChapters(docId)
      .then((r) => {
        if (alive && r.chapters?.length) setCanonChapters(r.chapters.map((c) => ({ key: c.key, title: c.title })))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [docId])

  const chapters = useMemo(
    () => canonChapters ?? deepChapters(outline, tree),
    [canonChapters, outline, tree],
  )

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
    const resolved = resolveDeepChapter(chapters, tree, scope)
    if (resolved) setChapterKey(resolved)
  }, [chapterKey, outlineReady, chapters, tree, scope])

  // Path progress for the open chapter (orient/read/skeleton/quizzes/exam/lockin).
  const loadProgress = useCallback(async () => {
    if (!chapterKey) return
    try {
      const p = await fetchChapterProgress(chapterKey, docId)
      setStages(doneMap(p.stages))
    } catch {
      // progress is supplementary — never break the reader
    }
  }, [chapterKey, docId])

  useEffect(() => {
    setStages({})
    quizAnswers.current = 0
    readMarked.current = false
    loadProgress()
  }, [loadProgress])

  const markStage = useCallback(
    (key: string) => {
      if (!chapterKey) return
      // Announce the flip — the rail's checkmark alone is easy to miss, and "what now?"
      // is the question every stage completion raises.
      if (!stages[key]) {
        const i = PATH_STAGES.findIndex((p) => p.key === key)
        const next = PATH_STAGES[i + 1]
        toast({
          title: `${PATH_STAGES[i]?.label ?? key} complete ✓`,
          description: next ? `Next: ${next.label} — ${next.lead}` : "Chapter path complete.",
        })
      }
      setStages((s) => ({ ...s, [key]: true }))
      updateChapterStage(chapterKey, docId, key, { done: true })
        .then(() => loadProgress())
        .catch(() => {})
    },
    [chapterKey, docId, loadProgress, stages, toast],
  )

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
  useEffect(() => {
    if (!anyBuildActive) return
    const t = setInterval(loadReadiness, 10000)
    return () => clearInterval(t)
  }, [anyBuildActive, loadReadiness])

  const prevBuildStatus = useRef<string | null>(null)
  useEffect(() => {
    const s = currentBuild?.status ?? null
    if (prevBuildStatus.current === "running" && s !== "running") load()
    prevBuildStatus.current = s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBuild?.status])

  const nextNightEpoch = () => {
    const d = new Date()
    d.setHours(2, 0, 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
    return Math.floor(d.getTime() / 1000)
  }

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

  const load = useCallback(async () => {
    if (!chapterKey) return
    setLoading(true)
    setError(null)
    try {
      const d = await fetchDeepChapter(docId, chapterKey)
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
    setActive(null)
    setDrawer(null)
    setNotes([])
    setResumed(false)
    setReadPct(0)
    setAllChips(false)
    load()
  }, [load])

  // Scroll: restore the saved position for this chapter once content is up, else start at top.
  // Synchronous (no rAF) — frames don't advance in hidden tabs, and the effect runs post-commit
  // anyway. The cleanup writes the final position when leaving the chapter.
  const scrollKey = `txt2k:deep-scroll:${docId}:${chapterKey ?? ""}`
  useEffect(() => {
    const box = scrollRef.current
    if (!box || !data?.markdown) return
    const saved = Number(localStorage.getItem(scrollKey) || 0)
    box.scrollTop = saved
    lastScrollTop.current = box.scrollTop
    restoredAt.current = box.scrollTop
    if (saved > 400) setResumed(true)
    return () => {
      try {
        localStorage.setItem(scrollKey, String(Math.round(lastScrollTop.current)))
      } catch {
        // storage may be unavailable
      }
    }
  }, [data?.markdown, scrollKey])

  useEffect(() => {
    if (!resumed) return
    const t = setTimeout(() => setResumed(false), 6000)
    return () => clearTimeout(t)
  }, [resumed])

  const handleScroll = () => {
    const box = scrollRef.current
    if (!box || !chapterKey || !data?.markdown) return
    lastScrollTop.current = box.scrollTop
    const denom = box.scrollHeight - box.clientHeight
    setReadPct(denom > 0 ? Math.min(100, Math.round((box.scrollTop / denom) * 100)) : 100)
    if (resumed && Math.abs(box.scrollTop - restoredAt.current) > 150) setResumed(false)
    // Read stage: reaching the tail of the chapter marks it read (soft gate).
    if (!readMarked.current && !stages.read && box.scrollTop + box.clientHeight >= box.scrollHeight * 0.92) {
      readMarked.current = true
      markStage("read")
    }
    // Outline scroll-spy (throttled): the last heading above the reading line is "here".
    const spyNow = Date.now()
    if (spyNow - spyAt.current >= 150 && headingEls.current.length) {
      spyAt.current = spyNow
      const boxTop = box.getBoundingClientRect().top
      let idx = -1
      headingEls.current.forEach((el, i) => {
        if (el.getBoundingClientRect().top - boxTop <= 96) idx = i
      })
      setActiveOutline((cur) => (cur === idx ? cur : idx))
    }
    const now = Date.now()
    if (now - scrollSaveAt.current < 300) return
    scrollSaveAt.current = now
    try {
      localStorage.setItem(scrollKey, String(Math.round(box.scrollTop)))
    } catch {
      // storage may be unavailable
    }
  }

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

  // Poll while a prepare/build pass runs so explanations stream in as they finish.
  useEffect(() => {
    if (!preparing && !building) return
    const t = setInterval(async () => {
      if (!chapterKey) return
      try {
        const d = await fetchDeepChapter(docId, chapterKey)
        setData(d)
        if (!d.status?.running) setPreparing(false)
      } catch {
        setPreparing(false)
      }
    }, 6000)
    return () => clearInterval(t)
  }, [preparing, building, docId, chapterKey])

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

  // Numbered outline, same convention as the course-dashboard syllabus: the book's own
  // numbers win (headings that already start with one aren't re-prefixed); otherwise
  // synthesize hierarchical numbers under the chapter's number (toc:2 → 2.1, 2.1.1, …).
  const numberedOutline = useMemo(() => {
    if (outlineItems.length === 0) return []
    const m = chapterKey ? /^toc:(\d+)$/.exec(chapterKey) : null
    const chapterNum = m ? m[1] : null
    // Depth is relative to the chapter heading's level — an unmatched `##` deep in the
    // chapter (e.g. an un-outlined "Summary") must not shift every section down a level.
    const baseSub = (outlineItems[0]?.level ?? 2) + 1
    const counters: number[] = []
    return outlineItems.map((it, i) => {
      if (i === 0) return { ...it, num: chapterNum ?? "" }
      if (/^\d+(\.\d+)*[\s.]/.test(it.text)) return { ...it, num: "" }
      const depth = Math.max(0, it.level - baseSub)
      counters.splice(depth + 1)
      counters[depth] = (counters[depth] || 0) + 1
      for (let d = 0; d < depth; d++) if (!counters[d]) counters[d] = 1
      const num = [chapterNum, ...counters.slice(0, depth + 1)].filter(Boolean).join(".")
      return { ...it, num }
    })
  }, [outlineItems, chapterKey])

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
            setResumed(false)
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
                  quizAnswers.current += 1
                  if (quizAnswers.current >= 5 && !stages.quizzes) markStage("quizzes")
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
