"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { EmptyState } from "@/kit/patterns/empty-state"
import { qk, useApi, AsyncView, ApiError } from "@/kit/data"
import type { CourseChapter } from "@/gateways/api/chapter"
import { numberKeyOf } from "@/gateways/api/toc"
import { fetchSectionContent } from "@/gateways/api/content"
import { MarkdownReader } from "@/surfaces/reading/markdown-reader"
import { ChapterFindBar } from "@/surfaces/reading/chapter-find-bar"
import { useReadingTheme, type ReadingTheme } from "@/surfaces/reading/use-reading-theme"
import { useReadingPrefs, type ReadingPrefs } from "@/surfaces/reading/use-reading-prefs"
import { useInBookFind } from "@/surfaces/reading/use-in-book-find"
import { cn } from "@/kit/lib/utils"

type ChapterReaderProps = {
  docId?: string
  chapters: CourseChapter[]
  chapterKey: string | null
  /** A sub-section to scroll to once the chapter has loaded (e.g. a syllabus click). */
  subScope?: string | null
  onChapterChange?: (key: string) => void
  /** Reports the live "you are here" area (current heading under the fold). */
  onAreaChange?: (area: string | null) => void
  /** Reading prefs/theme, passed by the parent that owns the controls (useReadingPrefs isn't
   *  cross-instance synced); falls back to the hooks when omitted (standalone window). */
  prefs?: ReadingPrefs
  theme?: ReadingTheme
  className?: string
}

/** Normalize a heading for matching (strip leading numbering, lowercase, collapse spaces). */
function normHeading(s: string): string {
  return (s || "")
    .replace(/^\s*\d+(?:\.\d+)*\s*[.:)\-–]?\s*/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

const scrollStoreKey = (docId: string | undefined, chapterKey: string | null) =>
  `txt2k:chapter-scroll:${docId ?? ""}:${chapterKey}`

function ChapterSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading chapter">
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}

/** The chapter-scoped reading surface: loads ONE chapter at a time (not the whole book) as a
 *  keyed query, with a live "you are here" breadcrumb, prev/next chapter, and find. Reused by
 *  the embedded book reader and the popped-out /reader window. */
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
  const pendingSub = useRef<string | null>(null)

  // The chapter's markdown (chapter + its descendants, rolled up). An `error` envelope is a
  // failure like any other, so it lands in the error state with Retry.
  const content = useApi(
    qk.sectionContent(docId, chapterKey ?? ""),
    async (signal) => {
      const res = await fetchSectionContent(chapterKey ?? "", docId, signal)
      if (res.error) throw new ApiError(422, res.error)
      return { markdown: res.markdown || "", blocks: res.blocks || [] }
    },
    { enabled: Boolean(chapterKey) },
  )
  const markdown = content.data?.markdown ?? ""

  const index = useMemo(() => chapters.findIndex((c) => c.key === chapterKey), [chapters, chapterKey])
  const chapter = index >= 0 ? chapters[index] : null
  const prev = index > 0 ? chapters[index - 1] : null
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null

  // heading (normalized) -> its 1-based page, so the breadcrumb can show the page you're on.
  const pageByHeading = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of content.data?.blocks ?? []) {
      if (b.heading && b.pageStart != null) m.set(normHeading(b.heading), b.pageStart)
    }
    return m
  }, [content.data])

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
          localStorage.setItem(scrollStoreKey(docId, chapterKey), String(top))
        } catch {
          /* storage unavailable */
        }
      }, 200)
    }
  }, [updateArea, docId, chapterKey])

  // A new chapter or sub-scope request: remember where to land once the text is up.
  useEffect(() => {
    pendingSub.current = subScope ?? null
  }, [chapterKey, subScope, docId])

  // After a chapter renders: scroll to the requested sub-scope (or the saved spot) and seed
  // the area. Declared after the effect above so a sub-scope change is seen in one commit.
  useEffect(() => {
    if (!markdown) return
    const id = requestAnimationFrame(() => {
      const sub = pendingSub.current
      pendingSub.current = null
      if (sub) {
        scrollToScope(sub)
      } else {
        // Resume where you left off in this chapter (or top on first visit).
        let saved = 0
        try {
          saved = Number(localStorage.getItem(scrollStoreKey(docId, chapterKey))) || 0
        } catch {
          saved = 0
        }
        contentRef.current?.scrollTo({ top: saved > 0 ? saved : 0 })
      }
      updateArea()
    })
    return () => cancelAnimationFrame(id)
  }, [markdown, subScope, scrollToScope, updateArea, docId, chapterKey])

  const navBtn = "h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Sticky "you are here" bar + chapter nav */}
      <div className="relative flex items-center gap-2 border-b bg-card/80 px-3 py-2 backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={navBtn}
          onClick={() => prev && onChapterChange?.(prev.key)}
          disabled={!prev}
          aria-label="Previous chapter"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
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
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-micro tabular-nums text-muted-foreground">
            p.{page}
          </span>
        )}
        {index >= 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {index + 1}/{chapters.length}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={navBtn}
          onClick={() => next && onChapterChange?.(next.key)}
          disabled={!next}
          aria-label="Next chapter"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={navBtn}
          onClick={find.open ? find.close : find.openFind}
          aria-label="Find in chapter"
        >
          <Search className="h-4 w-4" />
        </Button>
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 bg-brand transition-[width] duration-150"
          style={{ width: `${progress}%` }}
          aria-hidden
        />
      </div>

      <div className="relative min-h-0 flex-1">
        {find.open && <ChapterFindBar find={find} />}

        <div
          ref={contentRef}
          onScroll={onScroll}
          className={cn(
            "h-full overflow-auto px-6 py-5 transition-colors",
            readingTheme === "paper" && "reading-surface-paper",
          )}
        >
          {chapterKey ? (
            <AsyncView
              q={content}
              skeleton={<ChapterSkeleton />}
              errorTitle="Couldn't load this chapter"
              isEmpty={(d) => !d.markdown.trim()}
              empty={<EmptyState title="This chapter has no text" />}
            >
              {(d) => (
                <MarkdownReader content={d.markdown} theme={readingTheme} proseSize={prefs.size} measure={prefs.measure} />
              )}
            </AsyncView>
          ) : (
            <ChapterSkeleton />
          )}
        </div>

        {showTop && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute bottom-4 right-4 z-10 h-auto gap-1 rounded-full bg-popover px-3 py-1.5 text-xs shadow-md hover:bg-muted"
          >
            <ArrowUp className="h-3.5 w-3.5" /> Top
          </Button>
        )}
      </div>
    </div>
  )
}
