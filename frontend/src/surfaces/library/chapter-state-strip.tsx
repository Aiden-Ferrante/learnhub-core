"use client"

import { useState } from "react"
import { ArrowRight, X } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { cn } from "@/kit/lib/utils"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { displaySectionTitle } from "@/gateways/api/outline"
import type { SectionMemory } from "@/gateways/api/progress"

/** State → block fill. Unbuilt chapters are dim; built-but-unreviewed get a faint accent
 *  tint so "there's material here" reads at a glance without shouting. */
function blockFill(memory: SectionMemory | undefined): string {
  if (!memory || memory.total === 0) return "bg-muted hover:bg-muted"
  switch (memory.state) {
    case "solid":
      return "bg-brand hover:bg-brand"
    case "shaky":
      return "bg-status-due hover:bg-status-due"
    case "fading":
      return "bg-status-fading hover:bg-status-fading"
    default:
      return "bg-brand/25 hover:bg-brand/25" // built, nothing reviewed yet
  }
}

/** Label ink on a block: words never wear a fill token, so a solid block takes the
 *  on-accent ink and the dim blocks take the ordinary text inks. */
function blockInk(memory: SectionMemory | undefined): string {
  if (!memory || memory.total === 0) return "text-muted-foreground"
  if (memory.state === "solid") return "text-ink-on-accent"
  return memory.state === "new" ? "text-foreground" : "text-background"
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

const LEGEND: [string, string][] = [
  ["bg-muted", "unbuilt"],
  ["bg-brand/25", "new"],
  ["bg-brand", "solid"],
  ["bg-status-due", "shaky"],
  ["bg-status-fading", "fading"],
]

/** The expanded chapter: its subtree in outline hierarchy, spoken in blocks — indented
 *  rows of state-filled chips, titles on hover, click to open the section. */
function ChapterBreakdown({
  chapter,
  bySection,
  onOpen,
  onClose,
}: {
  chapter: LearnTreeNode
  bySection: Record<string, SectionMemory>
  onOpen: (scope: string) => void
  onClose: () => void
}) {
  const rows = sectionRows(chapter)
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button
          variant="link"
          className="group h-auto gap-1.5 p-0 text-meta font-medium text-foreground"
          onClick={() => chapter.sectionKey && onOpen(chapter.sectionKey)}
          title="Open this chapter"
        >
          {displaySectionTitle(chapter.label, chapter.title)}
          <ArrowRight className="opacity-0 transition-opacity group-hover:opacity-100" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={onClose} aria-label="Collapse chapter breakdown">
          <X />
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-meta text-muted-foreground">No sub-sections — this chapter is one block.</p>
      ) : (
        <div className="flex flex-col gap-[3px]">
          {rows.map(({ node, depth }) => {
            const memory = bySection[node.sectionKey!]
            const title = blockTitle(displaySectionTitle(node.label, node.title), memory)
            return (
              // Indent is dynamic geometry (outline depth), the sanctioned inline style.
              <div key={node.sectionKey} style={{ paddingLeft: depth * 18 }}>
                <Button
                  onClick={() => onOpen(node.sectionKey as string)}
                  className={cn(
                    "h-5 min-w-9 rounded-[4px] px-1.5 text-micro font-medium tabular-nums transition-transform hover:scale-110",
                    blockFill(memory),
                    blockInk(memory),
                  )}
                  title={title}
                  aria-label={title}
                >
                  {blockLabel(node)}
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The chapter state strip: the whole book's memory state as one compact pixel row, the
 *  spatial twin of the activity heatmap. Hover a square for the numbers; click to unfold
 *  the chapter's sections as blocks. Renders inside the caller's sheet. */
export function ChapterStateStrip({
  rows,
  bySection,
  onOpen,
}: {
  rows: { node: LearnTreeNode; memory: SectionMemory }[]
  bySection: Record<string, SectionMemory>
  onOpen: (scope: string) => void
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  if (rows.length === 0) return null
  const expanded = expandedKey ? rows.find((r) => r.node.sectionKey === expandedKey) : undefined
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-meta font-medium text-muted-foreground">Chapters</span>
        <span className="flex items-center gap-2 text-micro text-muted-foreground">
          {LEGEND.map(([fill, label]) => (
            <span key={label} className="flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-[2px]", fill)} /> {label}
            </span>
          ))}
        </span>
      </div>
      <div className="flex flex-wrap gap-[3px]">
        {rows.map(({ node, memory }) => {
          const isOpen = node.sectionKey === expandedKey
          const title = blockTitle(displaySectionTitle(node.label, node.title), memory)
          return (
            <Button
              key={node.sectionKey}
              onClick={() => setExpandedKey(isOpen ? null : node.sectionKey)}
              className={cn(
                "h-4 w-4 rounded-[3px] p-0 transition-transform hover:scale-125",
                blockFill(memory),
                isOpen && "ring-2 ring-brand ring-offset-1 ring-offset-card",
              )}
              title={title}
              aria-label={title}
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
