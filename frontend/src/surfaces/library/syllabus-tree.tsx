"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react"
import { numberSections, type LearnTreeNode } from "@/gateways/api/outline"
import type { SectionMemory } from "@/gateways/api/progress"
import { Button } from "@/kit/ui/button"
import { Input } from "@/kit/ui/input"
import { ScrollArea } from "@/kit/ui/scroll-area"
import { ErrorNotice } from "@/kit/data"
import { SkeletonRow } from "@/kit/patterns/skeletons"
import { cn } from "@/kit/lib/utils"
import { TreeRow, type RowContext } from "@/surfaces/library/syllabus-row"
import { useConceptTicks } from "@/surfaces/library/use-syllabus-actions"

type SyllabusTreeProps = {
  tree: LearnTreeNode[]
  selectedScope: string | null
  onSelectScope: (scope: string | null, node: LearnTreeNode | null) => void
  masteryBySection?: Record<string, SectionMemory>
  loading?: boolean
  docId?: string | null
  /** Open a concept clicked in the tree (its detail view). Omit to hide concept leaves. */
  onSelectConcept?: (conceptKey: string) => void
  /** Called after a concept is ticked. Providing it is what turns the per-concept review
   *  ticks on (the grade itself refreshes due counts and mastery through the cache). */
  onConceptReviewed?: () => void
  /** Grow with content (page scrolls) instead of scrolling inside a fixed box —
   *  for the course-home outline; sidebars keep the internal ScrollArea. */
  autoHeight?: boolean
}

function allSectionIdsOf(tree: LearnTreeNode[]): string[] {
  const ids: string[] = []
  const walk = (nodes: LearnTreeNode[]) => {
    for (const n of nodes) {
      if (n.isSection) ids.push(n.id)
      walk(n.children)
    }
  }
  walk(tree)
  return ids
}

/** Default = everything open; only the user's COLLAPSED choices persist (per book), so
 *  sections added by a later extraction still arrive expanded. */
function useExpanded(tree: LearnTreeNode[], docId: string | null | undefined) {
  const allIds = useMemo(() => allSectionIdsOf(tree), [tree])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const storageKey = docId ? `txt2k:outline-collapsed:${docId}` : null
  useEffect(() => {
    if (!allIds.length) return
    let collapsed: string[] = []
    if (storageKey) {
      try {
        collapsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]")
      } catch {
        collapsed = [] // unreadable local preference: start fully open
      }
    }
    const hidden = new Set(collapsed)
    setExpanded(new Set(allIds.filter((id) => !hidden.has(id))))
  }, [allIds, storageKey])

  const persist = (next: Set<string>) => {
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(allIds.filter((id) => !next.has(id))))
    } catch {
      // storage full/unavailable (not a request): expansion just won't persist
    }
  }
  const toggle = (id: string) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
    persist(next)
  }
  const setAll = (open: boolean) => {
    const next = open ? new Set(allIds) : new Set<string>()
    setExpanded(next)
    persist(next)
  }
  return { expanded, toggle, setAll }
}

export function SyllabusTree({
  tree,
  selectedScope,
  onSelectScope,
  masteryBySection,
  loading,
  docId,
  onSelectConcept,
  onConceptReviewed,
  autoHeight,
}: SyllabusTreeProps) {
  const [filter, setFilter] = useState("")
  const numbers = useMemo(() => numberSections(tree), [tree])
  const { expanded, toggle, setAll } = useExpanded(tree, docId)
  const ticksOn = Boolean(onConceptReviewed && docId)
  const ticks = useConceptTicks(docId, ticksOn, onConceptReviewed)

  if (loading) {
    return (
      <div className="space-y-2 p-2" aria-busy="true" aria-label="Loading syllabus">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    )
  }

  if (tree.length === 0) {
    return (
      <p className="p-4 text-body text-muted-foreground">
        No outline yet — convert a PDF with bookmarks, then build chapters from the Process page.
      </p>
    )
  }

  const ctx: RowContext = {
    filter,
    selectedScope,
    masteryBySection,
    expanded,
    numbers,
    docId,
    onToggleExpand: toggle,
    onSelect: (n) => onSelectScope(n.sectionKey, n),
    onSelectConcept,
    ticks: ticksOn ? ticks : undefined,
  }
  const rows = (
    <ul>
      {tree.map((node) => (
        <TreeRow key={node.id} node={node} depth={0} ctx={ctx} />
      ))}
    </ul>
  )

  return (
    <div className={cn("flex flex-col gap-2", !autoHeight && "h-full")}>
      <div className="flex items-center gap-1 px-2 pt-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter sections & concepts…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" title="Expand all" aria-label="Expand all" onClick={() => setAll(true)}>
          <ChevronsUpDown />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" title="Collapse all" aria-label="Collapse all" onClick={() => setAll(false)}>
          <ChevronsDownUp />
        </Button>
      </div>
      {ticksOn && ticks.mastery.error && (
        <ErrorNotice
          compact
          title="Couldn't load today's reviews"
          error={ticks.mastery.error}
          onRetry={ticks.mastery.retry}
          className="px-2"
        />
      )}
      {autoHeight ? <div className="px-2 pb-2">{rows}</div> : <ScrollArea className="flex-1 px-2 pb-2">{rows}</ScrollArea>}
    </div>
  )
}
