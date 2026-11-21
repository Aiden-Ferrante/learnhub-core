/** Learn mode (v0.32.0): the pure model of one session. No React, no fetching.
 *
 *  Human decisions 2026-11-21: Quizlet-like Learn, per section, layout B; a concept goes
 *  Not studied → Learning (picked its definition) → Mastered (explained it in your own words and
 *  graded yourself "Got it"); Missed / Partly come back before the session ends. Wrong options
 *  are other concepts' definitions from the same chapter, never anything outside the book.
 *  Due cards (spaced repetition) run explain-only. */

export type LearnConcept = {
  key: string
  name: string
  kind: string
  signal: string
  source?: string | null
  sectionKey: string
}

export type LearnMode = "learn" | "due"
export type Stage = 0 | 1 | 2 // not studied · learning · mastered
export type SelfGrade = 0 | 1 | 2 // missed · partly · got it

export type LearnStep =
  | { kind: "pick"; key: string; options: string[] } // option = a concept key; the answer is `key`
  | { kind: "explain"; key: string }

/** Stable small hash, so a concept's options come out in the same order every visit. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function stableShuffle<T>(xs: T[], seed: string, keyOf: (x: T) => string): T[] {
  return [...xs].sort((a, b) => hash(seed + keyOf(a)) - hash(seed + keyOf(b)))
}

/** Up to three wrong options for `c`: other concepts with a definition, up to two from its
 *  own section, then the rest of the chapter. Fewer than one → no multiple-choice step for it. */
export function distractors(c: LearnConcept, pool: LearnConcept[], n = 3): string[] {
  // One option per concept: the pool may list a concept twice (queue + document list).
  const seen = new Set<string>([c.key, c.name])
  const others = pool.filter((p) => {
    if (!p.signal.trim() || seen.has(p.key) || seen.has(p.name)) return false
    seen.add(p.key)
    seen.add(p.name)
    return true
  })
  const near = stableShuffle(others.filter((p) => p.sectionKey === c.sectionKey), c.key, (p) => p.key)
  const far = stableShuffle(others.filter((p) => p.sectionKey !== c.sectionKey), c.key, (p) => p.key)
  // At most two from the same section, so the four options are not always the section's own
  // four definitions (answerable by elimination); the rest from elsewhere in the chapter.
  const mixed = [...near.slice(0, 2), ...far, ...near.slice(2)]
  return mixed.slice(0, n).map((p) => p.key)
}

/** The opening queue: learn = every concept picked, then every concept explained;
 *  due = explain only. */
export function firstSteps(concepts: LearnConcept[], pool: LearnConcept[], mode: LearnMode): LearnStep[] {
  const explains: LearnStep[] = concepts.map((c) => ({ kind: "explain", key: c.key }))
  if (mode === "due") return explains
  const picks: LearnStep[] = []
  for (const c of concepts) {
    const wrong = distractors(c, pool)
    if (wrong.length === 0) continue
    picks.push({ kind: "pick", key: c.key, options: stableShuffle([c.key, ...wrong], `${c.key}:opts`, (k) => k) })
  }
  return [...picks, ...explains]
}

export type Session = {
  steps: LearnStep[]
  i: number
  stage: Record<string, Stage>
  /** The first self-grade per concept: what the review card is seeded with. */
  firstGrade: Record<string, SelfGrade>
  misses: Record<string, number>
}

export function startSession(concepts: LearnConcept[], pool: LearnConcept[], mode: LearnMode): Session {
  const stage: Record<string, Stage> = {}
  for (const c of concepts) stage[c.key] = mode === "due" ? 1 : 0
  return { steps: firstSteps(concepts, pool, mode), i: 0, stage, firstGrade: {}, misses: {} }
}

/** A pick answered. Right → Learning; wrong → the same question comes back at the end with
 *  its options reversed. Returns the next session (the step index does not move: the screen
 *  shows feedback first, then `advance`). */
export function answerPick(s: Session, picked: string): Session {
  const step = s.steps[s.i]
  if (!step || step.kind !== "pick") return s
  if (picked === step.key) {
    return { ...s, stage: { ...s.stage, [step.key]: Math.max(s.stage[step.key] ?? 0, 1) as Stage } }
  }
  return {
    ...s,
    steps: [...s.steps, { ...step, options: [...step.options].reverse() }],
    misses: { ...s.misses, [step.key]: (s.misses[step.key] ?? 0) + 1 },
  }
}

/** A self-grade. Got it → Mastered; Missed / Partly → Learning and explained again later.
 *  Moves to the next step. `firstGrade` keeps only the first grade per concept. */
export function gradeExplain(s: Session, g: SelfGrade): Session {
  const step = s.steps[s.i]
  if (!step || step.kind !== "explain") return s
  const firstGrade = step.key in s.firstGrade ? s.firstGrade : { ...s.firstGrade, [step.key]: g }
  if (g === 2) {
    return { ...s, i: s.i + 1, firstGrade, stage: { ...s.stage, [step.key]: 2 } }
  }
  return {
    ...s,
    i: s.i + 1,
    firstGrade,
    stage: { ...s.stage, [step.key]: 1 },
    steps: [...s.steps, { kind: "explain", key: step.key }],
    misses: { ...s.misses, [step.key]: (s.misses[step.key] ?? 0) + 1 },
  }
}

export const advance = (s: Session): Session => ({ ...s, i: s.i + 1 })

/** The review grade a first self-grade seeds: Missed → Again (1), Partly → Hard (2),
 *  Got it → Good (3). */
export const REVIEW_GRADE: Record<SelfGrade, 1 | 2 | 3> = { 0: 1, 1: 2, 2: 3 }
