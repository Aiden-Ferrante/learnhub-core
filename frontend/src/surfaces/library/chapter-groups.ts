/** Chapter groups on the course page (human, 2026-11-21: "some textbooks have parts that are best
 *  organized as groups of chapters either automatically if the TOC in the original document
 *  organizes it that way or by hand"). Pure model; no React, no fetching.
 *
 *  - Automatic: the outline's "part-container" entries (Part I, Part II … that the TOC
 *    controller hides from the chapter list) each take the chapters that follow them.
 *  - By hand: saved per course in user settings (`chapterGroups[courseId]`). The first edit of an
 *    automatic set copies it; "reset" drops the copy and the book's parts come back. */

export type ChapterGroup = { id: string; name: string; chapterKeys: string[] }
export type CourseChapterGroups = { groups: ChapterGroup[] }
/** courseId → that course's saved groups. Written whole (the settings PUT merges top-level keys). */
export type ChapterGroupsMap = Record<string, CourseChapterGroups>

type OutlineLike = { sectionKey: string; title: string; listDepth: number; hiddenReason?: string | null }

const PART = /^(part|unit|book|section)\b[\s.:]*([ivxlcdm]+|\d+)?[\s.:–—-]*/i

/** The book's parts, from the outline's hidden part containers, in order. A chapter belongs to
 *  the last part above it. Empty when the book has no parts. */
export function autoGroups(outline: OutlineLike[], chapterKeys: string[]): ChapterGroup[] {
  const isChapter = new Set(chapterKeys)
  const out: ChapterGroup[] = []
  let cur: ChapterGroup | null = null
  for (const e of outline) {
    if (e.listDepth !== 0) continue
    if (e.hiddenReason === "part-container") {
      cur = { id: `auto:${e.sectionKey}`, name: e.title.trim(), chapterKeys: [] }
      out.push(cur)
    } else if (cur && isChapter.has(e.sectionKey)) {
      cur.chapterKeys.push(e.sectionKey)
    }
  }
  return out.filter((g) => g.chapterKeys.length > 0)
}

/** "Part II. Distributed Data" → { label: "Part II", title: "Distributed Data" } for the header. */
export function splitPartName(name: string): { label: string | null; title: string } {
  const m = PART.exec(name)
  if (!m || !m[0].trim()) return { label: null, title: name }
  const label = name.slice(0, m[0].length).replace(/[\s.:–—-]+$/, "")
  const title = name.slice(m[0].length).trim()
  return title ? { label, title } : { label: null, title: name }
}

export function normalizeMap(raw: unknown): ChapterGroupsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: ChapterGroupsMap = {}
  for (const [course, v] of Object.entries(raw as Record<string, unknown>)) {
    const groups = (v as { groups?: unknown })?.groups
    if (!Array.isArray(groups)) continue
    out[course] = {
      groups: groups
        .filter((g): g is ChapterGroup => !!g && typeof g.id === "string" && typeof g.name === "string" && Array.isArray(g.chapterKeys))
        .map((g) => ({ id: g.id, name: g.name, chapterKeys: g.chapterKeys.filter((k) => typeof k === "string") })),
    }
  }
  return out
}

const newId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function addGroup(groups: ChapterGroup[], name: string, chapterKey?: string): ChapterGroup[] {
  const g: ChapterGroup = { id: newId(), name: name.trim() || "New group", chapterKeys: [] }
  return moveChapter([...groups, g], chapterKey ?? "", g.id)
}

export function renameGroup(groups: ChapterGroup[], id: string, name: string): ChapterGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name } : g))
}

/** Deleting a group keeps its chapters; they become ungrouped. */
export function removeGroup(groups: ChapterGroup[], id: string): ChapterGroup[] {
  return groups.filter((g) => g.id !== id)
}

/** A chapter is in at most one group; `groupId` null takes it out of every group. */
export function moveChapter(groups: ChapterGroup[], chapterKey: string, groupId: string | null): ChapterGroup[] {
  if (!chapterKey) return groups
  return groups.map((g) => {
    const without = g.chapterKeys.filter((k) => k !== chapterKey)
    return g.id === groupId ? { ...g, chapterKeys: [...without, chapterKey] } : { ...g, chapterKeys: without }
  })
}

export function moveGroup(groups: ChapterGroup[], id: string, dir: -1 | 1): ChapterGroup[] {
  const i = groups.findIndex((g) => g.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= groups.length) return groups
  const out = [...groups]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** The page's sections: each group with its chapters in BOOK order, then the chapters in no group
 *  ("Other chapters"), kept where they fall — ungrouped chapters before the first group lead. */
export function layoutSections<C extends { sectionKey: string | null }>(
  chapters: C[],
  groups: ChapterGroup[],
): { group: ChapterGroup | null; chapters: C[] }[] {
  const order = new Map(chapters.map((c, i) => [c.sectionKey!, i]))
  const placed = new Set<string>()
  const sections = groups.map((g) => {
    const cs = g.chapterKeys
      .filter((k) => order.has(k) && !placed.has(k))
      .sort((a, b) => order.get(a)! - order.get(b)!)
    cs.forEach((k) => placed.add(k))
    return { group: g, chapters: cs.map((k) => chapters[order.get(k)!]) }
  })
  const loose = chapters.filter((c) => !placed.has(c.sectionKey!))
  if (!groups.length) return [{ group: null, chapters }]
  // Nothing grouped yet (e.g. a new, empty group): groups first, then every chapter after them.
  const firstGrouped = placed.size ? Math.min(...Array.from(placed).map((k) => order.get(k)!)) : -1
  const before = loose.filter((c) => order.get(c.sectionKey!)! < firstGrouped)
  const after = loose.filter((c) => order.get(c.sectionKey!)! >= firstGrouped)
  return [
    ...(before.length ? [{ group: null, chapters: before }] : []),
    ...sections,
    ...(after.length ? [{ group: null, chapters: after }] : []),
  ]
}
