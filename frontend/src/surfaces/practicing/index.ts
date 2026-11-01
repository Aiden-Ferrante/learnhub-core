/** Practicing — DOING the material, in modes on ONE surface.
 *
 *  This file is the surface's HUB: the only legal import surface from outside.
 *  SESSION is the graded activity (prompt → reveal worked solution → 4-button self-grade),
 *  FSRS-scheduled in its own queue, never mixed into concept review. MATCH is drill only:
 *  it pairs concepts you already have, writes one engagement event, and cannot touch the
 *  schedule — the thing to open on a day nothing is due. EXAM is the audit: a frozen paper
 *  across chapters, answered in full BEFORE any worked solution is visible, then marked —
 *  the one assembly that stores a row, so a sitting can be resumed and resat.
 *  PACKS are chapters of one textbook built into Learn plus an exam pool, with their own tabs.
 *  Modes rather than nav tabs is deliberate: `99e4279` deleted seven study modules for
 *  being too many activities.
 *  Depends on: reading (the one renderer + prose prefs), studying (grade scale, hotkeys),
 *  gateways/, kit/. */

export { PracticeSession } from "@/surfaces/practicing/practice-session"
export { MatchGame, maskConceptName } from "@/surfaces/practicing/match-game"
export { ExamMode } from "@/surfaces/practicing/exam-mode"
export { PacksHome } from "@/surfaces/practicing/packs-home"
export { PackView } from "@/surfaces/practicing/pack-view"
