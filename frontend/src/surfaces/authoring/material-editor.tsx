"use client"

/** The material editor — changing the words a course is built from.
 *
 * A chapter on the left, its blocks on the right, each one editable. Blocks rather than one
 * big document, because a block's key is what this course's material mapping and every
 * concept anchor point at; re-splitting a document on save would break both.
 *
 * Every save asks a question the two buttons make explicit: is this a fix to the BOOK — the
 * OCR damage and mangled tables that every course cut from it inherits — or your own wording
 * for THIS course? The first reaches everything, the second is copy-on-write and survives a
 * later fix to the book underneath it.
 *
 * Editing material invalidates what was extracted from it. Sections whose concepts predate
 * their last edit are marked; rebuilding is left to you, on the Process tab, because a
 * chapter pass is minutes of local model time and should not ambush a typo fix.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { displaySectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
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
  const [scope, setScope] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<MaterialBlock[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
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
        // Drop drafts on a chapter change — an unsaved edit belongs to the chapter it was
        // typed in, and carrying it across would silently offer to write it somewhere else.
        setDrafts({})
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
    if (scope) void loadBlocks(scope)
  }, [scope, loadBlocks])

  const textOf = (b: MaterialBlock) => drafts[b.blockKey] ?? b.markdown
  const isDirty = (b: MaterialBlock) => textOf(b) !== b.markdown

  async function run(key: string, action: () => Promise<unknown>) {
    setBusyKey(key)
    setError(null)
    try {
      await action()
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
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-4">
        <nav className="w-56 shrink-0 space-y-0.5">
          {loading && !chapters.length
            ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)
            : chapters.map((c) => {
                const key = c.sectionKey as string
                const active = key === scope
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setScope(key)}
                    className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                      active ? "bg-muted font-medium" : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {displaySectionTitle(c.label, c.title)}
                    </span>
                    {stale.includes(key) && (
                      <TriangleAlert className="h-3 w-3 shrink-0 text-amber-500" />
                    )}
                  </button>
                )
              })}
        </nav>

        <div className="min-w-0 flex-1 space-y-3">
          {staleHere && (
            <p className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                This chapter&rsquo;s material changed after its concepts were built. Rebuild it from
                the Process tab when you&rsquo;re ready — your review history carries across.
              </span>
            </p>
          )}

          {loadingBlocks ? (
            <Skeleton className="h-64 w-full" />
          ) : !blocks.length ? (
            <p className="text-xs text-muted-foreground">
              This chapter has no material in this course.
            </p>
          ) : (
            blocks.map((b) => {
              const busy = busyKey === b.blockKey
              const dirty = isDirty(b)
              return (
                <section key={b.blockKey} className="rounded border">
                  <header className="flex items-center gap-2 border-b px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {b.heading || b.sectionKey}
                    </span>
                    {b.isRewritten && (
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        rewritten
                      </span>
                    )}
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
                      {textOf(b).length}
                    </span>
                  </header>
                  <textarea
                    value={textOf(b)}
                    spellCheck={false}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [b.blockKey]: e.target.value }))
                    }
                    className="h-64 w-full resize-y bg-transparent px-3 py-2 font-mono text-xs outline-none"
                  />
                  <footer className="flex items-center gap-2 border-t px-3 py-1.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!dirty || busy}
                      onClick={() =>
                        void run(b.blockKey, () =>
                          saveBlock(docId, b.blockKey, textOf(b), "version"),
                        )
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
                      disabled={!dirty || busy}
                      title="Fixes the book itself — every course cut from it sees this"
                      onClick={() =>
                        void run(b.blockKey, () => saveBlock(docId, b.blockKey, textOf(b), "book"))
                      }
                    >
                      Fix the book
                    </Button>
                    <span className="flex-1" />
                    {dirty && <span className="text-[10px] text-muted-foreground">unsaved</span>}
                    {b.isRewritten && !dirty && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                        disabled={busy}
                        title="Drop this course's rewrite and read the book again"
                        onClick={() => void run(b.blockKey, () => revertBlock(docId, b.blockKey))}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Revert
                      </Button>
                    )}
                  </footer>
                </section>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
