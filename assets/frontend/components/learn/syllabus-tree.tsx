"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Search, Sparkles, Loader2, Check, TriangleAlert } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  getExtractionStatus,
  numberSections,
  numberedSectionTitle,
  startExtraction,
  type LearnTreeNode,
  type SectionMastery,
} from "@/lib/learn-service"

type ExtractState = "running" | "done" | "error"

type SyllabusTreeProps = {
  tree: LearnTreeNode[]
  selectedScope: string | null
  onSelectScope: (scope: string | null, node: LearnTreeNode | null) => void
  masteryBySection?: Record<string, SectionMastery>
  loading?: boolean
  docId?: string | null
  /** Collapse to top-level chapters only — no drilling into sub-sections. */
  chaptersOnly?: boolean
}

function ExtractButton({
  scope,
  state,
  onExtract,
}: {
  scope: string
  state: ExtractState | undefined
  onExtract: (scope: string) => void
}) {
  const title =
    state === "running"
      ? "Extracting this chapter's knowledge… (runs in the background)"
      : state === "done"
        ? "Extracted — click to re-run"
        : state === "error"
          ? "Extraction failed — click to retry"
          : "Extract this chapter's knowledge into the graph (background, ~15 min for a chapter)"
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation()
        onExtract(scope)
      }}
      className={cn(
        "mt-0.5 shrink-0 transition-opacity",
        state ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
        state === "error" ? "text-destructive" : "text-muted-foreground hover:text-nvidia-green",
      )}
    >
      {state === "running" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "done" ? (
        <Check className="h-3.5 w-3.5 text-nvidia-green" />
      ) : state === "error" ? (
        <TriangleAlert className="h-3.5 w-3.5" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

function MasteryDot({ mastery }: { mastery: SectionMastery | undefined }) {
  if (!mastery || mastery.attempts === 0) {
    return (
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40"
        title="Not studied yet"
        aria-hidden
      />
    )
  }
  const pct = Math.round(mastery.mastery * 100)
  return (
    <span
      className="mt-1 h-2 w-2 shrink-0 rounded-full bg-nvidia-green"
      style={{ opacity: 0.2 + 0.8 * Math.min(1, Math.max(0, mastery.mastery)) }}
      title={`Mastery ${pct}%${mastery.isRollup ? " (rolled up)" : ""}`}
    />
  )
}

function nodeMatchesFilter(node: LearnTreeNode, filter: string): boolean {
  const f = filter.toLowerCase()
  if (`${node.label} ${node.title ?? ""}`.toLowerCase().includes(f)) return true
  return node.children.some((c) => nodeMatchesFilter(c, f))
}

function TreeRow({
  node,
  depth,
  filter,
  selectedScope,
  masteryBySection,
  expanded,
  onToggleExpand,
  onSelect,
  onExtract,
  extractState,
  numbers,
  chaptersOnly,
}: {
  node: LearnTreeNode
  depth: number
  filter: string
  selectedScope: string | null
  masteryBySection?: Record<string, SectionMastery>
  expanded: Set<string>
  onToggleExpand: (id: string) => void
  onSelect: (node: LearnTreeNode) => void
  onExtract?: (scope: string) => void
  extractState?: Record<string, ExtractState>
  numbers: Map<string, string>
  chaptersOnly?: boolean
}) {
  if (filter && !nodeMatchesFilter(node, filter)) return null

  // Chapters-only: collapse the tree to its top level — no expanding into sub-sections.
  const hasChildren = node.children.length > 0 && !chaptersOnly
  const isExpanded = expanded.has(node.id)
  const isSelected = node.sectionKey != null && node.sectionKey === selectedScope
  const isSection = node.isSection

  return (
    <li className="list-none">
      <div
        className={cn(
          "group flex items-start gap-1 rounded-md py-1 pr-1 text-sm",
          isSelected && "bg-nvidia-green/15 text-foreground",
          isSection && "cursor-pointer hover:bg-muted/60",
        )}
        style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.id)
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {isSection ? (
          <MasteryDot mastery={node.sectionKey ? masteryBySection?.[node.sectionKey] : undefined} />
        ) : null}
        <button
          type="button"
          className={cn(
            "min-w-0 flex-1 text-left leading-snug",
            !isSection && "text-muted-foreground text-xs pl-1",
          )}
          onClick={() => {
            if (isSection && node.sectionKey) onSelect(node)
          }}
          disabled={!isSection}
        >
          {isSection ? (
            <span className="font-medium">
              {numberedSectionTitle(numbers.get(node.id), node.label, node.title)}
            </span>
          ) : (
            <span className="break-words">{node.label}</span>
          )}
        </button>
        {isSection && (node.conceptCount ?? 0) > 0 ? (
          <span
            className="shrink-0 rounded-full bg-nvidia-green/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-nvidia-green"
            title={`${node.conceptCount} concept${node.conceptCount === 1 ? "" : "s"}`}
          >
            {node.conceptCount}
          </span>
        ) : null}
        {isSection && node.sectionKey && onExtract ? (
          <ExtractButton
            scope={node.sectionKey}
            state={extractState?.[node.sectionKey]}
            onExtract={onExtract}
          />
        ) : null}
      </div>
      {hasChildren && isExpanded ? (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              filter={filter}
              selectedScope={selectedScope}
              masteryBySection={masteryBySection}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onExtract={onExtract}
              extractState={extractState}
              numbers={numbers}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function SyllabusTree({
  tree,
  selectedScope,
  onSelectScope,
  masteryBySection,
  loading,
  docId,
  chaptersOnly,
}: SyllabusTreeProps) {
  const [filter, setFilter] = useState("")
  const [extractState, setExtractState] = useState<Record<string, ExtractState>>({})
  const numbers = useMemo(() => numberSections(tree), [tree])

  const handleExtract = useCallback(
    async (scope: string) => {
      setExtractState((s) => ({ ...s, [scope]: "running" }))
      try {
        const started = await startExtraction(scope, docId ?? undefined)
        if (started.status === "error") {
          setExtractState((s) => ({ ...s, [scope]: "error" }))
          return
        }
      } catch {
        setExtractState((s) => ({ ...s, [scope]: "error" }))
        return
      }
      const poll = async () => {
        try {
          const st = await getExtractionStatus(scope, docId ?? undefined)
          if (st.status === "done") {
            setExtractState((s) => ({ ...s, [scope]: "done" }))
            return
          }
          if (st.status === "error") {
            setExtractState((s) => ({ ...s, [scope]: "error" }))
            return
          }
        } catch {
          /* transient — keep polling */
        }
        window.setTimeout(poll, 8000)
      }
      window.setTimeout(poll, 8000)
    },
    [docId],
  )
  const allSectionIds = useMemo(() => {
    const ids: string[] = []
    const walk = (nodes: LearnTreeNode[]) => {
      for (const n of nodes) {
        if (n.isSection) ids.push(n.id)
        walk(n.children)
      }
    }
    walk(tree)
    return ids
  }, [tree])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (allSectionIds.length) setExpanded(new Set(allSectionIds))
  }, [allSectionIds])

  const handleToggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4">Loading syllabus…</p>
  }

  if (tree.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4">
        No course outline in the graph yet. Process a document with TOC detection, then store triples in
        ArangoDB.
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative px-2 pt-2">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter sections…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9 h-9"
        />
      </div>
      <ScrollArea className="flex-1 px-2 pb-2">
        <ul>
          {tree.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              depth={0}
              filter={filter}
              selectedScope={selectedScope}
              masteryBySection={masteryBySection}
              expanded={expanded}
              onToggleExpand={handleToggleExpand}
              onSelect={(n) => onSelectScope(n.sectionKey, n)}
              onExtract={handleExtract}
              extractState={extractState}
              numbers={numbers}
              chaptersOnly={chaptersOnly}
            />
          ))}
        </ul>
      </ScrollArea>
      {selectedScope ? (
        <button
          type="button"
          className="mx-2 mb-2 text-xs text-muted-foreground hover:text-foreground underline"
          onClick={() => onSelectScope(null, null)}
        >
          Clear selection (study whole graph)
        </button>
      ) : null}
    </div>
  )
}
