"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ExternalLink, PictureInPicture2 } from "lucide-react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { ChapterReader } from "@/surfaces/reading/chapter-reader"
import { chaptersFromOutline, outlineToTree, resolveChapterForScope, resolveChapterFromOutline, topLevelChapters, type CourseChapter } from "@/gateways/api/toc"
import { ReadingThemeToggle } from "@/surfaces/reading/reading-theme-toggle"
import { ReadingControls } from "@/surfaces/reading/reading-controls"
import { SyllabusTree } from "@/surfaces/library"
import { useReadingTheme } from "@/surfaces/reading/use-reading-theme"
import { useReadingPrefs } from "@/surfaces/reading/use-reading-prefs"
import { useCourseChapters } from "@/surfaces/library"
import { fetchOutline, type LearnTreeNode, type OutlineEntry } from "@/gateways/api/outline"
import { type MasteryResponse } from "@/gateways/api/progress"
import type { Course } from "@/surfaces/library"

type BookReaderProps = {
  course: Course
  tree: LearnTreeNode[]
  loading: boolean
  mastery: MasteryResponse | null
  onBack: () => void
  onSectionRead?: (sectionKey: string) => void
}

/** Chapter-scoped book reader: loads one chapter at a time (not the whole PDF), with a live
 *  "you are here" breadcrumb (in ChapterReader), the syllabus, and pop-out / floating windows. */
export function BookReader({
  course,
  tree,
  loading,
  mastery,
  onBack,
  onSectionRead,
}: BookReaderProps) {
  const [theme] = useReadingTheme()
  const [prefs, setPrefs] = useReadingPrefs()
  const [focus, setFocus] = useState(false)
  const [chapterKey, setChapterKey] = useState<string | null>(null)
  const [sub, setSub] = useState<string | null>(null)
  const [pipOk, setPipOk] = useState(false)
  const [outline, setOutline] = useState<OutlineEntry[]>([])

  // Canonical chapters (see useCourseChapters) — the outline/tree rules only bridge
  // the moment before the fetch lands.
  const chapterFallback = useMemo(() => {
    const fromOutline = chaptersFromOutline(outline)
    return fromOutline.length ? fromOutline : topLevelChapters(tree)
  }, [outline, tree])
  const chapters = useCourseChapters(course.learnDocId ?? course.id, chapterFallback)
  // Sidebar shows the full outline hierarchy when available (else the TOC tree).
  const sidebarTree = useMemo(() => (outline.length ? outlineToTree(outline) : tree), [outline, tree])
  const lastKey = `txt2k:book-chapter:${course.learnDocId ?? course.id}`

  useEffect(() => {
    setPipOk(typeof window !== "undefined" && "documentPictureInPicture" in window)
  }, [])

  // Pin the reader pane to the viewport (same trick as the PDF view and deep chapter)
  // instead of a fixed 640px letterbox — the reader owns whatever height the screen has.
  const paneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = paneRef.current
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

  useEffect(() => {
    let active = true
    fetchOutline(course.learnDocId)
      .then((o) => active && !o.error && setOutline(o.outline || []))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [course.learnDocId])

  // Pick the chapter once the tree is known: restore the last one, else the first.
  useEffect(() => {
    if (chapterKey || chapters.length === 0) return
    let restored: string | null = null
    try {
      restored = window.localStorage.getItem(lastKey)
    } catch {
      /* ignore */
    }
    setChapterKey(restored && chapters.some((c) => c.key === restored) ? restored : chapters[0].key)
  }, [chapters, chapterKey, lastKey])

  const goChapter = useCallback(
    (key: string, subScope: string | null) => {
      setChapterKey(key)
      setSub(subScope)
      try {
        window.localStorage.setItem(lastKey, key)
      } catch {
        /* ignore */
      }
      onSectionRead?.(subScope || key)
    },
    [lastKey, onSectionRead],
  )

  const onSelectScope = useCallback(
    (scope: string | null) => {
      if (!scope) return
      const r = outline.length
        ? resolveChapterFromOutline(chapters, outline, scope)
        : resolveChapterForScope(chapters, tree, scope)
      if (r.chapterKey) goChapter(r.chapterKey, r.sub)
    },
    [chapters, outline, tree, goChapter],
  )

  const readerUrl = () =>
    `/reader?doc=${encodeURIComponent(course.learnDocId ?? "")}&scope=${encodeURIComponent(chapterKey ?? "")}`

  const popOut = () =>
    window.open(readerUrl(), "txt2k-reader", "width=900,height=1000,menubar=no,toolbar=no")

  const popFloat = async () => {
    const w = window as unknown as {
      documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> }
    }
    if (!w.documentPictureInPicture) {
      popOut()
      return
    }
    try {
      const pip = await w.documentPictureInPicture.requestWindow({ width: 460, height: 760 })
      pip.document.body.style.margin = "0"
      const iframe = pip.document.createElement("iframe")
      iframe.src = readerUrl()
      iframe.style.cssText = "border:0;width:100%;height:100vh"
      pip.document.body.appendChild(iframe)
    } catch {
      popOut()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to course
        </button>
        <div className="flex items-center gap-2">
          <span className="mr-1 truncate text-sm font-medium" title={course.title}>{course.title}</span>
          {pipOk && (
            <button
              type="button"
              onClick={popFloat}
              aria-label="Float reader (picture-in-picture)"
              title="Float (always-on-top)"
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={popOut}
            aria-label="Pop out reader"
            title="Pop out to a new window"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <ReadingThemeToggle />
          <ReadingControls
            prefs={prefs}
            onChange={setPrefs}
            focus={focus}
            onToggleFocus={() => setFocus((f) => !f)}
          />
        </div>
      </div>

      <div ref={paneRef} className="overflow-hidden rounded-lg border bg-card">
        <PanelGroup direction="horizontal">
          {!focus && (
            <>
              <Panel defaultSize={28} minSize={18} maxSize={42}>
                <div className="h-full border-r">
                  <SyllabusTree
                    tree={sidebarTree}
                    selectedScope={chapterKey}
                    onSelectScope={onSelectScope}
                    masteryBySection={mastery?.bySection}
                    loading={loading}
                    docId={course.learnDocId}
                  />
                </div>
              </Panel>
              <PanelResizeHandle className="w-1 bg-border transition-colors hover:bg-brand/40" />
            </>
          )}
          <Panel defaultSize={focus ? 100 : 72} minSize={40}>
            {chapterKey ? (
              <ChapterReader
                docId={course.learnDocId}
                chapters={chapters}
                chapterKey={chapterKey}
                subScope={sub}
                prefs={prefs}
                theme={theme}
                onChapterChange={(k) => goChapter(k, null)}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "No chapters yet — process this document to read it here."}
              </div>
            )}
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
