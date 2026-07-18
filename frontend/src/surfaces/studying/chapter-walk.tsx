"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, ListTree, RotateCcw, Sparkles } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { SectionConceptsPanel } from "@/surfaces/concepts"
import { fetchSkeleton, gradeSkeleton, type SkeletonGrade } from "@/gateways/api/chapter"
import { buildChapterWalk, findNodeBySectionKey, numberSections, numberedSectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { submitSkeletonReviewGrade, type ReviewGrade } from "@/gateways/api/review"
import { useStudyHotkeys } from "@/surfaces/studying/use-study-hotkeys"

type ChapterWalkProps = {
  /** The chapter section key in scope. */
  scope: string | null
  docId?: string
  /** Full syllabus tree — the walk is the scope chapter's subtree of it. */
  tree?: LearnTreeNode[]
  /** Bubble grades up (mastery refresh). */
  onAnswered?: () => void
  /** Walk finished → advance to the next path stage. */
  onComplete?: () => void
}

// Self-grade scale for each recall step (mirrors the backend GRADE_VALUE).
const GRADES: { value: SkeletonGrade; label: string; cls: string }[] = [
  { value: "missed", label: "Missed a lot", cls: "border-rose-500/40 text-rose-400 hover:bg-rose-500/10" },
  { value: "partial", label: "Partial", cls: "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" },
  { value: "most", label: "Most of it", cls: "border-brand/50 text-brand hover:bg-brand/10" },
  { value: "nailed", label: "Nailed it", cls: "border-brand/60 text-brand hover:bg-brand/15" },
]
const GRADE_VALUE: Record<SkeletonGrade, number> = { missed: 1, partial: 2, most: 3, nailed: 4 }
const VALUE_GRADE: Record<number, SkeletonGrade> = { 1: "missed", 2: "partial", 3: "most", 4: "nailed" }

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
  // Per-recall-step self-grades (keyed by the recalled node), averaged into the chapter grade.
  const [grades, setGrades] = useState<Record<string, SkeletonGrade>>({})
  // Brief "Recorded ✓" confirmation shown after grading, before the step advances.
  const [justGraded, setJustGraded] = useState<SkeletonGrade | null>(null)

  const progressKey = `txt2k:chapter-walk:${docId ?? ""}:${scope ?? ""}`
  const gradesKey = `txt2k:walk-grades:${docId ?? ""}:${scope ?? ""}`
  // Set once any grade has been POSTed to the review system — its absence next to saved
  // grades means they predate the SRS wiring and need a one-time backfill sync.
  const syncedKey = `txt2k:walk-synced:${docId ?? ""}:${scope ?? ""}`

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
    let savedGrades: Record<string, SkeletonGrade> = {}
    try {
      const rawGrades = localStorage.getItem(gradesKey)
      savedGrades = rawGrades ? (JSON.parse(rawGrades) as Record<string, SkeletonGrade>) : {}
    } catch {
      savedGrades = {}
    }
    setGrades(savedGrades)

    // One-time backfill: per-step grades recorded before the SRS wiring never reached the
    // review system — post them now so those branches resurface without re-walking.
    const syncSaved = (essMap: Record<string, string>) => {
      if (!docId || cancelled) return
      try {
        if (localStorage.getItem(syncedKey) || !Object.keys(savedGrades).length) return
        localStorage.setItem(syncedKey, "1")
      } catch {
        return
      }
      for (const [ofKey, g] of Object.entries(savedGrades)) {
        const walkStep = steps.find((s) => s.kind === "skeleton" && s.ofKey === ofKey)
        if (!walkStep || walkStep.kind !== "skeleton") continue
        const children = walkStep.childKeys.map((k) => {
          const n = findNodeBySectionKey(tree ?? [], k)
          return {
            heading: n ? numberedSectionTitle(numbers.get(n.id), n.label, n.title) : k,
            essence: (n?.sectionKey && essMap[n.sectionKey]) || undefined,
          }
        })
        const node = findNodeBySectionKey(tree ?? [], ofKey)
        submitSkeletonReviewGrade(docId, ofKey, GRADE_VALUE[g] as ReviewGrade, {
          heading: node ? numberedSectionTitle(numbers.get(node.id), node.label, node.title) : ofKey,
          chapterScope: scope,
          children,
        }).catch(() => {})
      }
    }

    fetchSkeleton(scope, docId)
      .then((r) => {
        if (cancelled) return
        const m: Record<string, string> = {}
        if (!r.error) {
          for (const s of r.sections || []) {
            if (s.sectionKey && s.essence) m[s.sectionKey] = s.essence
          }
          setEssences(m)
        }
        syncSaved(m)
      })
      .catch(() => {
        syncSaved({}) // essence is supplementary; still backfill the grades
      })
    return () => {
      cancelled = true
    }
  }, [scope, docId, progressKey, gradesKey, syncedKey, steps, tree, numbers])

  const step = steps[Math.min(stepIdx, Math.max(0, steps.length - 1))]
  const draftKey = step?.kind === "skeleton" ? `txt2k:walk-recall:${docId ?? ""}:${step.ofKey}` : ""

  // Each step starts fresh: hide the reveal, load that skeleton step's saved recall draft.
  useEffect(() => {
    setRevealed(false)
    setJustGraded(null)
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

  // Finish the walk: record the chapter's skeleton grade as the average of the per-step
  // self-grades (default "most" when there was nothing to recall), then advance the path.
  const finishWith = useCallback(
    (g: Record<string, SkeletonGrade>) => {
      const vals = Object.values(g).map((v) => GRADE_VALUE[v])
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 3
      const overall = VALUE_GRADE[Math.max(1, Math.min(4, Math.round(avg)))]
      gradeSkeleton(scope, docId, overall).catch(() => {})
      onComplete?.()
    },
    [scope, docId, onComplete],
  )

  const goNext = useCallback(() => {
    if (stepIdx >= steps.length - 1) finishWith(grades)
    else setStepIdx((i) => Math.min(steps.length - 1, i + 1))
  }, [stepIdx, steps.length, finishWith, grades])

  const goPrev = () => setStepIdx((i) => Math.max(0, i - 1))

  // Record this recall step's self-grade (persisted so a mid-walk reload keeps it), flash a
  // brief confirmation, then advance — finishing the walk if it was the last step.
  const gradeStep = (g: SkeletonGrade) => {
    if (step?.kind !== "skeleton" || justGraded) return
    const next = { ...grades, [step.ofKey]: g }
    setGrades(next)
    setJustGraded(g)
    try {
      localStorage.setItem(gradesKey, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    // Feed the grade into spaced repetition: this branch becomes a "rebuild from memory"
    // review card on the same SM-2 clock as concepts (snapshot = the structure just revealed).
    if (docId) {
      const children = step.childKeys.map((k) => {
        const n = nodeFor(k)
        return {
          heading: n ? numberedSectionTitle(numbers.get(n.id), n.label, n.title) : k,
          essence: (n?.sectionKey && essences[n.sectionKey]) || undefined,
        }
      })
      submitSkeletonReviewGrade(docId, step.ofKey, GRADE_VALUE[g] as ReviewGrade, {
        heading: label(step.ofKey),
        chapterScope: scope ?? undefined,
        children,
      }).catch(() => {})
      try {
        // Live grades reach the review system directly — never backfill this walk on load.
        localStorage.setItem(syncedKey, "1")
      } catch {
        /* ignore */
      }
    }
    const last = stepIdx >= steps.length - 1
    window.setTimeout(() => {
      if (last) finishWith(next)
      else setStepIdx((i) => Math.min(steps.length - 1, i + 1))
    }, 700)
  }

  // → reveals a skeleton step; on concept steps it advances. A revealed skeleton step waits for
  // a self-grade click (kept off inputs the panels use).
  useStudyHotkeys((e) => {
    if (e.key !== "ArrowRight" || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    if (step?.kind === "skeleton") {
      if (!revealed) setRevealed(true)
    } else {
      goNext()
    }
  })

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
      <div className="h-0.5 w-full bg-muted">
        <div
          className="h-full bg-brand transition-all"
          style={{ width: `${(stepIdx / Math.max(1, steps.length - 1)) * 100}%` }}
        />
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
              <div className="space-y-4">
                {recall.trim() && (
                  <details className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      Your recall
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-foreground/90">{recall}</pre>
                  </details>
                )}
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
                <div className="space-y-2 border-t pt-3">
                  {justGraded ? (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-brand">
                      <CheckCircle2 className="h-4 w-4" />
                      Recorded: {GRADES.find((g) => g.value === justGraded)?.label}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium">How complete was your recall?</p>
                      <div className="flex flex-wrap gap-2">
                        {GRADES.map((g) => (
                          <Button
                            key={g.value}
                            type="button"
                            variant="outline"
                            size="sm"
                            className={g.cls}
                            onClick={() => gradeStep(g.value)}
                          >
                            {g.label}
                          </Button>
                        ))}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevealed(false)}
                        className="text-muted-foreground"
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Try again
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <SectionConceptsPanel scope={step.sectionKey} docId={docId} />
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
        {step.kind === "skeleton" ? (
          !revealed ? (
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => setRevealed(true)}
            >
              <Eye className="h-3.5 w-3.5" />
              Reveal
            </Button>
          ) : justGraded ? (
            <span className="flex items-center gap-1 text-xs font-medium text-brand">
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
