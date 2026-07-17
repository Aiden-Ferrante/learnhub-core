/** TOC tree + outline: fetches and the pure tree/numbering helpers every surface shares. */
import { parseJsonResponse } from './http'

export type LearnTreeNode = {
  id: string
  label: string
  title?: string | null
  sectionKey: string | null
  isSection: boolean
  conceptCount?: number
  /** This section's OWN extracted concepts (not rolled up) — clickable leaves in the tree. */
  concepts?: { key?: string | null; name: string; kind?: string | null }[]
  children: LearnTreeNode[]
}

export type TocTreeResponse = {
  tree: LearnTreeNode[]
  sectionCount: number
  error?: string
}

export type OutlineEntry = {
  numberKey: string | null
  title: string
  sectionKey: string
  listDepth: number
  page?: number
}

export async function fetchTocTree(doc?: string): Promise<TocTreeResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/toc-tree${qs}`, { cache: 'no-store' })
  return parseJsonResponse<TocTreeResponse>(res)
}

export type OutlineResponse = { docId?: string; outline: OutlineEntry[]; error?: string }

// The document's outline only (chapter list) — cheap (no markdown), for the chapter reader.
export async function fetchOutline(doc?: string): Promise<OutlineResponse> {
  const qs = doc ? `?doc=${encodeURIComponent(doc)}` : ''
  const res = await fetch(`/api/learn/outline${qs}`, { cache: 'no-store' })
  return parseJsonResponse<OutlineResponse>(res)
}

/** Find a section node by its sectionKey anywhere in the forest. */
export function findNodeBySectionKey(nodes: LearnTreeNode[], key: string): LearnTreeNode | null {
  for (const n of nodes) {
    if (n.sectionKey === key) return n
    const found = findNodeBySectionKey(n.children, key)
    if (found) return found
  }
  return null
}

/** The top-level chapter whose subtree contains `sectionKey` (or that chapter itself).
 *  Used to keep studying chapter-scoped: a click on any section resolves to its chapter. */
export function findChapterForSection(
  forest: LearnTreeNode[],
  sectionKey: string,
): LearnTreeNode | null {
  const contains = (n: LearnTreeNode): boolean =>
    n.sectionKey === sectionKey || n.children.some(contains)
  for (const chapter of forest) {
    if (chapter.isSection && contains(chapter)) return chapter
  }
  return null
}

/** One step of the unified, top-down "learn the chapter" walk.
 *  - `skeleton`: free-recall the direct sub-sections of `ofKey` (the chapter frame when
 *    `ofKey` is the chapter, or a branch's sub-skeleton).
 *  - `concepts`: learn the concepts of a leaf sub-section. */
export type ChapterWalkStep =
  | { kind: 'skeleton'; ofKey: string; childKeys: string[] }
  | { kind: 'concepts'; sectionKey: string }

/**
 * Depth-first chapter walk: frame the chapter (recall its sub-sections), then descend one
 * branch at a time — for each branch, recall its sub-sections, then learn each leaf's concepts
 * before moving on. Produces e.g. [skeleton(ch:1.1–1.4), skeleton(1.1:1.1.1–1.1.2),
 * concepts(1.1.1), concepts(1.1.2), skeleton(1.2:1.2.1–1.2.8), concepts(1.2.1)…].
 */
export function buildChapterWalk(chapter: LearnTreeNode): ChapterWalkStep[] {
  const steps: ChapterWalkStep[] = []
  const kidsOf = (n: LearnTreeNode) => n.children.filter((c) => c.isSection && c.sectionKey)
  const branch = (node: LearnTreeNode) => {
    const kids = kidsOf(node)
    if (kids.length && node.sectionKey) {
      steps.push({ kind: 'skeleton', ofKey: node.sectionKey, childKeys: kids.map((k) => k.sectionKey!) })
      kids.forEach(branch)
    } else if (node.sectionKey) {
      steps.push({ kind: 'concepts', sectionKey: node.sectionKey })
    }
  }
  branch(chapter)
  return steps
}

/** Pre-order list of all section nodes (reading order) in a tree/forest. */
export function flattenSections(nodes: LearnTreeNode[]): LearnTreeNode[] {
  const out: LearnTreeNode[] = []
  const visit = (n: LearnTreeNode) => {
    if (n.isSection && n.sectionKey) out.push(n)
    n.children.forEach(visit)
  }
  nodes.forEach(visit)
  return out
}

/** Count all section nodes in a tree/forest. */
export function countSections(nodes: LearnTreeNode[]): number {
  let n = 0
  for (const node of nodes) {
    if (node.isSection) n++
    n += countSections(node.children)
  }
  return n
}

export function displaySectionTitle(label: string, title?: string | null): string {
  const base = label.startsWith('toc:') ? label.slice(4) || 'Document root' : label
  const heading = (title ?? '').trim()
  if (!heading) return base
  // Slug-keyed sections (preface, contents, …) show the heading — it has real casing
  // where the slug key is lowercased/hyphenated.
  if (!/^\d+(\.\d+)*$/.test(base)) return heading
  // Numbered section whose heading is just the number again → show the number.
  if (heading.toLowerCase() === base.toLowerCase()) return base
  // Otherwise "1.2  Linear Regression"; many headings already carry their own
  // number, so only prepend the section number when it's missing.
  const startsWithNumber = new RegExp(`^${base.replace(/\./g, '\\.')}(\\D|$)`).test(heading)
  return startsWithNumber ? heading : `${base}  ${heading}`
}

const FULL_NUMBER = /^\d+(\.\d+)*$/

/**
 * Hierarchical display number for every section node, keyed by `node.id`.
 * "Keep real, fill gaps": use the source's own number where it has one (a full
 * dotted key like `1.2.3`, or a single segment like a chapter `1`), and
 * synthesize a positional number (`1.1`, `1.2`, …) only for slug-keyed /
 * unnumbered sections, so the outline is *always* numbered. Non-section nodes
 * (entity leaves) are skipped and get no number.
 */
export function numberSections(nodes: LearnTreeNode[]): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (list: LearnTreeNode[], parent: string) => {
    const sections = list.filter((n) => n.isSection)
    // Integer segments already claimed by the source at this level, so a
    // synthesized sibling never collides with a real chapter number.
    const claimed = new Set<number>()
    for (const n of sections) {
      const lab = (n.label ?? "").trim()
      if (/^\d+$/.test(lab)) claimed.add(parseInt(lab, 10))
    }
    let synth = 0
    for (const n of sections) {
      const lab = (n.label ?? "").trim()
      let num: string
      if (FULL_NUMBER.test(lab) && lab.includes(".")) {
        num = lab // the book's own full number, e.g. 1.2.3
      } else if (/^\d+$/.test(lab)) {
        num = parent ? `${parent}.${lab}` : lab // the book's own single segment
      } else {
        do {
          synth++
        } while (claimed.has(synth)) // fill the next free gap
        num = parent ? `${parent}.${synth}` : `${synth}`
      }
      out.set(n.id, num)
      if (n.children?.length) walk(n.children, num)
    }
  }
  walk(nodes, "")
  return out
}

/**
 * `displaySectionTitle` prefixed with a canonical hierarchical `number`,
 * de-duplicating any number the heading already carries (so a numbered key like
 * `1.2.3` plus a heading "1.2.3 Conditional Probability" reads "1.2.3 …", not
 * "1.2.3 1.2.3 …"). Falls back to the plain title when no number is supplied.
 */
export function numberedSectionTitle(
  number: string | undefined,
  label: string,
  title?: string | null,
): string {
  const base = displaySectionTitle(label, title)
  if (!number) return base
  const clean = base.replace(/^\s*\d+(\.\d+)*[ \t]*[.:)–-]?[ \t]+/, "").trim()
  return clean ? `${number}  ${clean}` : number
}

export type ChapterOutlineItem = {
  sectionKey: string
  title: string
  number: string
  depth: number
}

/** The within-chapter outline, flattened from the SAME tree + numberSections map the
 *  course dashboard renders — the reader's rail and in-text numbering derive from this
 *  so they literally cannot disagree with the dashboard. */
export function flattenChapterOutline(
  tree: LearnTreeNode[],
  chapterKey: string,
): ChapterOutlineItem[] {
  const node = findNodeBySectionKey(tree, chapterKey)
  if (!node) return []
  const numbers = numberSections(tree)
  const out: ChapterOutlineItem[] = []
  const walk = (n: LearnTreeNode, depth: number) => {
    if (n.isSection && n.sectionKey) {
      out.push({
        sectionKey: n.sectionKey,
        title: n.title || n.label || n.sectionKey,
        number: numbers.get(n.id) ?? '',
        depth,
      })
    }
    for (const c of n.children || []) walk(c, depth + 1)
  }
  walk(node, 0)
  return out
}

