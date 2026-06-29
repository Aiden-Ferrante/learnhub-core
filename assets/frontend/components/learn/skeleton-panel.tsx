"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, Eye, ListTree, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  fetchSkeleton,
  findNodeBySectionKey,
  gradeSkeleton,
  numberSections,
  numberedSectionTitle,
  type LearnTreeNode,
  type SkeletonGrade,
} from "@/lib/learn-service"

type SkeletonPanelProps = {
  scope: string | null
  docId?: string
  /** The full syllabus tree — the skeleton's structure is the scope's subtree of it,
   *  so the skeleton outline is identical to the TOC (same sections/numbers/titles). */
  tree?: LearnTreeNode[]
  /** Bubble the self-grade up (the path uses it for the soft gate). */
  onGraded?: () => void
}

const GRADES: { value: SkeletonGrade; label: string; cls: string }[] = [
  { value: "missed", label: "Missed a lot", cls: "border-rose-500/40 text-rose-400 hover:bg-rose-500/10" },
  { value: "partial", label: "Partial", cls: "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" },
  { value: "most", label: "Most of it", cls: "border-nvidia-green/50 text-nvidia-green hover:bg-nvidia-green/10" },
  { value: "nailed", label: "Nailed it", cls: "border-nvidia-green/60 text-nvidia-green hover:bg-nvidia-green/15" },
]

/** Free-recall the chapter skeleton, reveal it, self-grade. The keystone of the path:
 *  build a durable structural scaffold before drilling into detail.
 *
 *  The revealed skeleton IS the TOC outline for this scope — same sections, order,
 *  numbers and titles as the syllabus tree (rendered from the shared `tree`) — with a
 *  one-line essence overlaid per section (the skeleton's only value-add over the TOC). */
