"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { numberSections, numberedSectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { KIND_BADGE } from "@/surfaces/concepts/kind-palette"
import { ConceptMasteryDot } from "@/surfaces/concepts/concept-mastery-dot"
import type { ConceptLesson } from "@/gateways/api/concepts"
import type { ConceptMastery } from "@/gateways/api/progress"
import { cn } from "@/kit/lib/utils"

/** The Concepts page's tree: the SAME chapter/section skeleton as the course outline,
 *  pruned to concept-bearing branches, with each concept as a rich row (kind badge,
 *  mastery dot, one-line signal preview). Clicking a concept opens its detail panel. */

type ConceptTreeProps = {
  tree: LearnTreeNode[]
  /** Full lessons keyed by conceptKey — the tree's node.concepts only carry name/kind. */
  lessonsByKey: Record<string, ConceptLesson>
  mastery: Record<string, ConceptMastery>
  onOpenConcept: (lesson: ConceptLesson) => void
}

/** Keep only branches whose subtree carries concepts — the outline, concept-focused. */
function pruneToConcepts(nodes: LearnTreeNode[]): LearnTreeNode[] {
  const out: LearnTreeNode[] = []
  for (const n of nodes) {
    const children = pruneToConcepts(n.children || [])
    if ((n.concepts?.length ?? 0) > 0 || children.length > 0) {
      out.push({ ...n, children })
    }
  }
  return out
}

function collectIds(nodes: LearnTreeNode[], into: Set<string>): Set<string> {
  for (const n of nodes) {
    into.add(n.id)
    collectIds(n.children || [], into)
  }
  return into
}

function ConceptRow({
  entry,
  lesson,
  mastery,
  onOpen,
}: {
  entry: { key?: string | null; name: string; kind?: string | null }
  lesson?: ConceptLesson
  mastery?: ConceptMastery
  onOpen?: () => void
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className={cn(
          "group flex w-full items-start gap-2 rounded-md py-1 pl-1 pr-2 text-left text-sm",
          onOpen && "cursor-pointer hover:bg-muted/60",
        )}
      >
        <ConceptMasteryDot mastery={mastery?.mastery} attempts={mastery?.attempts} className="mt-1.5" />
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
            KIND_BADGE[entry.kind || ""] || "bg-muted text-muted-foreground",
          )}
        >
          {entry.kind || "concept"}
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="font-medium">{entry.name}</span>
          {lesson?.signal && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              — {lesson.signal.length > 110 ? `${lesson.signal.slice(0, 110).trimEnd()}…` : lesson.signal}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

function TreeNode({
  node,
  depth,
  numbers,
  expanded,
  onToggle,
  lessonsByKey,
  mastery,
  onOpenConcept,
}: {
  node: LearnTreeNode
  depth: number
  numbers: Map<string, string>
  expanded: Set<string>
  onToggle: (id: string) => void
  lessonsByKey: Record<string, ConceptLesson>
  mastery: Record<string, ConceptMastery>
  onOpenConcept: (lesson: ConceptLesson) => void
}) {
  const concepts = node.concepts || []
  const hasChildren = node.children.length > 0 || concepts.length > 0
  const isExpanded = expanded.has(node.id)
  const isChapter = depth === 0
  const count = node.conceptCount ?? 0

  return (
    <li className={cn("list-none", isChapter && "mt-1 first:mt-0")}>
      <div
        className={cn(
          "group flex items-start gap-1 rounded-md py-1 pl-1 pr-1 text-sm",
          isChapter && "py-1.5",
          hasChildren && "cursor-pointer hover:bg-muted/60",
        )}
        onClick={() => hasChildren && onToggle(node.id)}
      >
        {hasChildren ? (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 leading-snug",
            isChapter ? "font-medium" : "text-foreground/90",
          )}
        >
          {numberedSectionTitle(numbers.get(node.id), node.label, node.title)}
        </span>
        {count > 0 && (
          <span className="mt-0.5 shrink-0 tabular-nums text-xs text-muted-foreground">{count}</span>
        )}
      </div>
      {isExpanded && (
        <ul className={cn("ml-3 border-l border-border/40 pl-2", isChapter && "ml-4")}>
          {concepts.map((c, i) => {
            const lesson = c.key ? lessonsByKey[c.key] : undefined
            return (
              <ConceptRow
                key={c.key || `${node.id}-c${i}`}
                entry={c}
                lesson={lesson}
                mastery={c.key ? mastery[c.key] : undefined}
                onOpen={lesson ? () => onOpenConcept(lesson) : undefined}
              />
            )
          })}
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              numbers={numbers}
              expanded={expanded}
              onToggle={onToggle}
              lessonsByKey={lessonsByKey}
              mastery={mastery}
              onOpenConcept={onOpenConcept}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ConceptTree({ tree, lessonsByKey, mastery, onOpenConcept }: ConceptTreeProps) {
  const pruned = useMemo(() => pruneToConcepts(tree), [tree])
  const numbers = useMemo(() => numberSections(pruned), [pruned])
  // Concepts are the point here — start fully expanded.
  const [expanded, setExpanded] = useState<Set<string>>(() => collectIds(pruned, new Set()))
  const [seeded, setSeeded] = useState(false)
  if (!seeded && pruned.length > 0 && expanded.size === 0) {
    setExpanded(collectIds(pruned, new Set()))
    setSeeded(true)
  }

  const onToggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (pruned.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end gap-1 px-1">
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Expand all"
          aria-label="Expand all"
          onClick={() => setExpanded(collectIds(pruned, new Set()))}
        >
          <ChevronsUpDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Collapse all"
          aria-label="Collapse all"
          onClick={() => setExpanded(new Set())}
        >
          <ChevronsDownUp className="h-4 w-4" />
        </button>
      </div>
      <ul>
        {pruned.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            numbers={numbers}
            expanded={expanded}
            onToggle={onToggle}
            lessonsByKey={lessonsByKey}
            mastery={mastery}
            onOpenConcept={onOpenConcept}
          />
        ))}
      </ul>
    </div>
  )
}
