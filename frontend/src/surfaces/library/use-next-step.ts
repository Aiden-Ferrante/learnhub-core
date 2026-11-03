"use client"

/** THE next-step rule (docs/ui-spec.md §3), used by the Library Today panel and the
 *  course-home hero alike, so the two can never pick different actions:
 *
 *    1. `Review N` when reviews are due in this course,
 *    2. else the active pack's next step (`Continue <pack>`),
 *    3. else `Continue reading <chapter>` (or `Start reading`).
 *
 *  The active pack is the first READY pack the packs list returns; its step is that
 *  pack's Today `now`. A pack with nothing to do now falls through to reading. */

import type { PackSummary, PlanStep } from "@/gateways/api/packs"
import type { ApiQuery } from "@/kit/data"
import { chapterHref } from "@/kit/lib/scope-url"
import { usePacks, usePackToday } from "@/surfaces/library/use-library-queries"

export type NextStep =
  | { kind: "review"; label: string; href: string; due: number }
  | { kind: "pack"; label: string; href: string; pack: PackSummary; step: PlanStep }
  | { kind: "read"; label: string; href: string; sectionKey: string | null }

export type NextStepInput = {
  courseId: string
  /** The course's learnDocId (active version). Packs are keyed by it. */
  docId: string | undefined
  /** Reviews due now in this course; null = unknown (the debt read failed or is loading). */
  dueNow: number | null
  continueSectionKey: string | null | undefined
  /** Display title of the continue chapter, when the caller has the tree. */
  continueTitle?: string | null
}

export type NextStepResult = {
  /** null while the rule cannot decide yet (packs still loading). */
  step: NextStep | null
  packs: ApiQuery<{ packs: PackSummary[] }>
  activePack: PackSummary | null
  today: ApiQuery<{ now: PlanStep | null; next: PlanStep[]; examDate: string | null }>
}

export function useNextStep({
  courseId,
  docId,
  dueNow,
  continueSectionKey,
  continueTitle,
}: NextStepInput): NextStepResult {
  const packs = usePacks(docId)
  const activePack = packs.data?.packs.find((p) => p.status === "ready") ?? null
  const today = usePackToday(activePack?.key, !!activePack)

  const base = `/courses/${courseId}`
  let step: NextStep | null
  if (dueNow != null && dueNow > 0) {
    step = { kind: "review", label: `Review ${dueNow}`, href: `${base}/review`, due: dueNow }
  } else if ((docId && packs.status === "loading") || (activePack && today.status === "loading")) {
    step = null
  } else if (activePack && today.data?.now) {
    step = {
      kind: "pack",
      label: `Continue ${activePack.title}`,
      href: `${base}/packs/${encodeURIComponent(activePack.key)}?tab=today`,
      pack: activePack,
      step: today.data.now,
    }
  } else {
    const key = continueSectionKey ?? null
    step = {
      kind: "read",
      label: key ? `Continue reading${continueTitle ? ` ${continueTitle}` : ""}` : "Start reading",
      href: chapterHref(courseId, key),
      sectionKey: key,
    }
  }
  return { step, packs, activePack, today }
}
