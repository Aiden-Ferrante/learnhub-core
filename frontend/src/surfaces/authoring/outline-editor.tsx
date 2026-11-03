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

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Input } from "@/kit/ui/input"
import { ErrorNotice } from "@/kit/data"
import { cn } from "@/kit/lib/utils"
import { numberSections, treeFromFlatOutline } from "@/gateways/api/outline"
import type { OutlineSection } from "@/gateways/api/editing"
import { UnplacedPanel } from "@/surfaces/authoring/unplaced-panel"
import { useSaveOutline } from "@/surfaces/authoring/use-authoring"

type OutlineEditorProps = {
  docId: string
  /** The book's own course cannot have sections removed — concepts anchor to its tree. */
  isDefault: boolean
  /** Flat outline as stored: ordered, each with a depth. */
  initial: OutlineSection[]
  /** After a structural write lands (the outline, or re-filed blocks). */
  onSaved: () => void
}

export function OutlineEditor({ docId, isDefault, initial, onSaved }: OutlineEditorProps) {
  const [rows, setRows] = useState<OutlineSection[]>(initial)
  const [dirty, setDirty] = useState(false)
  // The pre-save outline, held while the post-save refetch is in flight, so the rows you
  // just saved never flash back to the old order before the new one arrives.
  const initialRef = useRef(initial)
  initialRef.current = initial
  const held = useRef<OutlineSection[] | null>(null)
  const save = useSaveOutline(docId, () => {
    held.current = initialRef.current
    setDirty(false)
    onSaved()
  })

  // The numbers the syllabus will actually show, recomputed as rows move — so a chapter
  // you drag to the top reads "1" here before you save, not after you go and look.
  const numbers = useMemo(() => numberSections(treeFromFlatOutline(rows)), [rows])

  // The saved outline flows back in through the query once the save lands; local edits
  // are never overwritten while unsaved.
  useEffect(() => {
    if (dirty || held.current === initial) return
    held.current = null
    setRows(initial)
  }, [initial, dirty])

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-micro"
          disabled={!dirty || save.pending}
          onClick={() => save.fire(rows)}
        >
          {save.pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Save outline
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-micro"
          disabled={save.pending}
          onClick={() => mutate([...rows, { title: "New section", depth: 0 }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add section
        </Button>
        {dirty && <span className="text-micro text-muted-foreground">unsaved changes</span>}
        {isDefault && (
          <span className="ml-auto text-micro text-muted-foreground">
            This is the book&rsquo;s own course — sections can be renamed and reordered, but not
            removed.
          </span>
        )}
      </div>

      {save.error && <ErrorNotice compact title="Not saved" error={save.error} onRetry={() => save.fire(rows)} />}

      <div className="rounded-lg border bg-card">
        {rows.map((r, i) => (
          <div
            key={r.sectionKey ?? `new-${i}`}
            className="flex items-center gap-1 border-b px-2 py-1 last:border-b-0"
            style={{ paddingLeft: `${8 + r.depth * 18}px` }}
          >
            <span className="shrink-0 tabular-nums text-micro text-muted-foreground">
              {numbers.get(r.sectionKey ?? `pending-${i}`) ?? ""}
            </span>
            <Input
              value={r.title}
              aria-label="Section title"
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...next[i], title: e.target.value }
                mutate(next)
              }}
              className="h-7 flex-1 border-0 bg-transparent px-1 text-micro shadow-none focus-visible:ring-0"
            />
            {!r.sectionKey && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-micro text-ink-accent">new</span>
            )}
            <div className="flex shrink-0 items-center">
              <IconBtn label="Move up" onClick={() => move(i, -1)}>
                <ChevronUp />
              </IconBtn>
              <IconBtn label="Move down" onClick={() => move(i, 1)}>
                <ChevronDown />
              </IconBtn>
              <IconBtn label="Outdent" onClick={() => indent(i, -1)}>
                <ChevronLeft />
              </IconBtn>
              <IconBtn label="Indent" onClick={() => indent(i, 1)}>
                <ChevronRight />
              </IconBtn>
              {!isDefault && (
                <IconBtn
                  label="Remove section (its material becomes unplaced)"
                  danger
                  onClick={() => mutate(rows.filter((_, k) => k !== i))}
                >
                  <Trash2 />
                </IconBtn>
              )}
            </div>
          </div>
        ))}
      </div>

      <UnplacedPanel docId={docId} sections={rows} onChanged={onSaved} />
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("h-6 w-6 text-muted-foreground hover:text-foreground [&_svg]:size-3", danger && "hover:text-ink-danger")}
    >
      {children}
    </Button>
  )
}
