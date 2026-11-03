"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { GRADE_INVALIDATES, qk, roots, useApi, useApiMutation, unwrap } from "@/kit/data"
import { fetchSkeleton, gradeSkeleton, type SkeletonGrade } from "@/gateways/api/chapter"
import { buildChapterWalk, findNodeBySectionKey, numberSections, numberedSectionTitle, type LearnTreeNode } from "@/gateways/api/outline"
import { submitSkeletonReviewGrade, type ReviewGrade } from "@/gateways/api/review"

// Self-grade scale for each recall step (mirrors the backend GRADE_VALUE). Fill tokens on
// the border, ink tokens on the word, same language as the review grade scale.
export const WALK_GRADES: { value: SkeletonGrade; label: string; cls: string }[] = [
  { value: "missed", label: "Missed a lot", cls: "border-destructive/40 text-ink-danger hover:bg-destructive/10" },
  { value: "partial", label: "Partial", cls: "border-status-due/40 text-ink-warn hover:bg-status-due/10" },
  { value: "most", label: "Most of it", cls: "border-status-mastered/40 text-ink-ok hover:bg-status-mastered/10" },
  { value: "nailed", label: "Nailed it", cls: "border-brand/50 text-ink-accent hover:bg-brand/10" },
]
const GRADE_VALUE: Record<SkeletonGrade, ReviewGrade> = { missed: 1, partial: 2, most: 3, nailed: 4 }
const VALUE_GRADE: Record<number, SkeletonGrade> = { 1: "missed", 2: "partial", 3: "most", 4: "nailed" }

type Snapshot = { heading: string; children: { heading: string; essence?: string }[] }
type StepVars = { ofKey: string; grade: SkeletonGrade } & Snapshot

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null // storage unavailable (private mode): the walk still works, it just won't resume
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* storage unavailable: see read() */
  }
}

/** All of ChapterWalk's state and writes. Step position, per-step grades and recall drafts
 *  persist in localStorage. Every write is a mutation: a step's grade is recorded (and the
 *  walk advances) only once the review system has it; finishing records the chapter's
 *  skeleton grade and calls `onComplete` only once that landed. */
