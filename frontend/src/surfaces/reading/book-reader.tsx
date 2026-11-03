"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink, PictureInPicture2 } from "lucide-react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { Button } from "@/kit/ui/button"
import { EmptyState } from "@/kit/patterns/empty-state"
import { ErrorNotice } from "@/kit/data"
import { ChapterReader } from "@/surfaces/reading/chapter-reader"
import {
  chaptersFromOutline,
  outlineToTree,
  resolveChapterForScope,
  resolveChapterFromOutline,
  topLevelChapters,
} from "@/gateways/api/toc"
import { ReadingThemeToggle } from "@/surfaces/reading/reading-theme-toggle"
import { ReadingControls } from "@/surfaces/reading/reading-controls"
import { SyllabusTree } from "@/surfaces/library"
import { useReadingTheme } from "@/surfaces/reading/use-reading-theme"
import { useReadingPrefs } from "@/surfaces/reading/use-reading-prefs"
import { outlineEntries, useChapterList, useOutline } from "@/surfaces/reading/use-reading-data"
import { useViewportPin } from "@/surfaces/reading/use-viewport-pin"
import { type LearnTreeNode } from "@/gateways/api/outline"
import { type MasteryResponse } from "@/gateways/api/progress"
import type { Course } from "@/surfaces/library"

type BookReaderProps = {
  course: Course
  tree: LearnTreeNode[]
  loading: boolean
  mastery: MasteryResponse | null
  onSectionRead?: (sectionKey: string) => void
}

/** Floating always-on-top window where the browser has Document Picture-in-Picture, else
 *  a plain pop-out window. */
async function openFloating(url: string, popOut: () => void) {
  const w = window as unknown as {
    documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> }
  }
  if (!w.documentPictureInPicture) return popOut()
  try {
    const pip = await w.documentPictureInPicture.requestWindow({ width: 460, height: 760 })
    pip.document.body.style.margin = "0"
    const iframe = pip.document.createElement("iframe")
    iframe.src = url
    iframe.style.cssText = "border:0;width:100%;height:100vh"
    pip.document.body.appendChild(iframe)
  } catch {
    popOut() // the browser refused the PiP window; fall back to a normal one
  }
}

/** Chapter-scoped book reader: loads one chapter at a time (not the whole PDF), with a live
 *  "you are here" breadcrumb (in ChapterReader), the syllabus, and pop-out / floating
 *  windows. The way back to the course is the breadcrumb (docs/ui-spec.md §2). */
export function BookReader({ course, tree, loading, mastery, onSectionRead }: BookReaderProps) {
  const docId = course.learnDocId ?? course.id
  const [theme] = useReadingTheme()
  const [prefs, setPrefs] = useReadingPrefs()
  const [focus, setFocus] = useState(false)
  const [chapterKey, setChapterKey] = useState<string | null>(null)
  const [sub, setSub] = useState<string | null>(null)
  const [pipOk, setPipOk] = useState(false)
  const outlineQ = useOutline(course.learnDocId)
  const outline = outlineEntries(outlineQ)

  // Canonical chapters; the outline/tree rules only bridge the moment before the fetch lands.
  const chapterFallback = useMemo(() => {
    const fromOutline = chaptersFromOutline(outline)
    return fromOutline.length ? fromOutline : topLevelChapters(tree)
  }, [outline, tree])
  const { chapters, query: chaptersQ } = useChapterList(docId, chapterFallback)
  // Sidebar shows the full outline hierarchy when available (else the TOC tree).
  const sidebarTree = useMemo(() => (outline.length ? outlineToTree(outline) : tree), [outline, tree])
  const lastKey = `txt2k:book-chapter:${docId}`

  useEffect(() => {
    setPipOk(typeof window !== "undefined" && "documentPictureInPicture" in window)
  }, [])

  // Pin the reader pane to the viewport instead of a fixed letterbox.
  const paneRef = useRef<HTMLDivElement>(null)
  useViewportPin(paneRef)

  // Pick the chapter once the list is known: restore the last one, else the first.
  useEffect(() => {
    if (chapterKey || chapters.length === 0) return
    let restored: string | null = null
    try {
      restored = window.localStorage.getItem(lastKey)
    } catch {
      /* storage unavailable */
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
        /* storage unavailable */
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
  const popOut = () => {
    window.open(readerUrl(), "txt2k-reader", "width=900,height=1000,menubar=no,toolbar=no")
  }
  const iconBtn = "h-8 w-8 text-muted-foreground hover:text-foreground"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium" title={course.title}>
          {course.title}
        </span>
        <div className="flex items-center gap-2">
          {pipOk && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={iconBtn}
              onClick={() => void openFloating(readerUrl(), popOut)}
              aria-label="Float reader (picture-in-picture)"
              title="Float (always-on-top)"
            >
              <PictureInPicture2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconBtn}
            onClick={popOut}
            aria-label="Pop out reader"
            title="Pop out to a new window"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <ReadingThemeToggle />
          <ReadingControls prefs={prefs} onChange={setPrefs} focus={focus} onToggleFocus={() => setFocus((f) => !f)} />
        </div>
      </div>

      {outlineQ.status === "error" && (
        <ErrorNotice compact title="Couldn't load the outline" error={outlineQ.error} onRetry={outlineQ.retry} />
      )}
      {chaptersQ.status === "error" && chapters.length > 0 && (
        <ErrorNotice compact title="Couldn't load the chapter list" error={chaptersQ.error} onRetry={chaptersQ.retry} />
      )}

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
            ) : chaptersQ.status === "error" ? (
              <ErrorNotice className="m-6" title="Couldn't load the chapters" error={chaptersQ.error} onRetry={chaptersQ.retry} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {loading || chaptersQ.status === "loading" ? (
                  "Loading…"
                ) : (
                  <EmptyState title="No chapters yet" description="Process this document to read it here." />
                )}
              </div>
            )}
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
