"use client"

import type { LearnTreeNode } from "@/gateways/api/outline"
import { displaySectionTitle } from "@/gateways/api/outline"
import type { SectionMemory } from "@/gateways/api/progress"

/** One square per chapter, colored by memory state. Unbuilt chapters are dim;
 *  built-but-unreviewed get a faint brand tint so "there's material here" reads
 *  at a glance without shouting. */
function squareClass(memory: SectionMemory): string {
  if (memory.total === 0) return "bg-muted"
  switch (memory.state) {
    case "solid":
      return "bg-brand"
    case "shaky":
      return "bg-amber-400"
    case "fading":
      return "bg-rose-400"
    default:
      return "bg-brand/25" // built, nothing reviewed yet
  }
}

function squareTitle(label: string, memory: SectionMemory): string {
  if (memory.total === 0) return `${label} — not built yet`
  if (memory.retention == null) return `${label} — ${memory.total} concepts, none reviewed yet`
  return `${label} — ${memory.reviewed}/${memory.total} reviewed · retention ${Math.round(memory.retention * 100)}% (${memory.state})`
}

/** The chapter state strip: the whole book's memory state as one compact pixel row —
 *  the spatial twin of the activity heatmap ("the book across chapters" vs "you across
 *  time"). Hover a square for the numbers; click to open the chapter. */
export function ChapterStateStrip({
  rows,
  onOpen,
}: {
  rows: { node: LearnTreeNode; memory: SectionMemory }[]
  onOpen: (scope: string | null, node: LearnTreeNode | null) => void
}) {
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Chapters</span>
        <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-muted" /> unbuilt
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-brand/25" /> new
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-brand" /> solid
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-amber-400" /> shaky
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] bg-rose-400" /> fading
          </span>
        </span>
      </div>
      <div className="flex flex-wrap gap-[3px] p-3">
        {rows.map(({ node, memory }) => (
          <button
            key={node.sectionKey}
            type="button"
            onClick={() => onOpen(node.sectionKey, node)}
            className={`h-4 w-4 rounded-[3px] transition-transform hover:scale-125 ${squareClass(memory)}`}
            title={squareTitle(displaySectionTitle(node.label, node.title), memory)}
            aria-label={squareTitle(displaySectionTitle(node.label, node.title), memory)}
          />
        ))}
      </div>
    </div>
  )
}
