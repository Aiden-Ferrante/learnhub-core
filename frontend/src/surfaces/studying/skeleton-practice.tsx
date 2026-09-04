"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Check,
  Eye,
  GripVertical,
  ListTree,
  RotateCcw,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react"
import { Button } from "@/kit/ui/button"
import { SectionCard } from "@/kit/patterns/section-card"
import { EmptyState } from "@/kit/patterns/empty-state"
import { Skeleton } from "@/kit/ui/skeleton"
import { fetchSkeleton } from "@/gateways/api/chapter"
import { fetchSectionConcepts } from "@/gateways/api/concepts"
import {
  numberSections,
  numberedSectionTitle,
  type LearnTreeNode,
} from "@/gateways/api/outline"
import { submitSkeletonReviewGrade, type ReviewGrade } from "@/gateways/api/review"
import { GRADES } from "@/surfaces/studying/grade-scale"
import { cn } from "@/kit/lib/utils"

/** Course-level structure practice: drill the book's shape at the zoom level you choose,
 *  by recall or by sorting. The reader's ChapterWalk runs the SAME ladder as a guided
 *  sequence for one chapter; this surface is the on-demand version over the whole course.
 *
 *  Levels mirror how the material nests: chapters → sections → concepts.
 *  Modes: recall (self-graded, FSRS-scheduled for structural levels) and sort
 *  (drag-and-drop, PRACTICE-ONLY by design — it writes nothing). */

/** Reserved scope for "the whole book". Real section keys are always `toc:*`
 *  (build_tree_from_outline enforces it), so this can never collide with one. */
export const BOOK_SCOPE = "book"

type Level = "chapters" | "sections" | "concepts"
type Mode = "recall" | "sort"

type PracticeItem = {
  key: string
  /** What the learner should produce — the numbered outline title, or the concept name. */
  label: string
  /** Supporting line revealed with the answer (section essence / concept signal). */
  detail?: string
}

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: "chapters", label: "Chapters", hint: "Rebuild the book's chapter list" },
  { value: "sections", label: "Sections", hint: "Rebuild a chapter's sections" },
  { value: "concepts", label: "Concepts", hint: "Recall a section's concepts" },
]

/** Sections that can be drilled at each level: chapters = top-level nodes; sections =
 *  any node WITH section children; concepts = any node (its own concepts). */
function pickable(tree: LearnTreeNode[], level: Level): LearnTreeNode[] {
  const sections = (n: LearnTreeNode) => n.children.filter((c) => c.isSection && c.sectionKey)
  const out: LearnTreeNode[] = []
  const visit = (n: LearnTreeNode) => {
    if (!n.isSection || !n.sectionKey) return
    if (level === "sections" ? sections(n).length > 0 : true) out.push(n)
    n.children.forEach(visit)
  }
  if (level === "chapters") return []
  tree.forEach(visit)
  return out
}

/** Deterministic-enough shuffle for a drill (no seeding needed — a new shuffle per round). */
function shuffled<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  // A one-item list can't be misordered; anything longer should actually move.
  if (a.length > 1 && a.every((x, i) => x === items[i])) return shuffled(items)
  return a
}

