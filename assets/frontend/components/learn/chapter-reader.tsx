"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Search,
  X,
} from "lucide-react"
import { MarkdownReader } from "@/components/learn/markdown-reader"
import { Skeleton } from "@/components/ui/skeleton"
import { useReadingTheme, type ReadingTheme } from "@/hooks/use-reading-theme"
import { useReadingPrefs, type ReadingPrefs } from "@/hooks/use-reading-prefs"
import { useInBookFind } from "@/hooks/use-in-book-find"
import { cn } from "@/lib/utils"
import {
  fetchSectionContent,
  type LearnTreeNode,
  type OutlineEntry,
  type SectionContentBlock,
} from "@/lib/learn-service"

export type Chapter = { key: string; title: string }

type ChapterReaderProps = {
  docId?: string
  chapters: Chapter[]
  chapterKey: string | null
  /** A sub-section to scroll to once the chapter has loaded (e.g. a syllabus click). */
  subScope?: string | null
  onChapterChange?: (key: string) => void
  /** Reports the live "you are here" area (current heading under the fold). */
  onAreaChange?: (area: string | null) => void
  /** Reading prefs/theme — passed by the parent that owns the controls (useReadingPrefs isn't
   *  cross-instance synced); falls back to the hooks when omitted (standalone window). */
  prefs?: ReadingPrefs
  theme?: ReadingTheme
  className?: string
}

/** Numeric portion of a toc key, e.g. "toc:1.2" -> "1.2"; null for slug keys. */
function numberKeyOf(sectionKey: string): string | null {
  const rest = sectionKey.startsWith("toc:") ? sectionKey.slice(4) : sectionKey
  return /^\d+(?:\.\d+)*$/.test(rest) ? rest : null
}

