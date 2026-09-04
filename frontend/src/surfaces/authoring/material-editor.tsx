"use client"

/** The material editor — changing the words a course is built from, in the shape you read them.
 *
 * Blocks render through the READER's own renderer, with the reader's theme and prose
 * settings, so this page is not a preview of the course — it is the course, with edit
 * handles. Reusing `MarkdownReader` rather than approximating it is the point: a lookalike
 * drifts the first time the reader's typography changes, and then the thing you edited stops
 * matching the thing you study.
 *
 * Editing is per block because a block's key is what this course's material mapping and every
 * concept anchor point at; re-splitting a document on save would break both. A block is a
 * section of the chapter, so the seams you see here are the seams the extractor sees too.
 *
 * Every save answers one question, which the two buttons make explicit: a fix to the BOOK —
 * the OCR damage and mangled tables every course cut from it inherits — or your own wording
 * for THIS course, copy-on-write and safe from a later fix to the book underneath it.
 *
 * Editing invalidates what was extracted from the text. Sections whose concepts predate their
 * last edit are marked; rebuilding stays yours to trigger, because a chapter pass is minutes
 * of local model time and should not ambush a typo fix.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, PencilLine, RotateCcw, TriangleAlert } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { displaySectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { MarkdownReader, useReadingPrefs, useReadingTheme } from "@/surfaces/reading"
import {
  fetchSectionMaterial,
  fetchStaleSections,
  revertBlock,
  saveBlock,
  type MaterialBlock,
} from "@/gateways/api/editing"

type MaterialEditorProps = {
  /** The ACTIVE version — edits with target 'version' land here. */
  docId: string
  tree: LearnTreeNode[]
  loading: boolean
}

export function MaterialEditor({ docId, tree, loading }: MaterialEditorProps) {
  const chapters = useMemo(() => tree.filter((n) => n.sectionKey), [tree])
  const [theme] = useReadingTheme()
  const [prefs] = useReadingPrefs()

  const [scope, setScope] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<MaterialBlock[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [loadingBlocks, setLoadingBlocks] = useState(false)
  const [stale, setStale] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!scope && chapters.length) setScope(chapters[0].sectionKey)
  }, [chapters, scope])

  const loadStale = useCallback(() => {
    fetchStaleSections(docId)
      .then((d) => setStale(d.staleSections ?? []))
      .catch(() => setStale([]))
  }, [docId])

  useEffect(loadStale, [loadStale])

  const loadBlocks = useCallback(
    async (s: string) => {
      setLoadingBlocks(true)
      setError(null)
      try {
        const data = await fetchSectionMaterial(docId, s)
        setBlocks(data.blocks ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load this chapter's material")
        setBlocks([])
      } finally {
        setLoadingBlocks(false)
      }
    },
    [docId],
  )

  useEffect(() => {
    if (scope) {
      // An open editor belongs to the chapter it was opened in — leaving closes it rather
      // than carrying an unsaved draft somewhere it does not apply.
      setEditingKey(null)
      void loadBlocks(scope)
    }
  }, [scope, loadBlocks])

  async function run(key: string, action: () => Promise<unknown>) {
    setBusyKey(key)
    setError(null)
    try {
      await action()
      setEditingKey(null)
      if (scope) await loadBlocks(scope)
      loadStale()
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save")
    } finally {
      setBusyKey(null)
    }
  }

  const staleHere = scope ? stale.includes(scope) : false

  return (
    <div className="flex gap-4">
      {/* The chapter rail, in the same order and naming the syllabus uses. */}
      <nav className="w-56 shrink-0 space-y-0.5">
        {loading && !chapters.length
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)
          : chapters.map((c) => {
              const key = c.sectionKey as string
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setScope(key)}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                    key === scope ? "bg-muted font-medium" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {displaySectionTitle(c.label, c.title)}
                  </span>
                  {stale.includes(key) && (
                    <TriangleAlert className="h-3 w-3 shrink-0 text-status-due" />
                  )}
                </button>
              )
            })}
      </nav>

      <div className="min-w-0 flex-1 space-y-2">
        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {staleHere && (
          <p className="flex items-start gap-2 rounded border border-status-due/40 bg-status-due/5 px-3 py-2 text-xs">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-due" />
            <span>
              This chapter&rsquo;s material changed after its concepts were built. Rebuild it from
              the Process tab when you&rsquo;re ready — your review history carries across.
            </span>
          </p>
        )}

        {loadingBlocks ? (
          <div className="space-y-3">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : !blocks.length ? (
          <p className="text-sm text-muted-foreground">
            This chapter has no material in this course.
          </p>
        ) : (
          blocks.map((b) => {
            const busy = busyKey === b.blockKey
            const editing = editingKey === b.blockKey
            return (
              <section
                key={b.blockKey}
                className={`group relative rounded-lg border transition-colors ${
                  editing ? "border-brand/50" : "border-transparent hover:border-border"
                }`}
              >
                {!editing && (
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {b.isRewritten && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-micro text-primary">
                        rewritten
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs shadow-sm"
                      onClick={() => {
                        setEditingKey(b.blockKey)
                        setDraft(b.markdown)
                      }}
                    >
                      <PencilLine className="h-3 w-3" />
                      Edit
                    </Button>
                    {b.isRewritten && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs shadow-sm"
                        disabled={busy}
                        title="Drop this course's rewrite and read the book again"
                        onClick={() => void run(b.blockKey, () => revertBlock(docId, b.blockKey))}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}

                {editing ? (
                  <div className="space-y-2 p-3">
                    <textarea
                      value={draft}
                      autoFocus
                      spellCheck={false}
                      onChange={(e) => setDraft(e.target.value)}
                      className="h-80 w-full resize-y rounded border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={busy || draft === b.markdown}
                        onClick={() =>
                          void run(b.blockKey, () => saveBlock(docId, b.blockKey, draft, "version"))
                        }
                      >
                        {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Save to this course
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={busy || draft === b.markdown}
                        title="Fixes the book itself — every course cut from it sees this"
                        onClick={() =>
                          void run(b.blockKey, () => saveBlock(docId, b.blockKey, draft, "book"))
                        }
                      >
                        Fix the book
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        disabled={busy}
                        onClick={() => setEditingKey(null)}
                      >
                        Cancel
                      </Button>
                      <span className="ml-auto tabular-nums text-micro text-muted-foreground">
                        {draft.length} chars
                      </span>
                    </div>
                  </div>
                ) : (
                  // Rendered exactly as the chapter reader renders it — same component, same
                  // theme, same prose settings.
                  <div className="px-3 py-1">
                    <MarkdownReader
                      content={b.markdown}
                      theme={theme}
                      proseSize={prefs.size}
                      measure={prefs.measure}
                    />
                  </div>
                )}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
