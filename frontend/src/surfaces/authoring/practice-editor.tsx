"use client"

/** The practice editor — generate, then polish, a chapter's practice items.
 *
 * Items render through the READER's own renderer (`MarkdownReader`), same rule as the
 * material editor: a lookalike drifts, and then the thing you edited stops matching the
 * thing you study.
 *
 * Generation is a ledgered background job (visible in the Process tab). The pool is
 * FIXED + REGENERABLE, not append-on-demand: `editedAt === null` marks a generated,
 * untouched item, and a regenerate deletes and rewrites ONLY those — the moment you edit
 * an item it is yours and no future pass will overwrite it. That is why edited items wear
 * a badge: it shows exactly what a regenerate will spare.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, PencilLine, Plus, RefreshCw, Sparkles, Trash2, TriangleAlert } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Skeleton } from "@/kit/ui/skeleton"
import { displaySectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { MarkdownReader, useReadingPrefs, useReadingTheme } from "@/surfaces/reading"
import { usePolling } from "@/kit/hooks/use-polling"
import {
  createPracticeItem,
  deletePracticeItem,
  fetchPractice,
  fetchPracticeStatus,
  preparePractice,
  updatePracticeItem,
  type PracticeItem,
  type PracticeKind,
} from "@/gateways/api/practice"

type PracticeEditorProps = {
  docId: string
  tree: LearnTreeNode[]
  loading: boolean
}

const KIND_LABEL: Record<string, string> = {
  retrieve: "retrieval",
  problem: "problem",
  mcq: "multiple choice",
  order: "ordering",
  code: "code",
}

type Draft = { prompt: string; answer: string; rubric: string }

const EMPTY_DRAFT: Draft = { prompt: "", answer: "", rubric: "" }

export function PracticeEditor({ docId, tree, loading }: PracticeEditorProps) {
  const chapters = useMemo(() => tree.filter((n) => n.sectionKey), [tree])
  const [theme] = useReadingTheme()
  const [prefs] = useReadingPrefs()

  const [scope, setScope] = useState<string | null>(null)
  const [items, setItems] = useState<PracticeItem[]>([])
  const [stale, setStale] = useState<string[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [running, setRunning] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [addKind, setAddKind] = useState<PracticeKind>("problem")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!scope && chapters.length) setScope(chapters[0].sectionKey)
  }, [chapters, scope])

  const loadItems = useCallback(
    async (s: string) => {
      setLoadingItems(true)
      setError(null)
      try {
        const data = await fetchPractice(docId, s)
        if (data.error) setError(data.error)
        setItems(data.items ?? [])
        setStale(data.staleSections ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load this chapter's items")
        setItems([])
      } finally {
        setLoadingItems(false)
      }
    },
    [docId],
  )

  useEffect(() => {
    if (scope) {
      setEditingKey(null)
      setAdding(false)
      void loadItems(scope)
    }
  }, [scope, loadItems])

  // While an authoring job runs, poll its status; when it lands, reload the items.
  usePolling(async () => {
    if (!scope) return
    try {
      const st = await fetchPracticeStatus(docId, scope)
      if (!st.running && running) void loadItems(scope)
      setRunning(st.running)
    } catch {
      /* status is decoration — never break the editor */
    }
  }, scope ? (running ? 4000 : 20000) : null, { leading: true })

  async function generate(regenerate: boolean) {
    if (!scope) return
    setBusy(true)
    setError(null)
    try {
      await preparePractice(docId, scope, regenerate ? { regenerate: true } : {})
      setRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enqueue generation")
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<{ error?: string }>) {
    setBusy(true)
    setError(null)
    try {
      const res = await action()
      if (res.error) throw new Error(res.error)
      setEditingKey(null)
      setAdding(false)
      if (scope) await loadItems(scope)
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save")
    } finally {
      setBusy(false)
    }
  }

  const staleHere = scope ? stale.includes(scope) : false

  const editorFields = (
    onSave: () => void,
    saveLabel: string,
  ) => (
    <div className="space-y-2 p-3">
      <label className="block text-micro font-medium uppercase text-muted-foreground">Prompt</label>
      <textarea
        value={draft.prompt}
        autoFocus
        spellCheck={false}
        onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
        className="h-24 w-full resize-y rounded border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <label className="block text-micro font-medium uppercase text-muted-foreground">
        Worked solution
      </label>
      <textarea
        value={draft.answer}
        spellCheck={false}
        onChange={(e) => setDraft((d) => ({ ...d, answer: e.target.value }))}
        className="h-40 w-full resize-y rounded border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <label className="block text-micro font-medium uppercase text-muted-foreground">
        Rubric (what a correct answer must contain)
      </label>
      <textarea
        value={draft.rubric}
        spellCheck={false}
        onChange={(e) => setDraft((d) => ({ ...d, rubric: e.target.value }))}
        className="h-14 w-full resize-y rounded border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy || !draft.prompt.trim() || !draft.answer.trim()}
          onClick={onSave}
        >
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {saveLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          disabled={busy}
          onClick={() => {
            setEditingKey(null)
            setAdding(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )

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
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={busy || running || !scope}
            onClick={() => void generate(false)}
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {running ? "Generating…" : "Generate"}
          </Button>
          {items.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={busy || running}
              title="Rewrites only untouched items — anything you've edited is kept"
              onClick={() => void generate(true)}
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 px-2 text-xs"
            disabled={busy || !scope}
            onClick={() => {
              setAdding(true)
              setEditingKey(null)
              setDraft(EMPTY_DRAFT)
            }}
          >
            <Plus className="h-3 w-3" />
            Add item
          </Button>
        </div>

        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {staleHere && (
          <p className="flex items-start gap-2 rounded border border-status-due/40 bg-status-due/5 px-3 py-2 text-xs">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-due" />
            <span>
              This chapter&rsquo;s material changed after its items were authored. Regenerate when
              you&rsquo;re ready — your edited items are kept.
            </span>
          </p>
        )}

        {adding && (
          <section className="rounded-lg border border-brand/50">
            <div className="flex items-center gap-2 px-3 pt-3">
              <span className="text-micro font-medium uppercase text-muted-foreground">New</span>
              <select
                value={addKind}
                onChange={(e) => setAddKind(e.target.value as PracticeKind)}
                className="h-6 rounded border bg-background px-1 text-xs"
              >
                <option value="problem">problem</option>
                <option value="retrieve">retrieval</option>
              </select>
            </div>
            {editorFields(
              () =>
                void run(() =>
                  createPracticeItem(docId, scope as string, {
                    kind: addKind,
                    prompt: draft.prompt.trim(),
                    answer: draft.answer.trim(),
                    rubric: draft.rubric.trim() || null,
                  }),
                ),
              "Add",
            )}
          </section>
        )}

        {loadingItems ? (
          <div className="space-y-3">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
          </div>
        ) : !items.length && !adding ? (
          <p className="text-sm text-muted-foreground">
            No practice items for this chapter yet — generate a set, then polish what&rsquo;s worth
            keeping.
          </p>
        ) : (
          items.map((it) => {
            const editing = editingKey === it.key
            return (
              <section
                key={it.key}
                className={`group relative rounded-lg border transition-colors ${
                  editing ? "border-brand/50" : "border-transparent hover:border-border"
                }`}
              >
                {!editing && (
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs shadow-sm"
                      onClick={() => {
                        setAdding(false)
                        setEditingKey(it.key)
                        setDraft({ prompt: it.prompt, answer: it.answer, rubric: it.rubric ?? "" })
                      }}
                    >
                      <PencilLine className="h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 px-2 text-xs shadow-sm"
                      disabled={busy}
                      title="Delete this item (its review history goes with it)"
                      onClick={() => void run(() => deletePracticeItem(it.key))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {editing ? (
                  editorFields(
                    () =>
                      void run(() =>
                        updatePracticeItem(it.key, {
                          prompt: draft.prompt.trim(),
                          answer: draft.answer.trim(),
                          rubric: draft.rubric.trim() || null,
                        }),
                      ),
                    "Save",
                  )
                ) : (
                  <div className="space-y-1 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-brand/15 px-1.5 py-0.5 text-micro font-medium uppercase text-brand">
                        {KIND_LABEL[it.kind] ?? it.kind}
                      </span>
                      {it.editedAt != null && (
                        <span
                          className="rounded bg-primary/10 px-1.5 py-0.5 text-micro text-primary"
                          title="Yours — a regenerate will never overwrite it"
                        >
                          edited
                        </span>
                      )}
                    </div>
                    {/* Rendered exactly as the study surfaces render it — same renderer. */}
                    <MarkdownReader
                      content={it.prompt}
                      theme={theme}
                      proseSize={prefs.size}
                      measure={prefs.measure}
                    />
                    <details className="text-sm">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Worked solution{it.rubric ? " · rubric" : ""}
                      </summary>
                      <div className="mt-1 border-l-2 border-muted pl-3">
                        <MarkdownReader
                          content={it.answer}
                          theme={theme}
                          proseSize={prefs.size}
                          measure={prefs.measure}
                        />
                        {it.rubric && (
                          <p className="mt-1 text-xs italic text-muted-foreground">{it.rubric}</p>
                        )}
                      </div>
                    </details>
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
