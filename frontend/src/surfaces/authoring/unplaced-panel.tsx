"use client"

/** Unplaced material: what this course keeps but files under no section — what a
 *  deleted section leaves behind. Surfaced so a cut is never silent: select blocks, then
 *  file them under a section or drop them from the course (the book keeps every word). */

import { useState } from "react"
import { Button } from "@/kit/ui/button"
import { SectionCard } from "@/kit/patterns/section-card"
import { AsyncView, ErrorNotice } from "@/kit/data"
import type { OutlineSection } from "@/gateways/api/editing"
import { useBlockAction, useUnplacedBlocks, type BlockAction } from "@/surfaces/authoring/use-authoring"

export function UnplacedPanel({
  docId,
  sections,
  onChanged,
}: {
  docId: string
  /** The SAVED outline's sections, the only legal targets to file under. */
  sections: OutlineSection[]
  onChanged: () => void
}) {
  const q = useUnplacedBlocks(docId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [last, setLast] = useState<BlockAction | null>(null)
  const action = useBlockAction(docId, () => {
    setSelected(new Set())
    onChanged()
  })
  const send = (a: BlockAction) => {
    setLast(a)
    action.fire(a)
  }
  const keys = Array.from(selected)
  const count = q.data?.blocks.length ?? 0

  return (
    <SectionCard
      title="Unplaced material"
      description={q.data ? `${count} block${count === 1 ? "" : "s"}` : undefined}
      actions={
        selected.size > 0 && (
          <>
            <select
              aria-label="File the selected blocks under a section"
              className="h-7 rounded border bg-background px-1 text-micro"
              defaultValue=""
              disabled={action.pending}
              onChange={(e) => {
                const sectionKey = e.target.value
                if (sectionKey) send({ kind: "move", keys, sectionKey })
                e.target.value = ""
              }}
            >
              <option value="">File under…</option>
              {sections
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
              className="h-7 px-2 text-micro text-muted-foreground hover:text-ink-danger"
              disabled={action.pending}
              title="Drop from this course. The book keeps every word."
              onClick={() => send({ kind: "remove", keys })}
            >
              Drop from course ({selected.size})
            </Button>
          </>
        )
      }
    >
      {action.error && (
        <ErrorNotice
          compact
          className="mb-2"
          title={last?.kind === "move" ? "Not filed" : "Not dropped"}
          error={action.error}
          onRetry={() => last && send(last)}
        />
      )}
      <AsyncView
        q={q}
        error="inline"
        errorTitle="Couldn't load the unplaced material"
        isEmpty={(d) => d.blocks.length === 0}
        empty={<p className="text-micro text-muted-foreground">Every block this course keeps is filed under a section.</p>}
      >
        {(d) => (
          <div className="rounded border">
            {d.blocks.map((b) => (
              <label
                key={b.blockKey}
                className="flex cursor-pointer items-center gap-2 border-b px-2 py-1 text-micro last:border-b-0 hover:bg-muted/40"
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
                <span className="shrink-0 tabular-nums text-muted-foreground">{b.charCount}</span>
              </label>
            ))}
          </div>
        )}
      </AsyncView>
    </SectionCard>
  )
}
