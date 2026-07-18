/** The chapter learning path — a progression RAIL over the deep reading surface
 *  (the old lesson-view mode-switcher is retired; stages now open drawers in place).
 *
 *  Order: meet the chapter first (read), THEN rebuild it from memory (learn) —
 *  recall works better against something you've actually read. Stage keys are
 *  stable ("skeleton" stays "skeleton") so existing chapter_progress carries over. */

export type PathStage = {
  key: string
  label: string
  lead: string
}

// Single source of truth for the path, shared by the rail and the resume logic.
export const PATH_STAGES: PathStage[] = [
  { key: "orient", label: "Orient", lead: "See where this chapter is headed before you dive in." },
  { key: "read", label: "Read", lead: "Read it through — meet the ideas in their own order first." },
  { key: "skeleton", label: "Learn", lead: "Now rebuild it top-down from memory — frame it, then learn each branch." },
  { key: "lockin", label: "Lock in", lead: "Let it set — the keepers go into spaced review." },
]

/** First stage not yet marked done — where "resume" should drop you. Defaults to the last
 *  stage when everything is complete (so a finished chapter resumes at Lock in). */
export function firstIncompleteStage(done: Record<string, boolean>): PathStage {
  return PATH_STAGES.find((s) => !done[s.key]) ?? PATH_STAGES[PATH_STAGES.length - 1]
}

/** Normalize a chapter-progress `stages` map into `{ stageKey: done }`. */
export function doneMap(stages: Record<string, Record<string, unknown>> | undefined): Record<string, boolean> {
  const d: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(stages || {})) d[k] = !!(v as { done?: boolean })?.done
  return d
}
