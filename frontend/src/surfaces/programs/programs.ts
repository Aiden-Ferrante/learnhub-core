/** Programs (human, 2026-11-21): courses count toward programs the way credits build toward a
 *  degree. A program (Data Science) holds tracks (Machine Learning, Python …); a track holds
 *  courses in a suggested order. One course may sit in many tracks and many programs.
 *  "Mostly just a UI layer to look nice for now": saved in user settings (`programs`), and
 *  progress is the course's studied share, so credits earned = credits × studied.
 *  Pure model; no React, no fetching. */

export type TrackRule = { kind: "all" } | { kind: "any"; n: number }
export type ProgramTrack = { id: string; name: string; rule: TrackRule; courseIds: string[] }
export type Program = { id: string; name: string; goal: string; tracks: ProgramTrack[] }
export type ProgramsState = {
  programs: Program[]
  /** courseId → credits (DEFAULT_CREDITS when unset). One value per course, in every program. */
  credits: Record<string, number>
}

export const DEFAULT_CREDITS = 3
/** A course counts as done at this studied share. */
export const DONE_AT = 0.9
export const EMPTY_PROGRAMS: ProgramsState = { programs: [], credits: {} }

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function normalizePrograms(raw: unknown): ProgramsState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_PROGRAMS
  const r = raw as { programs?: unknown; credits?: unknown }
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const programs = (Array.isArray(r.programs) ? r.programs : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as Program).id === "string")
    .map((p) => ({
      id: p.id as string,
      name: str(p.name) || "Untitled program",
      goal: str(p.goal),
      tracks: (Array.isArray(p.tracks) ? p.tracks : [])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as ProgramTrack).id === "string")
        .map((t) => {
          const rule = t.rule as TrackRule | undefined
          return {
            id: t.id as string,
            name: str(t.name) || "Untitled track",
            rule: rule?.kind === "any" && Number(rule.n) > 0 ? { kind: "any" as const, n: Math.floor(Number(rule.n)) } : { kind: "all" as const },
            courseIds: (Array.isArray(t.courseIds) ? t.courseIds : []).filter((c): c is string => typeof c === "string"),
          }
        }),
    }))
  const credits: Record<string, number> = {}
  if (r.credits && typeof r.credits === "object") {
    for (const [k, v] of Object.entries(r.credits as Record<string, unknown>)) if (Number(v) >= 0) credits[k] = Number(v)
  }
  return { programs, credits }
}

export const creditsOf = (s: ProgramsState, courseId: string) => s.credits[courseId] ?? DEFAULT_CREDITS

export function ruleLabel(t: ProgramTrack): string {
  if (t.courseIds.length === 0) return "no courses yet"
  if (t.rule.kind === "any") return `any ${t.rule.n} of ${t.courseIds.length}`
  return t.courseIds.length === 1 ? "1 course" : `all ${t.courseIds.length} courses`
}

/** 0..1 studied share of a course (unknown → 0). */
export type StudiedOf = (courseId: string) => number

export type CourseStatus = "done" | "going" | "new"
export const statusOf = (studied: number): CourseStatus => (studied >= DONE_AT ? "done" : studied > 0 ? "going" : "new")

/** Earned credits for one course: done counts in full, otherwise in proportion. */
const earnedOf = (s: ProgramsState, id: string, studied: StudiedOf) => {
  const v = studied(id)
  return v >= DONE_AT ? creditsOf(s, id) : creditsOf(s, id) * v
}

export type Progress = { earned: number; required: number; done: number; count: number }

/** "all": every course is required. "any n": the n courses furthest along count (a missing
 *  course counts DEFAULT_CREDITS toward what is required). */
export function trackProgress(s: ProgramsState, t: ProgramTrack, studied: StudiedOf): Progress {
  const rows = t.courseIds.map((id) => ({ id, credits: creditsOf(s, id), earned: earnedOf(s, id, studied) }))
  const done = t.courseIds.filter((id) => studied(id) >= DONE_AT).length
  if (t.rule.kind === "all") {
    return {
      earned: rows.reduce((a, r) => a + r.earned, 0),
      required: rows.reduce((a, r) => a + r.credits, 0),
      done,
      count: rows.length,
    }
  }
  const n = t.rule.n
  const top = [...rows].sort((a, b) => b.earned - a.earned || b.credits - a.credits).slice(0, n)
  return {
    earned: top.reduce((a, r) => a + r.earned, 0),
    required: top.reduce((a, r) => a + r.credits, 0) + Math.max(0, n - top.length) * DEFAULT_CREDITS,
    done: Math.min(done, n),
    count: n,
  }
}

export function programProgress(s: ProgramsState, p: Program, studied: StudiedOf): Progress {
  return p.tracks
    .map((t) => trackProgress(s, t, studied))
    .reduce((a, b) => ({ earned: a.earned + b.earned, required: a.required + b.required, done: a.done + b.done, count: a.count + b.count }), {
      earned: 0,
      required: 0,
      done: 0,
      count: 0,
    })
}

export const pctOf = (p: Progress) => (p.required > 0 ? Math.min(100, Math.round((p.earned / p.required) * 100)) : 0)
/** 4.5 → "4.5", 4.0 → "4". */
export const cr = (n: number) => (Math.round(n * 10) / 10).toString()

