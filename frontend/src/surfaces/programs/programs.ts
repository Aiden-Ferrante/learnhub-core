/** Programs (human, 2026-11-21): courses build toward programs, the way courses build toward a
 *  degree. A program (Data Science) holds tracks (Machine Learning, Python …); a track holds
 *  courses in a suggested order. One course may sit in many tracks and many programs.
 *  "Mostly just a UI layer to look nice for now": saved in user settings (`programs`), and
 *  progress is real study data: concepts studied, and courses done (≥ 90 % of concepts studied).
 *  Pure model; no React, no fetching. */

export type ProgramTrack = { id: string; name: string; courseIds: string[] }
export type Program = { id: string; name: string; goal: string; tracks: ProgramTrack[] }
export type ProgramsState = { programs: Program[] }

/** A course counts as done once this share of its concepts has been studied. */
export const DONE_AT = 0.9
export const EMPTY_PROGRAMS: ProgramsState = { programs: [] }

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Older saves carried credits and track rules (dropped 2026-11-21: "the credit system doesn't
 *  really mean anything"); they are ignored here and gone at the next write. */
export function normalizePrograms(raw: unknown): ProgramsState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_PROGRAMS
  const r = raw as { programs?: unknown }
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const programs = (Array.isArray(r.programs) ? r.programs : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as Program).id === "string")
    .map((p) => ({
      id: p.id as string,
      name: str(p.name) || "Untitled program",
      goal: str(p.goal),
      tracks: (Array.isArray(p.tracks) ? p.tracks : [])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as ProgramTrack).id === "string")
        .map((t) => ({
          id: t.id as string,
          name: str(t.name) || "Untitled track",
          courseIds: (Array.isArray(t.courseIds) ? t.courseIds : []).filter((c): c is string => typeof c === "string"),
        })),
    }))
  return { programs }
}

export function countLabel(t: ProgramTrack): string {
  const n = t.courseIds.length
  return n === 0 ? "no courses yet" : n === 1 ? "1 course" : `${n} courses`
}

/** A course's concepts: how many there are and how many you have studied (reviewed at least once). */
export type ConceptsOf = (courseId: string) => { studied: number; total: number }
export const shareOf = (c: { studied: number; total: number }) => (c.total > 0 ? c.studied / c.total : 0)

export type CourseStatus = "done" | "going" | "new"
export const statusOf = (share: number): CourseStatus => (share >= DONE_AT ? "done" : share > 0 ? "going" : "new")

export type Progress = {
  /** Concepts studied / concepts in all the courses (each course counted once). */
  studied: number
  total: number
  done: number
  going: number
  count: number
}

/** Progress over a set of courses, each counted once (a course in two tracks is one course). */
export function progressOf(courseIds: string[], concepts: ConceptsOf): Progress {
  const ids = Array.from(new Set(courseIds))
  const out: Progress = { studied: 0, total: 0, done: 0, going: 0, count: ids.length }
  for (const id of ids) {
    const c = concepts(id)
    out.studied += c.studied
    out.total += c.total
    const st = statusOf(shareOf(c))
    if (st === "done") out.done++
    else if (st === "going") out.going++
  }
  return out
}
export const trackProgress = (t: ProgramTrack, concepts: ConceptsOf) => progressOf(t.courseIds, concepts)
export const programProgress = (p: Program, concepts: ConceptsOf) => progressOf(p.tracks.flatMap((t) => t.courseIds), concepts)

export const pctOf = (p: Progress) => (p.total > 0 ? Math.min(100, Math.round((p.studied / p.total) * 100)) : 0)
/** 1450 → "1,450". */
export const num = (n: number) => n.toLocaleString("en-US")

/** The first course in a track's order that is not done. */
export function nextInTrack(t: ProgramTrack, share: (id: string) => number, exists: (id: string) => boolean): string | null {
  return t.courseIds.find((id) => exists(id) && share(id) < DONE_AT) ?? null
}

/** A program's next course: in progress first (furthest along), else the first not started, by track order. */
export function nextInProgram(p: Program, share: (id: string) => number, exists: (id: string) => boolean): string | null {
  const ids = p.tracks.flatMap((t) => t.courseIds).filter(exists)
  const going = ids.filter((id) => statusOf(share(id)) === "going").sort((a, b) => share(b) - share(a))
  return going[0] ?? ids.find((id) => share(id) < DONE_AT) ?? null
}

/** Every program › track a course counts toward. */
export function placements(s: ProgramsState, courseId: string): { program: Program; track: ProgramTrack }[] {
  return s.programs.flatMap((program) => program.tracks.filter((t) => t.courseIds.includes(courseId)).map((track) => ({ program, track })))
}

/** The other tracks (anywhere) a course is in. */
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

export function addTrack(s: ProgramsState, pid: string, name: string): { state: ProgramsState; id: string } {
  const id = newId("t")
  return { state: mapProgram(s, pid, (p) => ({ ...p, tracks: [...p.tracks, { id, name: name.trim() || "New track", courseIds: [] }] })), id }
}
export const renameTrack = (s: ProgramsState, pid: string, tid: string, name: string) =>
  mapTrack(s, pid, tid, (t) => ({ ...t, name: name.trim() || t.name }))
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
/** Courses that are in no program at all (the Library home's "not in a program" count). */
export function unplacedCourses(s: ProgramsState, courseIds: string[]): string[] {
  const placed = new Set(s.programs.flatMap((p) => p.tracks.flatMap((t) => t.courseIds)))
  return courseIds.filter((id) => !placed.has(id))
}
