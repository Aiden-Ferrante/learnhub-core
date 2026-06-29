"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, ListTree, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionConceptsPanel } from "@/components/learn/section-concepts-panel"
import {
  buildChapterWalk,
  fetchSkeleton,
  findNodeBySectionKey,
  gradeSkeleton,
  numberSections,
  numberedSectionTitle,
  type LearnTreeNode,
} from "@/lib/learn-service"

type ChapterWalkProps = {
  /** The chapter section key in scope. */
  scope: string | null
  docId?: string
  /** Full syllabus tree — the walk is the scope chapter's subtree of it. */
  tree?: LearnTreeNode[]
  /** Bubble quiz answers up (mastery refresh). */
  onAnswered?: () => void
  /** Walk finished → advance to the next path stage. */
  onComplete?: () => void
}

/**
 * The unified, top-down "learn the chapter" walk: frame the chapter (recall its sections from
 * memory), then descend one branch at a time — recall a branch's sub-sections, then learn each
 * leaf's concepts — before moving to the next branch. Same numbered outline as the TOC; reuses
 * SectionConceptsPanel for the concept steps. Replaces the separate Skeleton + Concepts stages.
 */
export function ChapterWalk({ scope, docId, tree, onAnswered, onComplete }: ChapterWalkProps) {
  const numbers = useMemo(() => numberSections(tree ?? []), [tree])
  const chapter = useMemo(
    () => (scope ? findNodeBySectionKey(tree ?? [], scope) : null),
    [tree, scope],
  )
  const steps = useMemo(() => (chapter ? buildChapterWalk(chapter) : []), [chapter])

  const [stepIdx, setStepIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [recall, setRecall] = useState("")
  const [essences, setEssences] = useState<Record<string, string>>({})

  const progressKey = `txt2k:chapter-walk:${docId ?? ""}:${scope ?? ""}`

  // Resume the saved step + load per-section essences once per chapter.
  useEffect(() => {
    if (!scope) return
    let cancelled = false
    let saved = 0
    try {
      saved = Number(localStorage.getItem(progressKey)) || 0
    } catch {
      saved = 0
    }
    setStepIdx(Math.min(Math.max(0, saved), Math.max(0, steps.length - 1)))
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
        /* essence is supplementary */
      })
    return () => {
      cancelled = true
    }
  }, [scope, docId, progressKey, steps.length])

  const step = steps[Math.min(stepIdx, Math.max(0, steps.length - 1))]
  const draftKey = step?.kind === "skeleton" ? `txt2k:walk-recall:${docId ?? ""}:${step.ofKey}` : ""

  // Each step starts fresh: hide the reveal, load that skeleton step's saved recall draft.
  useEffect(() => {
    setRevealed(false)
    if (!draftKey) {
      setRecall("")
      return
    }
    try {
      setRecall(localStorage.getItem(draftKey) || "")
    } catch {
      setRecall("")
    }
  }, [stepIdx, draftKey])

  useEffect(() => {
    try {
      localStorage.setItem(progressKey, String(stepIdx))
    } catch {
      /* ignore */
    }
  }, [progressKey, stepIdx])

  const isLast = stepIdx >= steps.length - 1

  const goNext = useCallback(() => {
    setStepIdx((i) => {
      if (i >= steps.length - 1) {
        gradeSkeleton(scope, docId, "nailed").catch(() => {}) // mark the Learn stage done
        onComplete?.()
        return i
      }
      return i + 1
    })
  }, [steps.length, scope, docId, onComplete])

  const goPrev = () => setStepIdx((i) => Math.max(0, i - 1))

  // → reveals a skeleton step, then advances (kept off inputs the panels use).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (t && t.isContentEditable) return
      e.preventDefault()
      if (step?.kind === "skeleton" && !revealed) setRevealed(true)
      else goNext()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [step, revealed, goNext])

  const onRecallChange = (v: string) => {
    setRecall(v)
    if (draftKey) {
      try {
        localStorage.setItem(draftKey, v)
      } catch {
        /* ignore */
      }
    }
  }

  if (!scope || !chapter) {
    return <p className="p-6 text-sm text-muted-foreground">Open a chapter to start learning.</p>
  }
  if (!steps.length || !step) {
    return <p className="p-6 text-sm text-muted-foreground">No outline for this chapter yet.</p>
  }

  const nodeFor = (k: string) => findNodeBySectionKey(tree ?? [], k)
  const label = (k: string) => {
    const n = nodeFor(k)
    return n ? numberedSectionTitle(numbers.get(n.id), n.label, n.title) : k
  }

  const isFrame = step.kind === "skeleton" && step.ofKey === scope
  const stepTitle =
    step.kind === "skeleton"
      ? isFrame
        ? "Frame the chapter"
        : `Recall · ${label(step.ofKey)}`
      : `Concepts · ${label(step.sectionKey)}`

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {step.kind === "skeleton" ? (
            <ListTree className="h-4 w-4 shrink-0 text-brand" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0 text-brand" />
          )}
          <span className="truncate">{stepTitle}</span>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          Step {stepIdx + 1} / {steps.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {step.kind === "skeleton" ? (
          <div className="space-y-4 p-6">
            <p className="text-sm text-muted-foreground">
              {isFrame ? (
                "From memory, recall this chapter's main sections — its overall shape."
              ) : (
                <>
                  From memory, recall the sub-sections of{" "}
                  <span className="font-medium text-foreground">{label(step.ofKey)}</span>.
                </>
              )}
            </p>
            {!revealed ? (
              <textarea
                value={recall}
                onChange={(e) => onRecallChange(e.target.value)}
                rows={6}
                placeholder={"1. …\n2. …"}
                className="w-full resize-y rounded-md border bg-background p-3 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-brand/50"
              />
            ) : (
              <ul className="space-y-1 text-sm">
                {step.childKeys.map((k) => {
                  const n = nodeFor(k)
                  if (!n) return null
                  const ess = n.sectionKey ? essences[n.sectionKey] : ""
                  return (
                    <li key={n.id} className="leading-snug">
                      <span className="font-medium">
                        {numberedSectionTitle(numbers.get(n.id), n.label, n.title)}
                      </span>
                      {ess && <span className="text-muted-foreground"> — {ess}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <SectionConceptsPanel scope={step.sectionKey} docId={docId} onAnswered={onAnswered} />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t bg-card px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={stepIdx === 0}
          onClick={goPrev}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        {step.kind === "skeleton" && !revealed ? (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => setRevealed(true)}
          >
            <Eye className="h-3.5 w-3.5" />
            Reveal
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={goNext}
          >
            {isLast ? "Finish chapter" : "Continue"}
            {isLast ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            <kbd className="ml-1 hidden rounded bg-background/20 px-1 text-[10px] sm:inline">→</kbd>
          </Button>
        )}
      </div>
    </div>
  )
}
