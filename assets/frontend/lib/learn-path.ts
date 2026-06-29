import type { StudyMode } from "@/components/learn/section-panel"

/** A stage in the guided chapter journey. `mode` maps it to the study panel it opens;
 *  `lead` is the one-line narration shown at the seam in Guided mode. */
export type PathStage = {
  key: string
  mode: Exclude<StudyMode, null>
  label: string
  lead: string
}

// The chapter is one act of construction: orient → scaffold → hang → test → load-test → set.
// This is the single source of truth for the path (shared by the stepper, the Continue
// engine, and Guided narration).
export const PATH_STAGES: PathStage[] = [
  { key: "orient", mode: "orient", label: "Orient", lead: "See where this chapter is headed before you dive in." },
  // Unified top-down walk: frame the chapter, then descend each branch — recall its sub-sections,
  // then learn their concepts — before the next branch. (Keeps stage key "skeleton" so existing
  // chapter-progress + the gradeSkeleton "done" signal carry over.)
  { key: "skeleton", mode: "learn", label: "Learn", lead: "Build the chapter top-down — frame it, then learn each branch in turn." },
  { key: "read", mode: "read", label: "Read", lead: "Read it through with that shape already in mind." },
  { key: "quizzes", mode: "conceptQuiz", label: "Quizzes", lead: "Test the joints — quick checks on what you just learned." },
  { key: "exam", mode: "exam", label: "Exam", lead: "Load-test the whole chapter in one sitting." },
  { key: "lockin", mode: "lockin", label: "Lock in", lead: "Let it set — the keepers go into spaced review." },
]

export function stageForMode(mode: StudyMode): PathStage | null {
  return PATH_STAGES.find((s) => s.mode === mode) ?? null
}

export function stageIndexForMode(mode: StudyMode): number {
  return PATH_STAGES.findIndex((s) => s.mode === mode)
}

/** The next stage within the same chapter, or null if `mode` is the last stage or off-path. */
export function nextStage(mode: StudyMode): PathStage | null {
  const i = stageIndexForMode(mode)
  if (i < 0 || i >= PATH_STAGES.length - 1) return null
  return PATH_STAGES[i + 1]
}

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
