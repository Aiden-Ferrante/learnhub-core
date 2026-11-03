"use client"

import type React from "react"
import { Check, ChevronDown, ChevronRight, Circle, CircleCheckBig, Loader2, Sparkles, TriangleAlert } from "lucide-react"
import { numberedSectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import type { SectionMemory } from "@/gateways/api/progress"
import { Button } from "@/kit/ui/button"
import { ErrorNotice, errorMessage } from "@/kit/data"
import { cn } from "@/kit/lib/utils"
import { ConceptMasteryDot } from "@/surfaces/concepts"
import { useExtraction } from "@/surfaces/library/use-syllabus-actions"

/** Everything a row needs from the tree, passed down unchanged to every depth. */
export type RowContext = {
  filter: string
  selectedScope: string | null
  masteryBySection?: Record<string, SectionMemory>
  expanded: Set<string>
  numbers: Map<string, string>
  docId?: string | null
  onToggleExpand: (id: string) => void
  onSelect: (node: LearnTreeNode) => void
  onSelectConcept?: (conceptKey: string) => void
  /** Present = concept ticks are on. */
  ticks?: {
    reviewedToday: Set<string>
    gradingKey: string | null
    failedKey: string | null
    error: unknown
    tick: (conceptKey: string) => void
    retry: () => void
  }
}

export function nodeMatchesFilter(node: LearnTreeNode, filter: string): boolean {
  const f = filter.toLowerCase()
  if (`${node.label} ${node.title ?? ""}`.toLowerCase().includes(f)) return true
  if (node.concepts?.some((c) => c.name.toLowerCase().includes(f))) return true
  return node.children.some((c) => nodeMatchesFilter(c, f))
}

/** The build trigger on a section. Unbuilt CHAPTERS get a visible labelled Build button
 *  (extraction is on demand); other sections keep a subtle hover icon. */
function ExtractControl({ scope, docId, prominent }: { scope: string; docId?: string | null; prominent: boolean }) {
  const { state, statusError, error, run } = useExtraction(scope, docId)
  const base =
    state === "running"
      ? "Building this chapter's concepts… (runs in the background)"
      : state === "done"
        ? "Built — click to re-run"
        : state === "error"
          ? "Build failed — click to retry"
          : "Build this chapter's concepts (background, a few minutes per chapter)"
  const problem = error ?? statusError
  const title = problem ? `${base} · ${errorMessage(problem)}` : base
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (state !== "running") run()
  }
  if (prominent) {
    return (
      <Button
        variant="outline"
        size="sm"
        title={title}
        aria-label={title}
        onClick={onClick}
        className={cn(
          "h-6 shrink-0 gap-1 px-1.5 text-micro [&_svg]:size-3",
          state === "running" && "text-ink-accent",
          state === "error" && "text-ink-danger",
        )}
      >
        {state === "running" ? (
          <>
            <Loader2 className="animate-spin" /> Building…
          </>
        ) : state === "error" ? (
          <>
            <TriangleAlert /> Retry
          </>
        ) : (
          <>
            <Sparkles /> Build
          </>
        )}
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "mt-0.5 h-5 w-5 shrink-0 transition-opacity [&_svg]:size-3.5",
        state ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
        state === "error" ? "text-ink-danger" : state === "done" ? "text-ink-accent" : "text-muted-foreground",
      )}
    >
      {state === "running" ? (
        <Loader2 className="animate-spin" />
      ) : state === "done" ? (
        <Check />
      ) : state === "error" ? (
        <TriangleAlert />
      ) : (
        <Sparkles />
      )}
    </Button>
  )
}

/** Mark one concept reviewed today. This records a REAL review at Good (3), the same
 *  grade the review panel's Good button writes, so it moves the schedule and the due
 *  count. The honest reading of a tick is "I recalled this". */
function ReviewTick({ done, busy, onTick }: { done: boolean; busy: boolean; onTick: () => void }) {
  const title = done ? "Reviewed today — click to review again" : "I recalled this — log a review (Good)"
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      aria-pressed={done}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation()
        onTick()
      }}
      className={cn(
        "h-5 w-5 shrink-0 transition-opacity [&_svg]:size-3.5",
        done
          ? "text-ink-ok opacity-100"
          : "text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover/concept:opacity-100",
      )}
    >
      {busy ? <Loader2 className="animate-spin" /> : done ? <CircleCheckBig /> : <Circle />}
    </Button>
  )
}

