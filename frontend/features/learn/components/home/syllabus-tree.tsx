"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
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
} from "@/features/learn/api"

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
  /** Open a concept clicked in the tree (its detail view). Omit to hide concept leaves. */
  onSelectConcept?: (conceptKey: string) => void
  /** Grow with content (page scrolls) instead of scrolling inside a fixed box —
   *  for the CourseHome outline; sidebars keep the internal ScrollArea. */
  autoHeight?: boolean
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
        state === "error" ? "text-destructive" : "text-muted-foreground hover:text-brand",
      )}
    >
      {state === "running" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "done" ? (
        <Check className="h-3.5 w-3.5 text-brand" />
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
      className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand"
      style={{ opacity: 0.2 + 0.8 * Math.min(1, Math.max(0, mastery.mastery)) }}
      title={`Mastery ${pct}%${mastery.isRollup ? " (rolled up)" : ""}`}
    />
  )
}

function nodeMatchesFilter(node: LearnTreeNode, filter: string): boolean {
  const f = filter.toLowerCase()
  if (`${node.label} ${node.title ?? ""}`.toLowerCase().includes(f)) return true
  if (node.concepts?.some((c) => c.name.toLowerCase().includes(f))) return true
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
  onSelectConcept,
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
  onSelectConcept?: (conceptKey: string) => void
}) {
  if (filter && !nodeMatchesFilter(node, filter)) return null

  // Concept leaves render under their section like sub-entries — the concept layer made
  // visible in the course's main navigation, not hidden behind the Concepts view.
  const conceptLeaves = (onSelectConcept && !chaptersOnly && node.concepts) || []
  // Chapters-only: collapse the tree to its top level — no expanding into sub-sections.
  const hasChildren = (node.children.length > 0 || conceptLeaves.length > 0) && !chaptersOnly
  const isExpanded = expanded.has(node.id)
  const isSelected = node.sectionKey != null && node.sectionKey === selectedScope
  const isSection = node.isSection
  // Mastery % for the completion gauge next to the concept count (0% = not started).
  const sm = isSection && node.sectionKey ? masteryBySection?.[node.sectionKey] : undefined
  const masteryPct = sm ? Math.round((sm.mastery ?? 0) * 100) : null

  const isChapter = depth === 0
  return (
    <li className={cn("list-none", isChapter && "mt-1 first:mt-0")}>
      <div
        className={cn(
          "group flex items-start gap-1 rounded-md py-1 pl-1 pr-1 text-sm",
          isChapter && "py-1.5",
          isSelected && "bg-brand/15 text-foreground",
          isSection && "cursor-pointer hover:bg-muted/60",
        )}
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
            <span className={cn("font-medium", isChapter && "text-[0.925rem] font-semibold")}>
              {numberedSectionTitle(numbers.get(node.id), node.label, node.title)}
            </span>
          ) : (
            <span className="break-words">{node.label}</span>
          )}
        </button>
        {isSection && (node.conceptCount ?? 0) > 0 ? (
          <span
            className="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-brand"
            title={`${node.conceptCount} concept${node.conceptCount === 1 ? "" : "s"}`}
          >
            {node.conceptCount}
          </span>
        ) : null}
        {isSection && (node.conceptCount ?? 0) > 0 && masteryPct != null ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              masteryPct >= 80
                ? "bg-emerald-500/10 text-emerald-500"
                : masteryPct >= 50
                  ? "bg-brand/10 text-brand"
                  : masteryPct > 0
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-muted text-muted-foreground",
            )}
            title={`${masteryPct}% mastery${sm?.isRollup ? " · chapter average" : ""}`}
          >
            {masteryPct}%
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
        // Indent guide: each nesting level is a bordered container, so depth reads as a
        // visible rail instead of accumulating invisible padding.
        <ul className="ml-[0.95rem] border-l border-border/50 pl-1.5">
          {conceptLeaves.map((c) =>
            filter && !c.name.toLowerCase().includes(filter.toLowerCase()) ? null : (
              <li key={c.key ?? c.name} className="list-none">
                <button
                  type="button"
                  className="group/concept flex w-full items-center gap-1.5 rounded-md py-0.5 pl-2 pr-1 text-left text-xs text-muted-foreground hover:bg-brand/5 hover:text-foreground"
                  onClick={() => c.key && onSelectConcept?.(c.key)}
                  disabled={!c.key}
                  title={c.kind ? `${c.kind} — open concept` : "open concept"}
                >
                  <Sparkles className="h-3 w-3 shrink-0 text-brand/60" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.kind && (
                    <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] opacity-0 transition-opacity group-hover/concept:opacity-100">
                      {c.kind}
                    </span>
                  )}
                </button>
              </li>
            ),
          )}
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
              onSelectConcept={onSelectConcept}
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
  onSelectConcept,
  autoHeight,
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

  // Default = everything open; only the user's COLLAPSED choices persist (per book), so
  // sections added by a later extraction still arrive expanded.
  const storageKey = docId ? `txt2k:outline-collapsed:${docId}` : null
  useEffect(() => {
    if (!allSectionIds.length) return
    let collapsed: string[] = []
    if (storageKey) {
      try {
        collapsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]")
      } catch {
        collapsed = []
      }
    }
    const hidden = new Set(collapsed)
    setExpanded(new Set(allSectionIds.filter((id) => !hidden.has(id))))
  }, [allSectionIds, storageKey])

  const persistCollapsed = (nextExpanded: Set<string>) => {
    if (!storageKey) return
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(allSectionIds.filter((id) => !nextExpanded.has(id))),
      )
    } catch {
      /* storage full/unavailable — expansion just won't persist */
    }
  }

  const handleToggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persistCollapsed(next)
      return next
    })
  }

  const setAllExpanded = (open: boolean) => {
    const next = open ? new Set(allSectionIds) : new Set<string>()
    setExpanded(next)
    persistCollapsed(next)
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4">Loading syllabus…</p>
  }

  if (tree.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4">
        No outline yet — convert a PDF with bookmarks, then build chapters from the Process page.
      </p>
    )
  }

  const rows = (
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
          onSelectConcept={onSelectConcept}
        />
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
            className="pl-9 h-9"
          />
        </div>
        {!chaptersOnly && (
          <>
            <button
              type="button"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Expand all"
              aria-label="Expand all"
              onClick={() => setAllExpanded(true)}
            >
              <ChevronsUpDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Collapse all"
              aria-label="Collapse all"
              onClick={() => setAllExpanded(false)}
            >
              <ChevronsDownUp className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
      {autoHeight ? (
        <div className="px-2 pb-2">{rows}</div>
      ) : (
        <ScrollArea className="flex-1 px-2 pb-2">{rows}</ScrollArea>
      )}
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