export function SkeletonPanel({ scope, docId, tree, onGraded }: SkeletonPanelProps) {
  const [essences, setEssences] = useState<Record<string, string>>({})
  const [recall, setRecall] = useState("")
  const [revealed, setRevealed] = useState(false)
  const [graded, setGraded] = useState<SkeletonGrade | null>(null)
  // Top-down level-by-level recall: learn/recall one depth of the outline at a time.
  const [levelIdx, setLevelIdx] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Canonical hierarchical numbers — the SAME map the syllabus tree uses.
  const numbers = useMemo(() => numberSections(tree ?? []), [tree])

  // The skeleton's outline = the scope node + its descendant sections, pre-order,
  // depth relative to the scope. Built from the same tree as the TOC, so the two match.
  const rows = useMemo(() => {
    const node = scope ? findNodeBySectionKey(tree ?? [], scope) : null
    const roots: LearnTreeNode[] = scope ? (node ? [node] : []) : tree ?? []
    const out: { node: LearnTreeNode; depth: number }[] = []
    const walk = (n: LearnTreeNode, d: number) => {
      if (!n.isSection) return
      out.push({ node: n, depth: d })
      n.children.forEach((c) => walk(c, d + 1))
    }
    roots.forEach((r) => walk(r, 0))
    return out
  }, [tree, scope])

  // The outline depths you recall, top-down (skip the lone scope root at depth 0).
  const recallDepths = useMemo(() => {
    const rootSingle = rows.filter((r) => r.depth === 0).length <= 1
    const present = new Set<number>()
    for (const r of rows) {
      if (rootSingle && r.depth === 0) continue
      present.add(r.depth)
    }
    const ds = Array.from(present).sort((a, b) => a - b)
    return ds.length ? ds : [rows.reduce((m, r) => Math.max(m, r.depth), 0)]
  }, [rows])

  const currentDepth = recallDepths[Math.min(levelIdx, recallDepths.length - 1)] ?? 0
  const isLastLevel = levelIdx >= recallDepths.length - 1
  const draftKey = `txt2k:skeleton-recall:${docId ?? ""}:${scope ?? ""}:L${currentDepth}`

  // Essences load once per chapter; reset the walk to the top level.
  useEffect(() => {
    if (!scope) return
    let cancelled = false
    setLevelIdx(0)
    setGraded(null)
    fetchSkeleton(scope, docId)
      .then((r) => {
        if (cancelled || r.error) return
        const m: Record<string, string> = {}
        for (const s of r.sections || []) {
          if (s.sectionKey && s.essence) m[s.sectionKey] = s.essence
        }
        setEssences(m)
      })
      .catch(() => {
        /* essence is supplementary — the structure stands on its own */
      })
    return () => {
      cancelled = true
    }
  }, [scope, docId])

  // Each level starts fresh: hide the reveal, load that level's saved recall draft.
  useEffect(() => {
    setRevealed(false)
    try {
      setRecall(window.localStorage.getItem(draftKey) || "")
    } catch {
      setRecall("")
    }
  }, [draftKey])

  const onRecallChange = useCallback(
    (v: string) => {
      setRecall(v)
      try {
        window.localStorage.setItem(draftKey, v)
      } catch {
        /* ignore */
      }
    },
    [draftKey],
  )

  const retryLevel = () => {
    setRevealed(false)
    setTimeout(() => taRef.current?.focus(), 0)
  }

  const nextLevel = () => setLevelIdx((n) => Math.min(recallDepths.length - 1, n + 1))

  const submitGrade = async (g: SkeletonGrade) => {
    setGraded(g)
    await gradeSkeleton(scope, docId, g).catch(() => {})
    onGraded?.()
  }

  if (!scope) {
    return <p className="p-6 text-sm text-muted-foreground">Open a chapter to learn its skeleton.</p>
  }
  if (!rows.length) {
    return <p className="p-6 text-sm text-muted-foreground">No outline for this section yet.</p>
  }

  // Render the outline filtered to depth ≤ maxDepth, optionally spotlighting one depth.
  const renderOutline = (maxDepth: number, highlight?: number) => (
    <ul className="space-y-1 text-sm">
      {rows
        .filter((r) => r.depth <= maxDepth)
        .map(({ node, depth }) => {
          const d = Math.min(depth, 4)
          const essence = node.sectionKey ? essences[node.sectionKey] : ""
          const isHi = depth === highlight
          return (
            <li
              key={node.id}
              style={{ marginLeft: `${d * 1.15}rem` }}
              className={cn(
                "leading-snug",
                d > 0 && "border-l border-border/70 pl-2.5",
                isHi && "rounded-sm bg-brand/5",
              )}
            >
              <span
                className={cn(
                  isHi
                    ? "font-semibold text-brand"
                    : d === 0
                      ? "font-semibold text-foreground"
                      : d === 1
                        ? "font-medium text-foreground/90"
                        : "text-muted-foreground",
                )}
              >
                {numberedSectionTitle(numbers.get(node.id), node.label, node.title)}
              </span>
              {essence && <span className="text-muted-foreground"> — {essence}</span>}
            </li>
          )
        })}
    </ul>
  )

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListTree className="h-4 w-4 text-brand" />
          <span className="text-sm font-medium">Chapter skeleton</span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          Level {Math.min(levelIdx + 1, recallDepths.length)} / {recallDepths.length}
        </span>
      </div>

      {/* The scaffold you've already built — the levels above this one, your context. */}
      {currentDepth > 0 && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">The structure so far</p>
          {renderOutline(currentDepth - 1)}
        </div>
      )}

      {!revealed ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            From memory, recall the{" "}
            <span className="font-medium text-foreground">level&nbsp;{levelIdx + 1}</span> sections —
            the parts that sit under each item above, and in a few words what each covers.
          </p>
          <textarea
            ref={taRef}
            value={recall}
            onChange={(e) => onRecallChange(e.target.value)}
            placeholder={"…"}
            rows={8}
            className="w-full resize-y rounded-md border bg-background p-3 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-brand/50"
          />
          <Button type="button" onClick={() => setRevealed(true)}>
            <Eye className="mr-2 h-4 w-4" />
            Reveal this level
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {recall.trim() && (
            <details className="rounded-lg border bg-muted/20 p-3 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Your recall
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-foreground/90">{recall}</pre>
            </details>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isLastLevel ? "The full skeleton" : `Level ${levelIdx + 1}`}
            </p>
            {renderOutline(currentDepth, currentDepth)}
          </div>

          <div className="space-y-2 border-t pt-3">
            {isLastLevel ? (
              graded ? (
                <p className="text-sm text-brand">
                  Recorded:{" "}
                  <span className="font-medium">{GRADES.find((g) => g.value === graded)?.label}</span>.
                  {graded === "most" || graded === "nailed"
                    ? " Skeleton complete — you've got the whole frame."
                    : " Worth another pass before going deeper."}
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    How complete was your recall of the whole skeleton?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {GRADES.map((g) => (
                      <Button
                        key={g.value}
                        type="button"
                        variant="outline"
                        size="sm"
                        className={g.cls}
                        onClick={() => submitGrade(g.value)}
                      >
                        {g.label}
                      </Button>
                    ))}
                  </div>
                </>
              )
            ) : (
              <Button type="button" onClick={nextLevel} className="gap-1.5">
                Next level
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={retryLevel}
              className="text-muted-foreground"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Try this level again
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
