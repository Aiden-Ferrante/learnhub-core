/** Course tags (2026-11-21, replacing course groups: "retire the course groups … shift over to
 *  having a tagging system on the search"). A course has any number of free-text tags; the
 *  Library's search filters by them. Saved in user settings as `courseTags`
 *  (courseId → tags). Pure model; no React, no fetching. */

export type TagMap = Record<string, string[]>

/** Tags are trimmed, single-spaced and compared without case; the first spelling wins. */
export const cleanTag = (t: string) => t.trim().replace(/\s+/g, " ").slice(0, 40)
export const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function normalizeTags(raw: unknown): TagMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const out: TagMap = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue
    const tags = dedupe(v.filter((t): t is string => typeof t === "string").map(cleanTag).filter(Boolean))
    if (tags.length) out[id] = tags
  }
  return out
}

function dedupe(tags: string[]): string[] {
  const out: string[] = []
  for (const t of tags) if (!out.some((x) => sameTag(x, t))) out.push(t)
  return out
}

/** One-time carry-over from the retired course groups: each course gets the names of the
 *  groups it was in. */
export function tagsFromGroups(raw: unknown): TagMap {
  const g = raw as { groups?: { id: string; name: string }[]; membership?: Record<string, string[]> } | null
  if (!g?.groups || !g.membership) return {}
  const name = new Map(g.groups.map((x) => [x.id, x.name]))
  const out: TagMap = {}
  for (const [course, ids] of Object.entries(g.membership)) {
    const tags = dedupe(ids.map((id) => cleanTag(name.get(id) ?? "")).filter(Boolean))
    if (tags.length) out[course] = tags
  }
  return out
}

export function setCourseTags(map: TagMap, courseId: string, tags: string[]): TagMap {
  const next = { ...map }
  const clean = dedupe(tags.map(cleanTag).filter(Boolean))
  if (clean.length) next[courseId] = clean
  else delete next[courseId]
  return next
}

/** Every tag in use with how many courses carry it, most used first, then A–Z. Spelling follows
 *  the first course that used it. */
export function allTags(map: TagMap, courseIds?: Set<string>): { tag: string; count: number }[] {
  const counts: { tag: string; count: number }[] = []
  for (const [id, tags] of Object.entries(map)) {
    if (courseIds && !courseIds.has(id)) continue
    for (const t of tags) {
      const hit = counts.find((c) => sameTag(c.tag, t))
      if (hit) hit.count++
      else counts.push({ tag: t, count: 1 })
    }
  }
  return counts.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** A course matches when it has EVERY picked tag, and the text is in its title, description or a tag. */
export function matches(
  course: { id: string; title: string; description?: string },
  map: TagMap,
  picked: string[],
  text: string,
): boolean {
  const tags = map[course.id] ?? []
  if (!picked.every((p) => tags.some((t) => sameTag(t, p)))) return false
  const q = text.trim().toLowerCase()
  if (!q) return true
  return (
    course.title.toLowerCase().includes(q) ||
    (course.description ?? "").toLowerCase().includes(q) ||
    tags.some((t) => t.toLowerCase().includes(q))
  )
}