/** Normalize a heading for matching (strip leading numbering, lowercase, collapse spaces). */
function normHeading(s: string): string {
  return (s || "")
    .replace(/^\s*\d+(?:\.\d+)*\s*[.:)\-–]?\s*/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** The chapter-scoped reading surface: loads ONE chapter at a time (not the whole book), with a
 *  live "you are here" breadcrumb, prev/next chapter, and find. Reused by the embedded book
 *  reader and the popped-out /reader window. */
export function ChapterReader({
  docId,
  chapters,
  chapterKey,
  subScope,
  onChapterChange,
  onAreaChange,
  prefs: prefsProp,
  theme: themeProp,
  className,
}: ChapterReaderProps) {
  const [markdown, setMarkdown] = useState<string>("")
  const [blocks, setBlocks] = useState<SectionContentBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)
  const [page, setPage] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [showTop, setShowTop] = useState(false)

  const [hookTheme] = useReadingTheme()
  const [hookPrefs] = useReadingPrefs()
  const readingTheme = themeProp ?? hookTheme
  const prefs = prefsProp ?? hookPrefs
  const contentRef = useRef<HTMLDivElement>(null)
  const find = useInBookFind(contentRef)
  const findInputRef = useRef<HTMLInputElement>(null)
  const pendingSub = useRef<string | null>(null)

  const index = useMemo(
    () => chapters.findIndex((c) => c.key === chapterKey),
    [chapters, chapterKey],
  )
  const chapter = index >= 0 ? chapters[index] : null
  const prev = index > 0 ? chapters[index - 1] : null
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null

  // heading (normalized) -> its 1-based page, so the breadcrumb can show the page you're on.
  const pageByHeading = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of blocks) {
      if (b.heading && b.pageStart != null) m.set(normHeading(b.heading), b.pageStart)
    }
    return m
  }, [blocks])

  // Load the current chapter's markdown (chapter + its descendants, rolled up).
  useEffect(() => {
    if (!chapterKey) return
    let cancelled = false
    setLoading(true)
    setError(null)
    pendingSub.current = subScope ?? null
    fetchSectionContent(chapterKey, docId)
      .then((res) => {
        if (cancelled) return
        if (res.error) setError(res.error)
        else {
          setMarkdown(res.markdown || "")
          setBlocks(res.blocks || [])
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load chapter"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [chapterKey, subScope, docId])

  const scrollToScope = useCallback((scope: string) => {
    const el = contentRef.current
    if (!el) return
    const headings = Array.from(el.querySelectorAll("h1,h2,h3,h4,h5,h6")) as HTMLElement[]
    const norm = (s: string) => s.replace(/\s+/g, " ").trim()
    const num = numberKeyOf(scope)
    let target: HTMLElement | undefined
    if (num) {
      const re = new RegExp(`^${num.replace(/\./g, "\\.")}(?:\\D|$)`)
      target = headings.find((h) => re.test(norm(h.textContent || "")))
    }
    if (!target) {
      const label = norm((scope.startsWith("toc:") ? scope.slice(4) : scope).toLowerCase())
      target = headings.find((h) => norm(h.textContent || "").toLowerCase().includes(label))
    }
    target?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  // The "you are here" area = the last heading scrolled past the top of the viewport.
  const updateArea = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    const top = el.getBoundingClientRect().top + 96
    const headings = Array.from(el.querySelectorAll("h1,h2,h3,h4,h5,h6")) as HTMLElement[]
    let current: string | null = null
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= top) current = (h.textContent || "").replace(/\s+/g, " ").trim()
      else break
    }
    setArea(current)
    setPage(current ? pageByHeading.get(normHeading(current)) ?? null : null)
    onAreaChange?.(current)
  }, [onAreaChange, pageByHeading])

  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onScroll = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    setProgress(max > 0 ? (el.scrollTop / max) * 100 : 0)
    setShowTop(el.scrollTop > 600)
    requestAnimationFrame(updateArea)
    if (chapterKey) {
      clearTimeout(scrollSaveTimer.current)
      const top = el.scrollTop
      scrollSaveTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(`txt2k:chapter-scroll:${docId ?? ""}:${chapterKey}`, String(top))
        } catch {
          /* storage unavailable */
        }
      }, 200)
    }
  }, [updateArea, docId, chapterKey])

  // After a chapter renders: scroll to the requested sub-scope (or top) and seed the area.
  useEffect(() => {
    if (loading || !markdown) return
    const id = requestAnimationFrame(() => {
      const sub = pendingSub.current
      pendingSub.current = null
      if (sub) {
        scrollToScope(sub)
      } else {
        // Resume where you left off in this chapter (or top on first visit).
        let saved = 0
        try {
          saved = Number(localStorage.getItem(`txt2k:chapter-scroll:${docId ?? ""}:${chapterKey}`)) || 0
        } catch {
          saved = 0
        }
        contentRef.current?.scrollTo({ top: saved > 0 ? saved : 0 })
      }
      updateArea()
    })
    return () => cancelAnimationFrame(id)
  }, [loading, markdown, scrollToScope, updateArea, docId, chapterKey])

  useEffect(() => {
    if (find.open) findInputRef.current?.focus()
  }, [find.open])

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Sticky "you are here" bar + chapter nav */}
      <div className="relative flex items-center gap-2 border-b bg-card/80 px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => prev && onChapterChange?.(prev.key)}
          disabled={!prev}
          aria-label="Previous chapter"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <span className="truncate font-medium">{chapter?.title || "Chapter"}</span>
          {area && area !== chapter?.title && (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-muted-foreground">{area}</span>
            </>
          )}
        </div>
        {page != null && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
            p.{page}
          </span>
        )}
        {index >= 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {index + 1}/{chapters.length}
          </span>
        )}
        <button
          type="button"
          onClick={() => next && onChapterChange?.(next.key)}
          disabled={!next}
          aria-label="Next chapter"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={find.open ? find.close : find.openFind}
          aria-label="Find in chapter"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 bg-nvidia-green transition-[width] duration-150"
          style={{ width: `${progress}%` }}
          aria-hidden
        />
      </div>

      <div className="relative min-h-0 flex-1">
        {find.open && (
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1.5 shadow-md">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={findInputRef}
              value={find.query}
              onChange={(e) => find.search(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  e.shiftKey ? find.prev() : find.next()
                }
              }}
              placeholder="Find in chapter"
              className="w-36 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <span className="min-w-[3.5rem] text-right text-xs tabular-nums text-muted-foreground">
              {find.query ? `${find.count ? find.active + 1 : 0}/${find.count}` : ""}
            </span>
            <button type="button" onClick={find.prev} disabled={find.count === 0} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" onClick={find.next} disabled={find.count === 0} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40">
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" onClick={find.close} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div
          ref={contentRef}
          onScroll={onScroll}
          className={cn(
            "h-full overflow-auto px-6 py-5 transition-colors",
            readingTheme === "paper" && "reading-surface-paper",
          )}
        >
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : loading ? (
            <div className="space-y-3">
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : markdown.trim() ? (
            <MarkdownReader
              content={markdown}
              theme={readingTheme}
              proseSize={prefs.size}
              measure={prefs.measure}
            />
          ) : (
            <p className="text-sm text-muted-foreground">This chapter has no text.</p>
          )}
        </div>

        {showTop && (
          <button
            type="button"
            onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-full border bg-popover px-3 py-1.5 text-xs font-medium shadow-md hover:bg-muted"
          >
            <ArrowUp className="h-3.5 w-3.5" /> Top
          </button>
        )}
      </div>
    </div>
  )
}