function ConceptLeaf({ concept, ctx }: { concept: { key?: string | null; name: string; kind?: string | null }; ctx: RowContext }) {
  const key = concept.key ?? null
  const ticks = ctx.ticks
  return (
    <li className="list-none">
      {/* A row, not a button: the tick is its own control and a button cannot nest in one. */}
      <div className="group/concept flex w-full items-center gap-1.5 rounded-md py-0.5 pl-2 pr-1 text-meta text-muted-foreground hover:bg-brand/5">
        <Button
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start gap-1.5 p-0 text-left text-meta font-normal hover:bg-transparent hover:text-foreground [&_svg]:size-3"
          onClick={() => key && ctx.onSelectConcept?.(key)}
          disabled={!key}
          title={concept.kind ? `${concept.kind} — open concept` : "open concept"}
        >
          <Sparkles className="text-ink-accent" />
          <span className="min-w-0 flex-1 truncate">{concept.name}</span>
        </Button>
        {concept.kind && (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-micro opacity-0 transition-opacity group-hover/concept:opacity-100">
            {concept.kind}
          </span>
        )}
        {ticks && key ? (
          <ReviewTick done={ticks.reviewedToday.has(key)} busy={ticks.gradingKey === key} onTick={() => ticks.tick(key)} />
        ) : null}
      </div>
      {ticks && key && ticks.failedKey === key && (
        <ErrorNotice compact title="Not saved" error={ticks.error} onRetry={ticks.retry} className="pl-6" />
      )}
    </li>
  )
}

function retentionTone(pct: number): string {
  if (pct >= 90) return "bg-status-mastered/10 text-ink-ok"
  if (pct >= 70) return "bg-brand/10 text-ink-accent"
  if (pct > 0) return "bg-status-due/10 text-ink-warn"
  return "bg-muted text-muted-foreground"
}

export function TreeRow({ node, depth, ctx }: { node: LearnTreeNode; depth: number; ctx: RowContext }) {
  const { filter } = ctx
  if (filter && !nodeMatchesFilter(node, filter)) return null

  // Concept leaves render under their section like sub-entries: the concept layer made
  // visible in the course's main navigation.
  const conceptLeaves = (ctx.onSelectConcept && node.concepts) || []
  const hasChildren = node.children.length > 0 || conceptLeaves.length > 0
  const isExpanded = ctx.expanded.has(node.id)
  const isSelected = node.sectionKey != null && node.sectionKey === ctx.selectedScope
  const isSection = node.isSection
  const sm = isSection && node.sectionKey ? ctx.masteryBySection?.[node.sectionKey] : undefined
  const masteryPct = sm && sm.retention != null ? Math.round(sm.retention * 100) : null
  const isChapter = depth === 0
  const concepts = node.conceptCount ?? 0

  return (
    <li className={cn("list-none", isChapter && "mt-1 first:mt-0")}>
      <div
        className={cn(
          "group flex items-start gap-1 rounded-md py-1 pl-1 pr-1 text-body",
          isChapter && "py-1.5",
          isSelected && "bg-brand/15 text-foreground",
          isSection && "cursor-pointer hover:bg-muted/60",
        )}
      >
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground hover:bg-transparent"
            onClick={(e) => {
              e.stopPropagation()
              ctx.onToggleExpand(node.id)
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {isSection ? <ConceptMasteryDot state={sm?.state} retention={sm?.retention} className="mt-1" /> : null}
        <Button
          variant="ghost"
          className={cn(
            "h-auto min-w-0 flex-1 justify-start whitespace-normal p-0 text-left font-normal leading-snug hover:bg-transparent disabled:opacity-100",
            !isSection && "pl-1 text-meta text-muted-foreground",
          )}
          onClick={() => {
            if (isSection && node.sectionKey) ctx.onSelect(node)
          }}
          disabled={!isSection}
        >
          {isSection ? (
            <span className={cn("font-medium", isChapter && "text-title font-semibold")}>
              {numberedSectionTitle(ctx.numbers.get(node.id), node.label, node.title)}
            </span>
          ) : (
            <span className="break-words">{node.label}</span>
          )}
        </Button>
        {isSection && concepts > 0 ? (
          <span
            className="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-micro font-medium tabular-nums text-ink-accent"
            title={`${concepts} concept${concepts === 1 ? "" : "s"}`}
          >
            {concepts}
          </span>
        ) : null}
        {isSection && concepts > 0 && masteryPct != null ? (
          <span
            className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium tabular-nums", retentionTone(masteryPct))}
            title={`${masteryPct}% retention (${sm?.state ?? "new"})`}
          >
            {masteryPct}%
          </span>
        ) : null}
        {isSection && node.sectionKey ? (
          <ExtractControl scope={node.sectionKey} docId={ctx.docId} prominent={isChapter && concepts === 0} />
        ) : null}
      </div>
      {hasChildren && isExpanded ? (
        // Indent guide: each nesting level is a bordered container, so depth reads as a rail.
        <ul className="ml-[0.95rem] border-l border-border/50 pl-1.5">
          {conceptLeaves.map((c) =>
            filter && !c.name.toLowerCase().includes(filter.toLowerCase()) ? null : (
              <ConceptLeaf key={c.key ?? c.name} concept={c} ctx={ctx} />
            ),
          )}
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} ctx={ctx} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