/** The first course in a track's order that is not done. */
export function nextInTrack(t: ProgramTrack, studied: StudiedOf, exists: (id: string) => boolean): string | null {
  return t.courseIds.find((id) => exists(id) && studied(id) < DONE_AT) ?? null
}

/** A program's next course: in progress first (furthest along), else the first not started, by track order. */
export function nextInProgram(p: Program, studied: StudiedOf, exists: (id: string) => boolean): string | null {
  const ids = p.tracks.flatMap((t) => t.courseIds).filter(exists)
  const going = ids.filter((id) => statusOf(studied(id)) === "going").sort((a, b) => studied(b) - studied(a))
  return going[0] ?? ids.find((id) => studied(id) < DONE_AT) ?? null
}

/** Every program › track a course counts toward. */
export function placements(s: ProgramsState, courseId: string): { program: Program; track: ProgramTrack }[] {
  return s.programs.flatMap((program) => program.tracks.filter((t) => t.courseIds.includes(courseId)).map((track) => ({ program, track })))
}

/** Courses in more than one track (anywhere), with the other places they count. */
export function otherPlaces(s: ProgramsState, courseId: string, trackId: string) {
  return placements(s, courseId).filter((x) => x.track.id !== trackId)
}

// ── Edits (pure; each returns a new state) ─────────────────────────────────────────────

const mapProgram = (s: ProgramsState, id: string, f: (p: Program) => Program): ProgramsState => ({
  ...s,
  programs: s.programs.map((p) => (p.id === id ? f(p) : p)),
})
const mapTrack = (s: ProgramsState, pid: string, tid: string, f: (t: ProgramTrack) => ProgramTrack) =>
  mapProgram(s, pid, (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === tid ? f(t) : t)) }))
const swap = <T,>(xs: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir
  if (i < 0 || j < 0 || j >= xs.length) return xs
  const out = [...xs]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

export function addProgram(s: ProgramsState, name: string, goal: string): { state: ProgramsState; id: string } {
  const id = newId("p")
  return { state: { ...s, programs: [...s.programs, { id, name: name.trim() || "New program", goal: goal.trim(), tracks: [] }] }, id }
}
export const editProgram = (s: ProgramsState, id: string, name: string, goal: string) =>
  mapProgram(s, id, (p) => ({ ...p, name: name.trim() || p.name, goal: goal.trim() }))
export const removeProgram = (s: ProgramsState, id: string): ProgramsState => ({ ...s, programs: s.programs.filter((p) => p.id !== id) })
export const moveProgram = (s: ProgramsState, id: string, dir: -1 | 1): ProgramsState => ({
  ...s,
  programs: swap(s.programs, s.programs.findIndex((p) => p.id === id), dir),
})

export function addTrack(s: ProgramsState, pid: string, name: string, rule: TrackRule): { state: ProgramsState; id: string } {
  const id = newId("t")
  return { state: mapProgram(s, pid, (p) => ({ ...p, tracks: [...p.tracks, { id, name: name.trim() || "New track", rule, courseIds: [] }] })), id }
}
export const editTrack = (s: ProgramsState, pid: string, tid: string, name: string, rule: TrackRule) =>
  mapTrack(s, pid, tid, (t) => ({ ...t, name: name.trim() || t.name, rule }))
export const removeTrack = (s: ProgramsState, pid: string, tid: string) =>
  mapProgram(s, pid, (p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== tid) }))
export const moveTrack = (s: ProgramsState, pid: string, tid: string, dir: -1 | 1) =>
  mapProgram(s, pid, (p) => ({ ...p, tracks: swap(p.tracks, p.tracks.findIndex((t) => t.id === tid), dir) }))

/** Put courses into a track (appended in the given order; ones already there stay put). */
export const addCourses = (s: ProgramsState, pid: string, tid: string, ids: string[]) =>
  mapTrack(s, pid, tid, (t) => ({ ...t, courseIds: [...t.courseIds, ...ids.filter((id) => !t.courseIds.includes(id))] }))
export const removeCourse = (s: ProgramsState, pid: string, tid: string, courseId: string) =>
  mapTrack(s, pid, tid, (t) => ({ ...t, courseIds: t.courseIds.filter((c) => c !== courseId) }))
export const moveCourse = (s: ProgramsState, pid: string, tid: string, courseId: string, dir: -1 | 1) =>
  mapTrack(s, pid, tid, (t) => ({ ...t, courseIds: swap(t.courseIds, t.courseIds.indexOf(courseId), dir) }))
export const setCredits = (s: ProgramsState, courseId: string, credits: number): ProgramsState => ({
  ...s,
  credits: { ...s.credits, [courseId]: Math.max(0, Math.round(credits * 2) / 2) },
})

/** Courses that are in no program at all (the Library home's "not in a program" count). */
export function unplacedCourses(s: ProgramsState, courseIds: string[]): string[] {
  const placed = new Set(s.programs.flatMap((p) => p.tracks.flatMap((t) => t.courseIds)))
  return courseIds.filter((id) => !placed.has(id))
}
