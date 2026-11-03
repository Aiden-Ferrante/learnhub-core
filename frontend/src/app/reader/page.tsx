"use client"

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { PanelLeft, X } from "lucide-react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { Button } from "@/kit/ui/button"
import { EmptyState } from "@/kit/patterns/empty-state"
import { qk, useApi, ErrorNotice } from "@/kit/data"
import { ChapterReader, ReadingThemeToggle, outlineEntries, useChapterList, useOutline } from "@/surfaces/reading"
import { SyllabusTree } from "@/surfaces/library"
import {
  chaptersFromOutline,
  outlineToTree,
  resolveChapterForScope,
  resolveChapterFromOutline,
  topLevelChapters,
} from "@/gateways/api/toc"
import { fetchTocTree, type LearnTreeNode } from "@/gateways/api/outline"
import { fetchMastery } from "@/gateways/api/progress"

const NO_TREE: LearnTreeNode[] = []

/** The pop-out reader: a full-screen window (it covers the app header) with the syllabus
 *  and one chapter at a time. Its own chrome keeps a Close control (docs/ui-spec.md §2). */
function ReaderInner() {
  const params = useSearchParams()
  const doc = params.get("doc") || undefined
  const initialScope = params.get("scope")
  const [chapterKey, setChapterKey] = useState<string | null>(null)
  const [sub, setSub] = useState<string | null>(null)
  const [showTree, setShowTree] = useState(true)

  const outlineQ = useOutline(doc)
  const outline = outlineEntries(outlineQ)
  const treeQ = useApi(qk.tocTree(doc), (signal) => fetchTocTree(doc, signal))
  const tree = treeQ.data?.tree ?? NO_TREE
  const masteryQ = useApi(qk.mastery(doc), (signal) => fetchMastery(doc, signal))
  const mastery = masteryQ.data && !masteryQ.data.error ? masteryQ.data : null
  const loading = outlineQ.status === "loading"

  // Sidebar = the full outline hierarchy when available (catches slug-keyed books the
  // has_subsection tree misses); fall back to the TOC tree.
  const sidebarTree = useMemo(() => (outline.length ? outlineToTree(outline) : tree), [outline, tree])

  // Canonical chapter list; the outline/tree rules are the pre-fetch fallback.
  const chapterFallback = useMemo(() => {
    const chs = chaptersFromOutline(outline)
    return chs.length ? chs : topLevelChapters(tree)
  }, [outline, tree])
  const { chapters, query: chaptersQ } = useChapterList(doc, chapterFallback)

  // Resolve the incoming scope once outline + chapters are up; re-resolve if the URL's
  // scope changes (the first effect resets the resolution).
  useEffect(() => {
    setChapterKey(null)
    setSub(null)
  }, [doc, initialScope])
  useEffect(() => {
    if (chapterKey || loading || chapters.length === 0) return
    const r = outline.length
      ? resolveChapterFromOutline(chapters, outline, initialScope)
      : resolveChapterForScope(chapters, tree, initialScope)
    setChapterKey(r.chapterKey)
    setSub(r.sub)
  }, [chapterKey, loading, chapters, outline, tree, initialScope])

  const onSelectScope = useCallback(
    (scope: string | null) => {
      if (!scope) return
      const r = outline.length
        ? resolveChapterFromOutline(chapters, outline, scope)
        : resolveChapterForScope(chapters, tree, scope)
      if (r.chapterKey) {
        setChapterKey(r.chapterKey)
        setSub(r.sub)
      }
    },
    [chapters, outline, tree],
  )

  const close = () => {
    // Popped-out windows close; a reader opened as a normal tab goes home instead.
    window.close()
    setTimeout(() => {
      if (!window.closed) window.location.href = "/"
    }, 150)
  }

  const sideErrors = [
    { title: "Couldn't load the syllabus", q: treeQ },
    { title: "Couldn't load your mastery", q: masteryQ },
    { title: "Couldn't load the chapter list", q: chaptersQ },
  ].filter((r) => r.q.status === "error")

  let body: ReactNode
  if (outlineQ.status === "error") {
    body = <ErrorNotice className="m-4" title="Couldn't load the reader" error={outlineQ.error} onRetry={outlineQ.retry} />
  } else if (loading) {
    body = <p className="p-4 text-sm text-muted-foreground">Loading…</p>
  } else if (!chapterKey) {
    body = <EmptyState className="m-4" title="No chapters" description="This document has no chapters to read yet." />
  } else {
    body = (
      <PanelGroup direction="horizontal" className="h-full">
        {showTree && (
          <>
            <Panel defaultSize={26} minSize={16} maxSize={45}>
              <div className="h-full border-r">
                <SyllabusTree
                  tree={sidebarTree}
                  selectedScope={chapterKey}
                  onSelectScope={onSelectScope}
                  masteryBySection={mastery?.bySection}
                  loading={loading}
                  docId={doc}
                />
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 bg-border transition-colors hover:bg-brand/40" />
          </>
        )}
        <Panel defaultSize={showTree ? 74 : 100} minSize={40}>
          <ChapterReader
            docId={doc}
            chapters={chapters}
            chapterKey={chapterKey}
            subScope={sub}
            onChapterChange={(k) => {
              setChapterKey(k)
              setSub(null)
            }}
          />
        </Panel>
      </PanelGroup>
    )
  }

  const iconBtn = "h-8 w-8 text-muted-foreground hover:text-foreground"
  return (
    // Fixed overlay so the popped-out reader covers the app's global header → a clean window.
    <div className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={iconBtn}
          onClick={() => setShowTree((s) => !s)}
          aria-label="Toggle outline"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3">
          {sideErrors.map((r) => (
            <ErrorNotice key={r.title} compact title={r.title} error={r.q.error} onRetry={r.q.retry} />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <ReadingThemeToggle />
          <Button type="button" variant="ghost" size="icon" className={iconBtn} onClick={close} aria-label="Close reader">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  )
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading reader…</div>}>
      <ReaderInner />
    </Suspense>
  )
}
