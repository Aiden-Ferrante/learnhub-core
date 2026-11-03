"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, ListTree, Sparkles } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { ErrorNotice } from "@/kit/data"
import { Track } from "@/kit/study"
import { SectionConceptsPanel } from "@/surfaces/concepts"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { WalkRecallStep } from "@/surfaces/studying/chapter-walk-recall"
import { useChapterWalk } from "@/surfaces/studying/use-chapter-walk"
import { useStudyHotkeys } from "@/surfaces/studying/use-study-hotkeys"

type ChapterWalkProps = {
  /** The chapter section key in scope. */
  scope: string | null
  docId?: string
  /** Full syllabus tree — the walk is the scope chapter's subtree of it. */
  tree?: LearnTreeNode[]
  /** A step grade was saved (mastery refresh). */
  onAnswered?: () => void
  /** Walk finished and its grade saved → advance to the next path stage. */
  onComplete?: () => void
}

/**
 * The unified, top-down "learn the chapter" walk: frame the chapter (recall its sections from
 * memory), then descend one branch at a time — recall a branch's sub-sections, then learn each
 * leaf's concepts — before moving to the next branch. Same numbered outline as the TOC; reuses
 * SectionConceptsPanel for the concept steps.
 *
 * Each recall step is a level-by-level retrieval: recall from memory → reveal (compare against
 * the real outline) → self-grade. The chapter's skeleton grade is the AVERAGE of those per-step
 * grades, so the Learn stage reflects how recall actually went (not a blanket "nailed").
 */
export function ChapterWalk({ scope, docId, tree, onAnswered, onComplete }: ChapterWalkProps) {
  const w = useChapterWalk({ scope, docId, tree, onAnswered, onComplete })
  const { step, stepIdx, steps } = w
  const [revealed, setRevealed] = useState(false)
  useEffect(() => setRevealed(false), [stepIdx])

  // → reveals a skeleton step; on concept steps it advances. A revealed skeleton step waits for
  // a self-grade click (kept off inputs the panels use).
  useStudyHotkeys((e) => {
    if (e.key !== "ArrowRight" || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    if (step?.kind === "skeleton") {
      if (!revealed) setRevealed(true)
    } else if (!w.finish.pending) {
      w.goNext()
    }
  })

  if (!scope || !w.chapter) {
    return <p className="p-6 text-sm text-muted-foreground">Open a chapter to start learning.</p>
  }
  if (!steps.length || !step) {
    return <p className="p-6 text-sm text-muted-foreground">No outline for this chapter yet.</p>
  }

  const isFrame = step.kind === "skeleton" && step.ofKey === scope
  const stepTitle =
    step.kind === "skeleton"
      ? isFrame
        ? "Frame the chapter"
        : `Recall · ${w.label(step.ofKey)}`
      : `Concepts · ${w.label(step.sectionKey)}`

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {step.kind === "skeleton" ? (
            <ListTree className="h-4 w-4 shrink-0 text-ink-accent" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0 text-ink-accent" />
          )}
          <span className="truncate">{stepTitle}</span>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          Step {stepIdx + 1} / {steps.length}
        </span>
      </div>
      <Track tone="ok" label="Walk progress" value={(stepIdx / Math.max(1, steps.length - 1)) * 100} />

      {w.sync.error && (
        <ErrorNotice
          compact
          className="px-4 pt-2"
          title="Earlier grades not synced"
          error={w.sync.error}
          onRetry={w.retrySync}
        />
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {step.kind === "skeleton" ? (
          <WalkRecallStep
            key={step.ofKey}
            draftKey={`txt2k:walk-recall:${docId ?? ""}:${step.ofKey}`}
            isFrame={isFrame}
            heading={w.label(step.ofKey)}
            childKeys={step.childKeys}
            nodeFor={w.nodeFor}
            label={w.label}
            essences={w.essences}
            essencesError={w.essencesQuery.status === "error" ? w.essencesQuery.error : null}
            onRetryEssences={w.essencesQuery.retry}
            revealed={revealed}
            onHide={() => setRevealed(false)}
            justGraded={w.justGraded}
            onGrade={w.gradeStep}
            pending={w.stepGrade.pending}
            error={w.stepGrade.error}
            onRetry={w.retryStep}
          />
        ) : (
          <SectionConceptsPanel scope={step.sectionKey} docId={docId} />
        )}
      </div>

      {w.finish.error && (
        <ErrorNotice compact className="px-4 pb-2" title="Not saved" error={w.finish.error} onRetry={w.retryFinish} />
      )}
      <div className="flex items-center justify-between gap-2 border-t bg-card px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={stepIdx === 0}
          onClick={w.goPrev}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        {step.kind === "skeleton" ? (
          !revealed ? (
            <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setRevealed(true)}>
              <Eye className="h-3.5 w-3.5" />
              Reveal
            </Button>
          ) : w.justGraded ? (
            <span className="flex items-center gap-1 text-xs font-medium text-ink-accent">
              <CheckCircle2 className="h-3.5 w-3.5" /> Recorded
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Grade your recall to continue</span>
          )
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            disabled={w.finish.pending}
            onClick={w.goNext}
          >
            {w.isLast ? "Finish chapter" : "Continue"}
            {w.isLast ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
            <kbd className="ml-1 hidden rounded bg-background/20 px-1 text-micro sm:inline">→</kbd>
          </Button>
        )}
      </div>
    </div>
  )
}
