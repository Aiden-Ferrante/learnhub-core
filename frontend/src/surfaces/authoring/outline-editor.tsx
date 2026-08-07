"use client"

/** The outline editor — reshaping a course into your own chapters.
 *
 * The outline is edited as a flat list with depth, which is exactly how it is stored and
 * how the reader consumes it. Indent and outdent move a row between levels; up and down
 * move it among its neighbours. That is deliberately not drag-and-drop: restructuring a
 * 150-section book is precision work, and a keyboard-reachable button that moves one row
 * one place beats a drag that has to be aimed.
 *
 * Nothing is written until you save, and the save sends the whole outline — the backend
 * reconciles in place so a reorder never unplaces the material filed under a section.
 *
 * Deleting a section does NOT delete its material. The blocks become *unplaced* and appear
 * in the panel below, where they can be re-filed or dropped from the course deliberately.
 * That is the difference between distilling and losing things.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Input } from "@/kit/ui/input"
import { Skeleton } from "@/kit/ui/skeleton"
import {
  numberSections,
  treeFromFlatOutline,
} from "@/gateways/api/outline"
import {
  fetchUnplacedBlocks,
  moveBlocks,
  removeBlocks,
  saveOutline,
  type OutlineSection,
  type UnplacedBlock,
} from "@/gateways/api/editing"

type OutlineEditorProps = {
  docId: string
  /** The book's own course cannot have sections removed — concepts anchor to its tree. */
  isDefault: boolean
  /** Flat outline as stored: ordered, each with a depth. */
  initial: OutlineSection[]
  loading: boolean
  onSaved: () => void
}

export function OutlineEditor({ docId, isDefault, initial, loading, onSaved }: OutlineEditorProps) {
  const [rows, setRows] = useState<OutlineSection[]>(initial)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unplaced, setUnplaced] = useState<UnplacedBlock[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // The numbers the syllabus will actually show, recomputed as rows move — so a chapter
  // you drag to the top reads "1" here before you save, not after you go and look.
  const numbers = useMemo(
    () => numberSections(treeFromFlatOutline(rows)),
    [rows],
  )

  useEffect(() => {
    if (!dirty) setRows(initial)
  }, [initial, dirty])

  const loadUnplaced = useCallback(() => {
    fetchUnplacedBlocks(docId)
      .then((d) => setUnplaced(d.blocks ?? []))
      .catch(() => setUnplaced([]))
  }, [docId])

  useEffect(loadUnplaced, [loadUnplaced])

  function mutate(next: OutlineSection[]) {
    setRows(next)
    setDirty(true)
  }

  function move(i: number, by: number) {
    const j = i + by
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    mutate(next)
  }

  function indent(i: number, by: number) {
    // A row may sit at most one level below the row above it — the same rule the backend
    // clamps to, applied here so the tree you see is the tree that saves.
    const ceiling = i === 0 ? 0 : rows[i - 1].depth + 1
    const depth = Math.max(0, Math.min(rows[i].depth + by, ceiling))
    if (depth === rows[i].depth) return
    const next = [...rows]
    next[i] = { ...next[i], depth }
    mutate(next)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await saveOutline(docId, rows)
      setDirty(false)
      loadUnplaced()
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the outline")
    } finally {
      setSaving(false)
    }
  }

  async function withSelection(action: (keys: string[]) => Promise<unknown>) {
    const keys = Array.from(selected)
    if (!keys.length) return
    setSaving(true)
    setError(null)
    try {
      await action(keys)
      setSelected(new Set())
      loadUnplaced()
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work")
    } finally {
      setSaving(false)
    }
  }

  if (loading && !rows.length) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Save outline
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={saving}
          onClick={() => mutate([...rows, { title: "New section", depth: 0 }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add section
        </Button>
        {dirty && <span className="text-[10px] text-muted-foreground">unsaved changes</span>}
        {isDefault && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            This is the book&rsquo;s own course — sections can be renamed and reordered, but not
            removed.
          </span>
        )}
      </div>

      {error && (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="rounded border">
        {rows.map((r, i) => (
          <div
            key={r.sectionKey ?? `new-${i}`}
            className="flex items-center gap-1 border-b px-2 py-1 last:border-b-0"
            style={{ paddingLeft: `${8 + r.depth * 18}px` }}
          >
            <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/70">
              {numbers.get(r.sectionKey ?? `pending-${i}`) ?? ""}
            </span>
            <Input
              value={r.title}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...next[i], title: e.target.value }
                mutate(next)
              }}
              className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
            />
            {!r.sectionKey && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">new</span>
            )}
            <div className="flex shrink-0 items-center">
              <IconBtn label="Move up" onClick={() => move(i, -1)}><ChevronUp className="h-3 w-3" /></IconBtn>
              <IconBtn label="Move down" onClick={() => move(i, 1)}><ChevronDown className="h-3 w-3" /></IconBtn>
              <IconBtn label="Outdent" onClick={() => indent(i, -1)}><ChevronLeft className="h-3 w-3" /></IconBtn>
              <IconBtn label="Indent" onClick={() => indent(i, 1)}><ChevronRight className="h-3 w-3" /></IconBtn>
              {!isDefault && (
                <IconBtn
                  label="Remove section (its material becomes unplaced)"
                  onClick={() => mutate(rows.filter((_, k) => k !== i))}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </IconBtn>
              )}
            </div>
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <header className="flex items-center gap-2">
          <h2 className="text-xs font-medium">Unplaced material</h2>
          <span className="tabular-nums text-[10px] text-muted-foreground">
            {unplaced.length} block{unplaced.length === 1 ? "" : "s"}
          </span>
          {selected.size > 0 && (
            <>
              <select
                className="h-7 rounded border bg-transparent px-1 text-xs"
                defaultValue=""
                onChange={(e) => {
                  const s = e.target.value
                  if (s) void withSelection((keys) => moveBlocks(docId, keys, s))
                  e.target.value = ""
                }}
              >
                <option value="">File under…</option>
                {rows
                  .filter((r) => r.sectionKey)
                  .map((r) => (
                    <option key={r.sectionKey} value={r.sectionKey}>
                      {"— ".repeat(r.depth)}
                      {r.title || r.sectionKey}
                    </option>
                  ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                disabled={saving}
                title="Drop from this course. The book keeps every word."
                onClick={() => void withSelection((keys) => removeBlocks(docId, keys))}
              >
                Drop from course ({selected.size})
              </Button>
            </>
          )}
        </header>
        {!unplaced.length ? (
          <p className="text-xs text-muted-foreground">
            Every block this course keeps is filed under a section.
          </p>
        ) : (
          <div className="rounded border">
            {unplaced.map((b) => (
              <label
                key={b.blockKey}
                className="flex cursor-pointer items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0 hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={selected.has(b.blockKey)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(b.blockKey)
                      else next.delete(b.blockKey)
                      return next
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate">{b.heading || b.sourceSectionKey}</span>
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
                  {b.charCount}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  )
}
