/** Library search (canvas "LearnHub — Search", 2026-11-21: "Lets get them up!"). Pure model:
 *  no React, no fetching.
 *
 *  Matching is by WORDS for now: a query is split into its content words (stop words like
 *  "how" and "the" dropped, light stemming so "models" finds "model"), and a concept, course
 *  or passage ranks by how many of those words it has. "Meaning" search (embeddings) has no
 *  backend yet; when it lands it replaces `scoreConcept` and everything above stays. */

export type MemoryStatus = "due" | "new" | "learned" | "shaky" | "fading"

export type IndexedConcept = {
  key: string
  /** The course's learnDocId (concepts and reviews are keyed by it). */
  docId: string
  courseId: string
  courseTitle: string
  name: string
  kind: string
  /** The concept's one-line definition (markdown + $math$). */
  signal: string
  source?: string | null
  sectionKey: string
  pageStart?: number | null
  status: MemoryStatus
  retention: number | null
}

/** One idea as every book that explains it: concepts with the same name, across courses. */
export type ConceptGroup = {
  id: string
  name: string
  items: IndexedConcept[]
  score: number
  /** 0–1: the share of the query's words the best item has. */
  share: number
}

const STOP = new Set(
  "a an and are as at be by can do does for from has have how i in into is it its of on or so that the their them then there these this to was what when where which who why will with you your about over under than vs".split(" "),
)