export function SkeletonPractice({
  courseTitle,
  docId,
  tree,
  loading,
  onBack,
  onAnswered,
}: {
  courseTitle: string
  docId?: string
  tree: LearnTreeNode[]
  loading?: boolean
  onBack: () => void
  /** A graded round landed — let the caller refresh mastery/due counts. */
  onAnswered?: () => void
}) {
  const [level, setLevel] = useState<Level>("chapters")
  const [scope, setScope] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("recall")

  const numbers = useMemo(() => numberSections(tree), [tree])
  const label = useCallback(
    (n: LearnTreeNode) => numberedSectionTitle(numbers.get(n.id), n.label, n.title),
    [numbers],
  )

  const choices = useMemo(() => pickable(tree, level), [tree, level])
  // Keep the scope valid as the level changes: default to the first legal choice.
  useEffect(() => {
    if (level === "chapters") {
      setScope(null)
      return
    }
    setScope((cur) => (cur && choices.some((c) => c.sectionKey === cur) ? cur : choices[0]?.sectionKey ?? null))
  }, [level, choices])

  const scopeNode = useMemo(
    () => (scope ? choices.find((c) => c.sectionKey === scope) ?? null : null),
    [choices, scope],
  )

  // --- items for the current level/scope --------------------------------------
  const [items, setItems] = useState<PracticeItem[] | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setItemsError(null)

    if (level === "chapters") {
      const chapters = tree.filter((n) => n.isSection && n.sectionKey)
      setItems(chapters.map((n) => ({ key: n.sectionKey!, label: label(n) })))
      return
    }
    if (!scopeNode || !scope) return

    if (level === "sections") {
      const kids = scopeNode.children.filter((c) => c.isSection && c.sectionKey)
      const base = kids.map((n) => ({ key: n.sectionKey!, label: label(n) }))
      setItems(base)
      // Essences are a bonus: the skeleton cache may be pending/stale — show structure regardless.
      if (docId) {
        fetchSkeleton(scope, docId)
          .then((res) => {
            if (cancelled || res.error) return
            const essence = new Map(res.sections.map((s) => [s.sectionKey, s.essence]))
            setItems(base.map((it) => ({ ...it, detail: essence.get(it.key) || undefined })))
          })
          .catch(() => {})
      }
      return
    }

    // concepts
    fetchSectionConcepts(scope, docId)
      .then((res) => {
        if (cancelled) return
        if (res.error) {
          setItemsError(res.error)
          setItems([])
          return
        }
        setItems(
          (res.concepts || []).map((c) => ({
            key: c.conceptKey ?? c.name,
            label: c.name,
            detail: c.signal || undefined,
          })),
        )
      })
      .catch((e) => {
        if (!cancelled) {
          setItemsError(e instanceof Error ? e.message : String(e))
          setItems([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [level, scope, scopeNode, tree, docId, label])

  // --- round state -------------------------------------------------------------
  // A "round" belongs to one drill (level + scope + mode). It resets when you switch
  // drills or hit restart — NEVER on a background refetch, which would otherwise wipe a
  // just-earned grade or an in-progress sort the moment grading refreshes the course.
  const drillKey = `${level}:${scope ?? ""}:${mode}`
  const [revealed, setRevealed] = useState(false)
  const [graded, setGraded] = useState<ReviewGrade | null>(null)
  const [round, setRound] = useState<{ key: string; order: PracticeItem[] }>({ key: "", order: [] })
  const [checked, setChecked] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const order = round.order

  useEffect(() => {
    setRevealed(false)
    setGraded(null)
    setChecked(false)
    setDragKey(null)
  }, [drillKey])

  useEffect(() => {
    if (!items) return
    setRound((cur) =>
      cur.key === drillKey && cur.order.length
        ? cur // same drill, already seeded — a refetch must not disturb it
        : { key: drillKey, order: mode === "sort" ? shuffled(items) : items },
    )
  }, [items, drillKey, mode])

  const resetRound = useCallback(() => {
    setRevealed(false)
    setGraded(null)
    setChecked(false)
    setDragKey(null)
    setRound({ key: drillKey, order: items && items.length ? shuffled(items) : [] })
  }, [items, drillKey])

  // Structural levels ride the same FSRS item the reader's walk grades; the concepts
  // level is drill-only here (graded concept recall lives in the review queue).
  const gradable = level !== "concepts"
  const gradeScope = level === "chapters" ? BOOK_SCOPE : scope
  const gradeHeading = level === "chapters" ? courseTitle : scopeNode ? label(scopeNode) : ""

  const grade = async (g: ReviewGrade) => {
    setGraded(g)
    if (!gradable || !docId || !gradeScope || !items) return
    await submitSkeletonReviewGrade(docId, gradeScope, g, {
      heading: gradeHeading,
      chapterScope: level === "chapters" ? undefined : scope ?? undefined,
      children: items.map((it) => ({ heading: it.label, essence: it.detail ?? "" })),
    })
    onAnswered?.()
  }

  const correctAt = (key: string, i: number) => items?.[i]?.key === key
  const correctCount = order.filter((it, i) => correctAt(it.key, i)).length

  const title =
    level === "chapters" ? courseTitle : scopeNode ? label(scopeNode) : "Pick a scope"
  const prompt =
    level === "chapters"
      ? "List this book's chapters, in order."
      : level === "sections"
        ? "List this chapter's sections, in order."
        : "Name the concepts this section covers."

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Course
        </Button>
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListTree className="h-3.5 w-3.5" />
          Skeleton practice
        </span>
      </div>

      <SectionCard
        title="What are you rebuilding?"
        description="Work down the ladder: the book's chapters, then a chapter's sections, then a section's concepts."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLevel(l.value)}
                title={l.hint}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  level === l.value
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>

          {level !== "chapters" && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {level === "sections" ? "Chapter" : "Section"}
              <select
                value={scope ?? ""}
                onChange={(e) => setScope(e.target.value || null)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus:ring-1 focus:ring-brand/50"
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

          <div className="flex flex-wrap items-center gap-1">
            {(["recall", "sort"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  mode === m
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {m === "recall" ? <Eye className="h-3.5 w-3.5" /> : <Shuffle className="h-3.5 w-3.5" />}
                {m === "recall" ? "Recall" : "Sort"}
              </button>
            ))}
            <span className="ml-1 text-xs text-muted-foreground">
              {mode === "recall"
                ? gradable
                  ? "Self-graded — feeds your review schedule."
                  : "Drill only — graded concept recall lives in the review queue."
                : "Drill only — sorting never changes your schedule."}
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={title}
        description={prompt}
        actions={
          items && items.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={resetRound}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {mode === "sort" ? "Reshuffle" : "Restart"}
            </Button>
          ) : undefined
        }
      >
        {loading || items === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
            <Skeleton className="h-8 w-4/6" />
          </div>
        ) : itemsError ? (
          <p className="text-sm text-destructive">{itemsError}</p>
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing to rebuild here"
            description={
              level === "concepts"
                ? "This section has no extracted concepts yet — build them from the Process tab."
                : "This scope has no children to practice."
            }
          />
        ) : mode === "recall" ? (
          <div className="flex flex-col gap-3">
            {!revealed ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {items.length} item{items.length === 1 ? "" : "s"} to recall. Say them out loud or
                  write them down, then reveal.
                </p>
                <Button className="self-start gap-1.5" onClick={() => setRevealed(true)}>
                  <Eye className="h-4 w-4" />
                  Reveal
                </Button>
              </>
            ) : (
              <>
                <ol className="flex flex-col divide-y divide-border/40">
                  {items.map((it, i) => (
                    <li key={it.key} className="flex items-start gap-2 py-1.5">
                      <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-snug">
                        <span className="block">{it.label}</span>
                        {it.detail && (
                          <span className="block text-xs text-muted-foreground">{it.detail}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap items-center gap-1.5">
                  {graded ? (
                    <span className="flex items-center gap-1.5 text-sm text-brand">
                      <Check className="h-4 w-4" />
                      Graded{gradable ? " — scheduled." : "."}
                    </span>
                  ) : (
                    <>
                      <span className="mr-1 text-xs text-muted-foreground">How did you do?</span>
                      {GRADES.map((g) => (
                        <button
                          key={g.grade}
                          type="button"
                          onClick={() => grade(g.grade)}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                            g.cls,
                          )}
                        >
                          {g.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Drag the {items.length} item{items.length === 1 ? "" : "s"} into the right order, then
              check.
            </p>
            <ul className="flex flex-col gap-1">
              {order.map((it, i) => {
                const ok = correctAt(it.key, i)
                return (
                  <li
                    key={it.key}
                    draggable={!checked}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move"
                      e.dataTransfer.setData("text/plain", it.key) // Firefox needs data to drag
                      setDragKey(it.key)
                    }}
                    onDragEnd={() => setDragKey(null)}
                    onDragOver={(e) => {
                      if (!dragKey || checked || dragKey === it.key) return
                      e.preventDefault()
                      setRound((cur) => {
                        const from = cur.order.findIndex((x) => x.key === dragKey)
                        const to = cur.order.findIndex((x) => x.key === it.key)
                        if (from < 0 || to < 0 || from === to) return cur
                        const next = [...cur.order]
                        const [moved] = next.splice(from, 1)
                        next.splice(to, 0, moved)
                        return { ...cur, order: next }
                      })
                    }}
                    onDrop={(e) => e.preventDefault()}
                    className={cn(
                      "flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm",
                      !checked && "cursor-grab bg-card hover:border-border active:cursor-grabbing",
                      dragKey === it.key && "opacity-40",
                      checked && ok && "border-status-mastered/40 bg-status-mastered/10",
                      checked && !ok && "border-destructive/40 bg-destructive/10",
                      !checked && "border-border/60",
                    )}
                  >
                    <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    {!checked ? (
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : ok ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-mastered" />
                    ) : (
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="block">{it.label}</span>
                      {checked && !ok && (
                        <span className="block text-xs text-muted-foreground">
                          belongs at #{items.findIndex((x) => x.key === it.key) + 1}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
            {checked ? (
              <p className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-brand" />
                <span className="tabular-nums">
                  {correctCount}/{order.length} in place
                </span>
                <span className="text-xs text-muted-foreground">
                  Practice only — nothing was written to your schedule.
                </span>
              </p>
            ) : (
              <Button className="self-start gap-1.5" onClick={() => setChecked(true)}>
                <Check className="h-4 w-4" />
                Check order
              </Button>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
