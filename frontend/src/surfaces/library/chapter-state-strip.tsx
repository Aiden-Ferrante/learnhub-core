"use client"

import { useState } from "react"
import { ArrowRight, X } from "lucide-react"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { displaySectionTitle } from "@/gateways/api/outline"
import type { SectionMemory } from "@/gateways/api/progress"

/** State → block color. Unbuilt chapters are dim; built-but-unreviewed get a faint
 *  brand tint so "there's material here" reads at a glance without shouting. */
function blockClass(memory: SectionMemory | undefined): string {
  if (!memory || memory.total === 0) return "bg-muted text-muted-foreground"
  switch (memory.state) {
    case "solid":
      return "bg-brand text-brand-foreground"
    case "shaky":
      return "bg-amber-400 text-amber-950"
    case "fading":
      return "bg-rose-400 text-rose-950"
    default:
      return "bg-brand/25 text-foreground/80" // built, nothing reviewed yet
  }
}

function blockTitle(label: string, memory: SectionMemory | undefined): string {
  if (!memory || memory.total === 0) return `${label} — no concepts here yet`
  if (memory.retention == null) return `${label} — ${memory.total} concepts, none reviewed yet`
  return `${label} — ${memory.reviewed}/${memory.total} reviewed · retention ${Math.round(memory.retention * 100)}% (${memory.state})`
}

/** Pre-order walk of a chapter's section subtree → (node, depth) rows. */
function sectionRows(chapter: LearnTreeNode): { node: LearnTreeNode; depth: number }[] {
  const out: { node: LearnTreeNode; depth: number }[] = []
  const visit = (n: LearnTreeNode, depth: number) => {
    for (const c of n.children || []) {
      if (!c.isSection || !c.sectionKey) continue
      out.push({ node: c, depth })
      visit(c, depth + 1)
    }
  }
  visit(chapter, 0)
  return out
}

/** A short block label: the section number when the node has one, else a clipped title. */
function blockLabel(node: LearnTreeNode): string {
  const label = (node.label || "").trim()
  if (/^\d+(\.\d+)*$/.test(label)) return label
  const title = displaySectionTitle(node.label, node.title)
  return title.length > 22 ? `${title.slice(0, 21)}…` : title
}

/** The expanded chapter: its subtree in outline hierarchy, but spoken in blocks —
 *  indented rows of state-colored chips, titles on hover, click to open the section. */
function ChapterBreakdown({
  chapter,
  bySection,
  onOpen,
  onClose,
}: {
  chapter: LearnTreeNode
  bySection: Record<string, SectionMemory>
  onOpen: (scope: string | null, node: LearnTreeNode | null) => void
  onClose: () => void
}) {
  const rows = sectionRows(chapter)
  return (
    <div className="border-t bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpen(chapter.sectionKey, chapter)}
          className="group flex items-center gap-1.5 text-xs font-medium hover:text-brand"
          title="Open this chapter"
        >
          {displaySectionTitle(chapter.label, chapter.title)}
          <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Collapse chapter breakdown"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sub-sections — this chapter is one block.</p>
      ) : (
        <div className="flex flex-col gap-[3px]">
          {rows.map(({ node, depth }) => {
            const memory = bySection[node.sectionKey!]
            const title = blockTitle(displaySectionTitle(node.label, node.title), memory)
            return (
              <div key={node.sectionKey} style={{ paddingLeft: depth * 18 }}>
                <button
                  type="button"
                  onClick={() => onOpen(node.sectionKey, node)}
                  className={`inline-flex h-5 min-w-9 items-center justify-center rounded-[4px] px-1.5 text-[10px] font-medium tabular-nums transition-transform hover:scale-110 ${blockClass(memory)}`}
                  title={title}
                  aria-label={title}
                >
                  {blockLabel(node)}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The chapter state strip: the whole book's memory state as one compact pixel row —
 *  the spatial twin of the activity heatmap ("the book across chapters" vs "you across
 *  time"). Hover a square for the numbers; click to unfold the chapter's sections as
 *  blocks (the breakdown's open-arrow navigates into the chapter itself). */
export function ChapterStateStrip({
  rows,
  bySection,
  onOpen,
}: {
  rows: { node: LearnTreeNode; memory: SectionMemory }[]
  bySection: Record<string, SectionMemory>
  onOpen: (scope: string | null, node: LearnTreeNode | null) => void
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  if (rows.length === 0) return null
  const expanded = expandedKey ? rows.find((r) => r.node.sectionKey === expandedKey) : undefined
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
        {rows.map(({ node, memory }) => {
          const isOpen = node.sectionKey === expandedKey
          return (
            <button
              key={node.sectionKey}
              type="button"
              onClick={() => setExpandedKey(isOpen ? null : node.sectionKey)}
              className={`h-4 w-4 rounded-[3px] transition-transform hover:scale-125 ${blockClass(memory).split(" ")[0]} ${
                isOpen ? "ring-2 ring-brand ring-offset-1 ring-offset-card" : ""
              }`}
              title={blockTitle(displaySectionTitle(node.label, node.title), memory)}
              aria-label={blockTitle(displaySectionTitle(node.label, node.title), memory)}
              aria-expanded={isOpen}
            />
          )
        })}
      </div>
      {expanded && (
        <ChapterBreakdown
          chapter={expanded.node}
          bySection={bySection}
          onOpen={onOpen}
          onClose={() => setExpandedKey(null)}
        />
      )}
    </div>
  )
}
