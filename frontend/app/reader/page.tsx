"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { PanelLeft, X } from "lucide-react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { ChapterReader } from "@/features/learn"
import { chaptersFromOutline, outlineToTree, resolveChapterForScope, resolveChapterFromOutline, topLevelChapters, useCourseChapters } from "@/features/learn"
import { SyllabusTree } from "@/features/learn"
import { ReadingThemeToggle } from "@/features/learn"
import { fetchOutline, fetchTocTree, type LearnTreeNode, type OutlineEntry } from "@/features/learn/api/outline"
import { fetchMastery, type MasteryResponse } from "@/features/learn/api/progress"

function ReaderInner() {
  const params = useSearchParams()
  const doc = params.get("doc") || undefined
  const initialScope = params.get("scope")
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [tree, setTree] = useState<LearnTreeNode[]>([])
  const [mastery, setMastery] = useState<MasteryResponse | null>(null)
  const [chapterKey, setChapterKey] = useState<string | null>(null)
  const [sub, setSub] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showTree, setShowTree] = useState(true)

  // Sidebar = the full outline hierarchy when available (catches slug-keyed books the
  // has_subsection tree misses); fall back to the TOC tree.
  const sidebarTree = useMemo(() => (outline.length ? outlineToTree(outline) : tree), [outline, tree])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [o, t] = await Promise.all([fetchOutline(doc), fetchTocTree(doc).catch(() => null)])
        if (!active) return
        setOutline(o.error ? [] : o.outline || [])
        setTree(t?.tree || [])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load reader")
      } finally {
        if (active) setLoading(false)
      }
    })()
    fetchMastery(doc)
      .then((m) => active && !m.error && setMastery(m))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [doc])

  // Canonical chapter list (useCourseChapters) — this popped-out reader used to derive
  // chapters from the outline/tree ONLY and had drifted from every other surface;
  // adopting the canonical fetch is a deliberate behavior fix. The outline/tree rules
  // remain the pre-fetch fallback.
  const chapterFallback = useMemo(() => {
    const chs = chaptersFromOutline(outline)
    return chs.length ? chs : topLevelChapters(tree)
  }, [outline, tree])
  const chapters = useCourseChapters(doc, chapterFallback)

  // Resolve the incoming scope once outline + chapters are up; re-resolve if the
  // URL's scope changes (the effect below resets the resolution).
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

  return (
    // Fixed overlay so the popped-out reader covers the app's global header → a clean window.
    <div className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={() => setShowTree((s) => !s)}
          aria-label="Toggle outline"
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="ml-auto flex items-center gap-1">
          <ReadingThemeToggle />
          <button
            type="button"
            onClick={() => {
              // Popped-out windows close; a reader opened as a normal tab goes home instead.
              window.close()
              setTimeout(() => {
                if (!window.closed) window.location.href = "/"
              }, 150)
            }}
            aria-label="Close reader"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : loading || !chapterKey ? (
          <p className="p-4 text-sm text-muted-foreground">{loading ? "Loading…" : "No chapters."}</p>
        ) : (
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
        )}
      </div>
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