export function useChapterWalk({
  scope,
  docId,
  tree,
  onAnswered,
  onComplete,
}: {
  scope: string | null
  docId?: string
  tree?: LearnTreeNode[]
  onAnswered?: () => void
  onComplete?: () => void
}) {
  const numbers = useMemo(() => numberSections(tree ?? []), [tree])
  const chapter = useMemo(() => (scope ? findNodeBySectionKey(tree ?? [], scope) : null), [tree, scope])
  const steps = useMemo(() => (chapter ? buildChapterWalk(chapter) : []), [chapter])
  const nodeFor = useCallback((k: string) => findNodeBySectionKey(tree ?? [], k), [tree])
  const label = useCallback(
    (k: string) => {
      const n = nodeFor(k)
      return n ? numberedSectionTitle(numbers.get(n.id), n.label, n.title) : k
    },
    [nodeFor, numbers],
  )

  // Per-section essences: supplementary to the reveal, shared with skeleton practice.
  const ess = useApi(qk.skeleton(docId, scope), (signal) => unwrap(fetchSkeleton(scope, docId, false, signal)), {
    enabled: Boolean(scope),
  })
  const essences = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of ess.data?.sections ?? []) if (s.sectionKey && s.essence) m[s.sectionKey] = s.essence
    return m
  }, [ess.data])
  const snapshot = useCallback(
    (ofKey: string, childKeys: string[]): Snapshot => ({
      heading: label(ofKey),
      children: childKeys.map((k) => {
        const n = nodeFor(k)
        return { heading: label(k), essence: (n?.sectionKey && essences[n.sectionKey]) || undefined }
      }),
    }),
    [label, nodeFor, essences],
  )

  const progressKey = `txt2k:chapter-walk:${docId ?? ""}:${scope ?? ""}`
  const gradesKey = `txt2k:walk-grades:${docId ?? ""}:${scope ?? ""}`
  // Set once the saved grades are known to be in the review system — its absence next to
  // saved grades means they predate the SRS wiring and need a one-time backfill sync.
  const syncedKey = `txt2k:walk-synced:${docId ?? ""}:${scope ?? ""}`

  const [stepIdx, setStepIdx] = useState(0)
  const [grades, setGrades] = useState<Record<string, SkeletonGrade>>({})
  const [justGraded, setJustGraded] = useState<SkeletonGrade | null>(null)

  // Resume the saved step and grades once per chapter.
  useEffect(() => {
    if (!scope) return
    const saved = Number(read(progressKey)) || 0
    setStepIdx(Math.min(Math.max(0, saved), Math.max(0, steps.length - 1)))
    try {
      setGrades(JSON.parse(read(gradesKey) || "{}") as Record<string, SkeletonGrade>)
    } catch {
      setGrades({}) // a corrupt saved blob starts the grades over
    }
  }, [scope, progressKey, gradesKey, steps.length])

  useEffect(() => write(progressKey, String(stepIdx)), [progressKey, stepIdx])

  // Feed one step's grade into spaced repetition: the branch becomes a "rebuild from
  // memory" review card (snapshot = the structure just revealed).
  const postStep = (v: StepVars) =>
    unwrap(
      submitSkeletonReviewGrade(docId ?? "", v.ofKey, GRADE_VALUE[v.grade], {
        heading: v.heading,
        chapterScope: scope ?? undefined,
        children: v.children,
      }),
    )

  // One-time backfill of grades recorded before the SRS wiring. Marked synced only when
  // every grade landed, so a failure is shown and retried instead of being lost.
  const sync = useApiMutation(
    (vars: StepVars[]) =>
      Promise.all(
        vars.map((v) => postStep(v)),
      ),
    { invalidates: GRADE_INVALIDATES, onSuccess: () => write(syncedKey, "1") },
  )
  const backfill = useMemo<StepVars[]>(() => {
    const out: StepVars[] = []
    for (const [ofKey, g] of Object.entries(grades)) {
      const s = steps.find((x) => x.kind === "skeleton" && x.ofKey === ofKey)
      if (s && s.kind === "skeleton") out.push({ ofKey, grade: g, ...snapshot(ofKey, s.childKeys) })
    }
    return out
  }, [grades, steps, snapshot])
  const syncTried = useRef<string | null>(null)
  useEffect(() => {
    if (!docId || ess.status === "loading" || syncTried.current === syncedKey) return
    if (read(syncedKey) || backfill.length === 0) return
    syncTried.current = syncedKey
    sync.fire(backfill)
  }, [docId, ess.status, syncedKey, backfill, sync])

  // Finish: the chapter's skeleton grade is the average of the per-step self-grades
  // (default "most" when there was nothing to recall).
  const finish = useApiMutation(
    (g: Record<string, SkeletonGrade>) => {
      const vals = Object.values(g).map((v) => GRADE_VALUE[v])
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 3
      return unwrap(gradeSkeleton(scope, docId, VALUE_GRADE[Math.max(1, Math.min(4, Math.round(avg)))]))
    },
    { invalidates: [roots.chapterProgress], onSuccess: () => onComplete?.() },
  )

  const advance = useCallback(
    (g: Record<string, SkeletonGrade>) => {
      if (stepIdx >= steps.length - 1) finish.fire(g)
      else setStepIdx((i) => Math.min(steps.length - 1, i + 1))
    },
    [stepIdx, steps.length, finish],
  )

  // A saved step grade: persist it, flash "Recorded", then move on (or finish).
  const record = (ofKey: string, g: SkeletonGrade) => {
    const next = { ...grades, [ofKey]: g }
    setGrades(next)
    setJustGraded(g)
    write(gradesKey, JSON.stringify(next))
    window.setTimeout(() => advance(next), 700)
  }
  const stepGrade = useApiMutation(
    (v: StepVars) => postStep(v),
    {
      invalidates: GRADE_INVALIDATES,
      onSuccess: (_r, v) => {
        // Live grades reach the review system directly — never backfill this walk on load.
        write(syncedKey, "1")
        record(v.ofKey, v.grade)
        onAnswered?.()
      },
    },
  )
  const [lastStep, setLastStep] = useState<StepVars | null>(null)

  const step = steps[Math.min(stepIdx, Math.max(0, steps.length - 1))]

  /** Grade the current recall step. Without a docId there is no review system to feed. */
  const gradeStep = (g: SkeletonGrade) => {
    if (step?.kind !== "skeleton" || justGraded || stepGrade.pending) return
    if (!docId) return record(step.ofKey, g)
    const v = { ofKey: step.ofKey, grade: g, ...snapshot(step.ofKey, step.childKeys) }
    setLastStep(v)
    stepGrade.fire(v)
  }

  const { reset: resetStepGrade } = stepGrade
  // A new step starts with no "Recorded" flash and no stale error.
  useEffect(() => {
    setJustGraded(null)
    resetStepGrade()
  }, [stepIdx, resetStepGrade])

  return {
    chapter,
    steps,
    step,
    stepIdx,
    isLast: stepIdx >= steps.length - 1,
    numbers,
    nodeFor,
    label,
    essences,
    essencesQuery: ess,
    justGraded,
    gradeStep,
    stepGrade,
    retryStep: () => lastStep && stepGrade.fire(lastStep),
    sync,
    retrySync: () => sync.fire(backfill),
    finish,
    retryFinish: () => finish.fire(grades),
    goNext: () => advance(grades),
    goPrev: () => setStepIdx((i) => Math.max(0, i - 1)),
  }
}
