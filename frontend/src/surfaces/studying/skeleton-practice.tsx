"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Eye, RotateCcw, Shuffle } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { AsyncView, ErrorNotice } from "@/kit/data"
import { Sheet, Tabs } from "@/kit/study"
import { EmptyState } from "@/kit/patterns/empty-state"
import { SkeletonRow } from "@/kit/patterns/skeletons"
import { numberSections, numberedSectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { RecallDrill, SortDrill, type RecallTarget } from "@/surfaces/studying/skeleton-drills"
import { BOOK_SCOPE, LEVELS, pickable, useSkeletonItems, type Level, type Mode } from "@/surfaces/studying/skeleton-items"

/** Course-level structure practice: drill the book's shape at the zoom level you choose,
 *  by recall or by sorting. The reader's ChapterWalk runs the SAME ladder as a guided
 *  sequence for one chapter; this surface is the on-demand version over the whole course.
 *
 *  Levels mirror how the material nests: chapters → sections → concepts.
 *  Modes: recall (self-graded, FSRS-scheduled for structural levels) and sort
 *  (drag-and-drop, PRACTICE-ONLY by design — it writes nothing). The breadcrumbs are the
 *  way back to the course. */
export function SkeletonPractice({
  courseTitle,
  docId,
  tree,
  loading,
  onAnswered,
}: {
  courseTitle: string
  docId?: string
  tree: LearnTreeNode[]
  loading?: boolean
  /** A graded round landed (the shared cache is invalidated regardless). */
  onAnswered?: () => void
}) {
  const [level, setLevel] = useState<Level>("chapters")
  const [scope, setScope] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("recall")
  // Bumped by Restart/Reshuffle: a new key remounts the drill with a fresh round. A
  // background refetch never changes the key, so it can't wipe a grade or a sort.
  const [round, setRound] = useState(0)

  const numbers = useMemo(() => numberSections(tree), [tree])
  const label = useCallback((n: LearnTreeNode) => numberedSectionTitle(numbers.get(n.id), n.label, n.title), [numbers])

  const choices = useMemo(() => pickable(tree, level), [tree, level])
  // Keep the scope valid as the level changes: default to the first legal choice.
  useEffect(() => {
    if (level === "chapters") {
      setScope(null)
      return
    }
    setScope((cur) => (cur && choices.some((c) => c.sectionKey === cur) ? cur : choices[0]?.sectionKey ?? null))
  }, [level, choices])

  const scopeNode = useMemo(() => (scope ? choices.find((c) => c.sectionKey === scope) ?? null : null), [choices, scope])
  const { items, essences } = useSkeletonItems({ level, scope, scopeNode, tree, docId, label })

  // Structural levels ride the same FSRS item the reader's walk grades; the concepts
  // level is drill-only here (graded concept recall lives in the review queue).
  const gradeScope = level === "chapters" ? BOOK_SCOPE : scope
  const target: RecallTarget =
    level !== "concepts" && docId && gradeScope
      ? {
          docId,
          scope: gradeScope,
          heading: level === "chapters" ? courseTitle : scopeNode ? label(scopeNode) : "",
          chapterScope: level === "chapters" ? undefined : scope ?? undefined,
        }
      : null

  const title = level === "chapters" ? courseTitle : scopeNode ? label(scopeNode) : "Pick a scope"
  const prompt =
    level === "chapters"
      ? "List this book's chapters, in order."
      : level === "sections"
        ? "List this chapter's sections, in order."
        : "Name the concepts this section covers."
  const drillKey = `${level}:${scope ?? ""}:${mode}:${round}`
  const hasItems = (items.data?.length ?? 0) > 0

  return (
    <div className="flex flex-col gap-4">
      <Sheet
        title="What are you rebuilding?"
        description="Work down the ladder: the book's chapters, then a chapter's sections, then a section's concepts."
      >
        <Tabs label="Level" value={level} onChange={setLevel} tabs={LEVELS} />

        {level !== "chapters" && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {level === "sections" ? "Chapter" : "Section"}
            <select
              value={scope ?? ""}
              onChange={(e) => setScope(e.target.value || null)}
              className="study-input text-sm"
            >
              {choices.length === 0 && <option value="">Nothing to practice at this level</option>}
              {choices.map((c) => (
                <option key={c.sectionKey} value={c.sectionKey!}>
                  {label(c)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            label="Mode"
            value={mode}
            onChange={setMode}
            tabs={[
              { id: "recall", label: <ModeLabel icon={<Eye className="h-3.5 w-3.5" />} text="Recall" /> },
              { id: "sort", label: <ModeLabel icon={<Shuffle className="h-3.5 w-3.5" />} text="Sort" /> },
            ]}
          />
          <span className="text-xs text-muted-foreground">
            {mode === "recall"
              ? target
                ? "Self-graded — feeds your review schedule."
                : "Drill only — graded concept recall lives in the review queue."
              : "Drill only — sorting never changes your schedule."}
          </span>
        </div>
      </Sheet>

      <Sheet
        title={title}
        description={prompt}
        actions={
          hasItems ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setRound((r) => r + 1)}>
              <RotateCcw className="h-3.5 w-3.5" />
              {mode === "sort" ? "Reshuffle" : "Restart"}
            </Button>
          ) : undefined
        }
      >
        {essences?.status === "error" && (
          <ErrorNotice compact title="Couldn't load section summaries" error={essences.error} onRetry={essences.retry} />
        )}
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : (
          <AsyncView
            q={items}
            errorTitle="Couldn't load this section's concepts"
            isEmpty={(d) => d.length === 0}
            empty={
              <EmptyState
                title="Nothing to rebuild here"
                description={
                  level === "concepts"
                    ? "This section has no extracted concepts yet — build them from the Process tab."
                    : "This scope has no children to practice."
                }
              />
            }
          >
            {(d) =>
              mode === "recall" ? (
                <RecallDrill key={drillKey} items={d} target={target} onAnswered={onAnswered} />
              ) : (
                <SortDrill key={drillKey} items={d} />
              )
            }
          </AsyncView>
        )}
      </Sheet>
    </div>
  )
}

function ModeLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {icon}
      {text}
    </span>
  )
}
