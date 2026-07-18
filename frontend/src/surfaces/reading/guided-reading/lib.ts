/** Pure helpers for the guided-reading surface — chapter resolution, heading re-leveling,
 *  margin-note layout, outline numbering, and the shared style tables. No React, no DOM,
 *  no fetches: everything here is unit-testable in isolation. */

import {
  chaptersFromOutline,
  resolveChapterForScope,
  topLevelChapters,
  type CourseChapter,
} from "@/gateways/api/toc"
import type { Measure } from "@/surfaces/reading/use-reading-prefs"
import type { LearnTreeNode, OutlineEntry } from "@/gateways/api/outline"

export type StudyDrawer = "review" | "walk" | "lockin" | "tutor" | "listen" | null

export const DRAWER_TITLES: Record<Exclude<StudyDrawer, null>, string> = {
  review: "Review",
  walk: "Learn — top-down walk",
  lockin: "Lock in",
  tutor: "Tutor",
  listen: "Listen",
}

/** Half the prose measure — where the margin-note column starts (center + half + gap).
 *  Mirrors MEASURE_CLASS in markdown-reader (70/85/100ch). */
export const HALF_MEASURE: Record<Measure, string> = {
  narrow: "35ch",
  normal: "42.5ch",
  wide: "50ch",
}

export type MarginNote = { key: string; idx: number; top: number; name: string; signal: string }

/** The reading units for the deep surface. Numbered chapters (`toc:N`) are the real units
 *  wherever they exist — outline depth 0 can be Parts/front-matter (e.g. DDIA), which carry
 *  no section content of their own. Fall back to depth-0 outline entries, then the TOC tree. */
export function guidedChapters(outline: OutlineEntry[], tree: LearnTreeNode[]): CourseChapter[] {
  const numbered = (outline || []).filter((e) => /^toc:\d+$/.test(e.sectionKey || ""))
  if (numbered.length) return numbered.map((e) => ({ key: e.sectionKey, title: e.title || e.sectionKey }))
  const fromOutline = chaptersFromOutline(outline)
  if (fromOutline.length) return fromOutline
  return topLevelChapters(tree)
}

/** Resolve any incoming position to a key that is GUARANTEED to be one of `chapters` —
 *  resolveChapterForScope's tree fallback can return a top-level Part node, which carries
 *  no section content of its own and would render an empty surface. */
export function resolveGuidedChapter(chapters: CourseChapter[], tree: LearnTreeNode[], scope: string | null): string | null {
  if (chapters.length === 0) return null
  if (!scope) return chapters[0].key
  if (chapters.some((c) => c.key === scope)) return scope
  const num = /^toc:(\d+)/.exec(scope) // e.g. reading position toc:1.2 → chapter toc:1
  if (num && chapters.some((c) => c.key === `toc:${num[1]}`)) return `toc:${num[1]}`
  const { chapterKey } = resolveChapterForScope(chapters, tree, scope)
  if (chapterKey && chapters.some((c) => c.key === chapterKey)) return chapterKey
  return chapters[0].key
}

export function normHeading(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
}

/** The converter stores every heading as `##`, so chapters read as one flat wall. The document
 *  outline knows the real nesting — re-level heading lines (outside code fences) from it. */
export function relevelHeadings(markdown: string, outline: OutlineEntry[], chapterKey: string | null): string {
  if (!outline?.length || !chapterKey) return markdown
  const depthByTitle = new Map<string, number>()
  let chapterDepth: number | null = null
  for (const e of outline) {
    const t = normHeading(e.title || "")
    if (t && !depthByTitle.has(t)) depthByTitle.set(t, e.listDepth)
    if (e.sectionKey === chapterKey && chapterDepth === null) chapterDepth = e.listDepth
  }
  if (chapterDepth === null) return markdown
  const base = chapterDepth
  let inFence = false
  return markdown
    .split("\n")
    .map((line) => {
      if (/^(```|~~~)/.test(line)) inFence = !inFence
      if (inFence) return line
      const m = /^(#{1,6})\s+(.*)$/.exec(line)
      if (!m) return line
      const d = depthByTitle.get(normHeading(m[2]))
      if (d === undefined) return line
      const level = Math.min(5, Math.max(2, 2 + (d - base)))
      return "#".repeat(level) + " " + m[2]
    })
    .join("\n")
}

export function layoutNotes(notes: MarginNote[]): MarginNote[] {
  const sorted = [...notes].sort((a, b) => a.top - b.top)
  let floor = 0
  for (const n of sorted) {
    n.top = Math.max(n.top, floor)
    floor = n.top + 84
  }
  return sorted
}

export type NumberedOutlineItem = { text: string; level: number; num: string }

/** Numbered outline, same convention as the course-dashboard syllabus: the book's own
 *  numbers win (headings that already start with one aren't re-prefixed); otherwise
 *  synthesize hierarchical numbers under the chapter's number (toc:2 → 2.1, 2.1.1, …). */
export function numberOutlineItems(
  outlineItems: { text: string; level: number }[],
  chapterKey: string | null,
): NumberedOutlineItem[] {
  if (outlineItems.length === 0) return []
  const m = chapterKey ? /^toc:(\d+)$/.exec(chapterKey) : null
  const chapterNum = m ? m[1] : null
  // Depth is relative to the chapter heading's level — an unmatched `##` deep in the
  // chapter (e.g. an un-outlined "Summary") must not shift every section down a level.
  const baseSub = (outlineItems[0]?.level ?? 2) + 1
  const counters: number[] = []
  return outlineItems.map((it, i) => {
    if (i === 0) return { ...it, num: chapterNum ?? "" }
    if (/^\d+(\.\d+)*[\s.]/.test(it.text)) return { ...it, num: "" }
    const depth = Math.max(0, it.level - baseSub)
    counters.splice(depth + 1)
    counters[depth] = (counters[depth] || 0) + 1
    for (let d = 0; d < depth; d++) if (!counters[d]) counters[d] = 1
    const num = [chapterNum, ...counters.slice(0, depth + 1)].filter(Boolean).join(".")
    return { ...it, num }
  })
}