type TreeNodeLike = {
  sectionKey: string | null
  label: string
  title?: string | null
  isSection: boolean
  children: TreeNodeLike[]
}

/** Top-level chapters from the TOC tree (the sections you read one at a time). */
export function topLevelChapters(tree: TreeNodeLike[]): Chapter[] {
  const out: Chapter[] = []
  for (const node of tree || []) {
    if (node.isSection && node.sectionKey) {
      out.push({ key: node.sectionKey, title: node.title || node.label || node.sectionKey })
    }
  }
  return out
}

function subtreeContains(node: TreeNodeLike, key: string): boolean {
  if (node.sectionKey === key) return true
  return (node.children || []).some((c) => subtreeContains(c, key))
}

/** Map any clicked section to the chapter that should load + the sub-scope to scroll to. */
export function resolveChapterForScope(
  chapters: Chapter[],
  tree: TreeNodeLike[],
  scope: string | null,
): { chapterKey: string | null; sub: string | null } {
  if (!scope) return { chapterKey: chapters[0]?.key ?? null, sub: null }
  if (chapters.some((c) => c.key === scope)) return { chapterKey: scope, sub: null }
  for (const node of tree || []) {
    if (node.sectionKey && subtreeContains(node, scope)) return { chapterKey: node.sectionKey, sub: scope }
  }
  const num = numberKeyOf(scope)
  if (num) {
    const ch = "toc:" + num.split(".")[0]
    if (chapters.some((c) => c.key === ch)) return { chapterKey: ch, sub: scope }
  }
  return { chapterKey: chapters[0]?.key ?? null, sub: scope }
}

type OutlineLike = { sectionKey: string; title: string; listDepth: number }

/** Chapters = the top-level (listDepth 0) outline entries — the document's real chapters/parts,
 *  which the TOC tree misses for slug-keyed (unnumbered) books. */
export function chaptersFromOutline(outline: OutlineLike[]): Chapter[] {
  const seen = new Set<string>()
  const out: Chapter[] = []
  for (const e of outline || []) {
    if (e.listDepth === 0 && e.sectionKey && !seen.has(e.sectionKey)) {
      seen.add(e.sectionKey)
      out.push({ key: e.sectionKey, title: e.title || e.sectionKey })
    }
  }
  return out
}

/** Build a nested TOC tree from the flat outline (nesting by listDepth) for the reader sidebar —
 *  the full chapter/section hierarchy even for slug-keyed books the has_subsection tree misses. */
export function outlineToTree(outline: OutlineEntry[]): LearnTreeNode[] {
  const roots: LearnTreeNode[] = []
  const stack: { depth: number; node: LearnTreeNode }[] = []
  let i = 0
  for (const e of outline || []) {
    if (!e.sectionKey) continue
    const node: LearnTreeNode = {
      id: `${e.sectionKey}#${i++}`,
      label: e.title || e.sectionKey,
      title: e.title ?? null,
      sectionKey: e.sectionKey,
      isSection: true,
      children: [],
    }
    const depth = e.listDepth ?? 0
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].node.children.push(node)
    stack.push({ depth, node })
  }
  return roots
}

/** Map a clicked section to its chapter using the flat outline: walk back to the nearest
 *  preceding listDepth-0 entry. */
export function resolveChapterFromOutline(
  chapters: Chapter[],
  outline: OutlineLike[],
  scope: string | null,
): { chapterKey: string | null; sub: string | null } {
  if (!scope) return { chapterKey: chapters[0]?.key ?? null, sub: null }
  if (chapters.some((c) => c.key === scope)) return { chapterKey: scope, sub: null }
  const list = outline || []
  const idx = list.findIndex((e) => e.sectionKey === scope)
  if (idx >= 0) {
    for (let i = idx; i >= 0; i--) {
      if (list[i].listDepth === 0 && chapters.some((c) => c.key === list[i].sectionKey)) {
        return { chapterKey: list[i].sectionKey, sub: scope }
      }
    }
  }
  return { chapterKey: chapters[0]?.key ?? null, sub: scope }
}