/** Crude English stem: enough that "models", "modeling" and "model" meet. */
export function stem(w: string): string {
  if (w.length <= 4) return w
  for (const suf of ["ations", "ation", "ings", "ing", "ies", "es", "ed", "s"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return suf === "ies" ? w.slice(0, -3) + "y" : w.slice(0, -suf.length)
  }
  return w
}

/** The query's content words, stemmed, deduped. */
export function terms(q: string): string[] {
  const words = q.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1)
  const kept = words.filter((w) => !STOP.has(w))
  return Array.from(new Set((kept.length ? kept : words).map(stem)))
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ")

/** Words → their stems, for matching a text against `terms`. */
function stems(text: string): Set<string> {
  return new Set(plain(text).split(" ").filter(Boolean).map(stem))
}

/** How well a concept matches: name hits count three times a definition hit; covering more
 *  of the query beats repeating one word. */
export function scoreConcept(c: Pick<IndexedConcept, "name" | "signal">, ts: string[]): { score: number; share: number } {
  if (!ts.length) return { score: 0, share: 0 }
  const name = stems(c.name)
  const body = stems(c.signal)
  let covered = 0
  let weight = 0
  for (const t of ts) {
    const inName = name.has(t) || Array.from(name).some((w) => w.startsWith(t) && t.length >= 4)
    const inBody = body.has(t)
    if (inName || inBody) covered++
    weight += (inName ? 3 : 0) + (inBody ? 1 : 0)
  }
  const exact = plain(c.name).trim() === ts.join(" ") ? 5 : 0
  return { score: covered * 10 + weight + exact, share: covered / ts.length }
}

/** "Over-fitting." / "overfitting" / "Overfittings" → one key, so books group together. */
export function nameKey(name: string): string {
  return plain(name)
    .split(" ")
    .filter(Boolean)
    .map(stem)
    .join(" ")
}

/** Every concept grouped by name across books (one item per book: the first wins). */
export function groupByName(index: IndexedConcept[]): Map<string, IndexedConcept[]> {
  const out = new Map<string, IndexedConcept[]>()
  for (const c of index) {
    const k = nameKey(c.name)
    const list = out.get(k) ?? []
    if (!list.some((x) => x.docId === c.docId)) list.push(c)
    out.set(k, list)
  }
  return out
}

/** The concepts that match `q`, grouped across books, best first. */
export function searchConcepts(
  index: IndexedConcept[],
  q: string,
  opts: { docIds?: Set<string> | null; statuses?: Set<MemoryStatus> | null; limit?: number } = {},
): ConceptGroup[] {
  const ts = terms(q)
  if (!ts.length) return []
  const groups = new Map<string, ConceptGroup>()
  for (const c of index) {
    if (opts.docIds && !opts.docIds.has(c.docId)) continue
    if (opts.statuses && !opts.statuses.has(c.status)) continue
    const { score, share } = scoreConcept(c, ts)
    if (share < 0.5 && !(ts.length === 1 && share > 0)) continue
    const id = nameKey(c.name)
    const g = groups.get(id)
    if (!g) groups.set(id, { id, name: c.name, items: [c], score, share })
    else {
      if (!g.items.some((x) => x.docId === c.docId)) g.items.push(c)
      if (score > g.score) Object.assign(g, { score, share, name: c.name })
    }
  }
  return Array.from(groups.values())
    .map((g) => ({ ...g, score: g.score + Math.min(g.items.length - 1, 3) * 2 }))
    .sort((a, b) => b.score - a.score || b.items.length - a.items.length || a.name.localeCompare(b.name))
    .slice(0, opts.limit ?? 200)
}

/** Split `text` into runs, marking the runs whose word matches one of `ts`. */
export function highlight(text: string, ts: string[]): { text: string; hit: boolean }[] {
  if (!ts.length) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  for (const part of text.split(/([A-Za-z0-9]+)/)) {
    if (!part) continue
    const hit = /[A-Za-z0-9]/.test(part) && ts.includes(stem(part.toLowerCase()))
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += part
    else out.push({ text: part, hit })
  }
  return out
}

/** Markdown + math, flattened for one-line previews. */
export function flat(md: string): string {
  return md
    .replace(/^#+\s*/gm, "")
    .replace(/\$\$?([^$]*)\$\$?/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/** "toc:8.2.3" → "8.2.3"; "toc:intro-to-x" → "intro to x". */
export function sectionLabel(key: string): string {
  return key.replace(/^toc:/, "").replace(/-/g, " ")
}

/** A concept's status from its memory record: due beats everything once it has been seen. */
export function statusOf(
  m: { state: string; due?: number | null; scheduleState?: string; retention?: number | null } | undefined,
  nowSec: number,
): MemoryStatus {
  if (!m || m.state === "new" || m.scheduleState === "new") return "new"
  if (m.due != null && m.due <= nowSec) return "due"
  if (m.state === "shaky") return "shaky"
  if (m.state === "fading") return "fading"
  return "learned"
}

export const STATUS_LABEL: Record<MemoryStatus, string> = {
  due: "Due",
  new: "New",
  learned: "Learned",
  shaky: "Shaky",
  fading: "Fading",
}

/** The progress filter's three buckets (results page "My progress"). */
export type ProgressFilter = "due" | "new" | "learned"
export const PROGRESS_BUCKET: Record<MemoryStatus, ProgressFilter> = {
  due: "due",
  new: "new",
  learned: "learned",
  shaky: "learned",
  fading: "learned",
}

/** A picked-concepts review link: `/search/review?c=<doc>:<key>,…&q=<what was searched>`. */
export function reviewHref(items: Pick<IndexedConcept, "docId" | "key">[], label?: string): string {
  const p = new URLSearchParams({ c: items.map((i) => `${i.docId}:${i.key}`).join(",") })
  if (label) p.set("q", label)
  return `/search/review?${p}`
}

export function parseReviewParam(c: string | null): { docId: string; key: string }[] {
  return (c ?? "")
    .split(",")
    .map((x) => x.split(":"))
    .filter((x) => x.length === 2 && x[0] && x[1])
    .map(([docId, key]) => ({ docId, key }))
}

export const conceptGroupHref = (name: string) => `/search/concept?name=${encodeURIComponent(name)}`
export const searchHref = (q: string, extra?: Record<string, string>) =>
  `/search?${new URLSearchParams({ q, ...(extra ?? {}) })}`
