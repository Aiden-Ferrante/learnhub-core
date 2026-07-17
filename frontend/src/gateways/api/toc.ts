/** Pure chapter/TOC algebra shared by the reader surfaces and the popped-out
 *  /reader window: derive the chapter list (outline-first, tree fallback), build the
 *  sidebar tree, and map any clicked section to its owning chapter. No React, no fetch. */

import type { LearnTreeNode, OutlineEntry } from "@/gateways/api/outline"
import type { CourseChapter } from "@/gateways/api/chapter"

export type { CourseChapter }

/** Numeric portion of a toc key, e.g. "toc:1.2" -> "1.2"; null for slug keys. */
export function numberKeyOf(sectionKey: string): string | null {
  const rest = sectionKey.startsWith("toc:") ? sectionKey.slice(4) : sectionKey
  return /^\d+(?:\.\d+)*$/.test(rest) ? rest : null
}
type TreeNodeLike = {
  sectionKey: string | null
  label: string
  title?: string | null
  isSection: boolean
  children: TreeNodeLike[]
}

/** Top-level chapters from the TOC tree (the sections you read one at a time). */
export function topLevelChapters(tree: TreeNodeLike[]): CourseChapter[] {
  const out: CourseChapter[] = []
  for (const node of tree || []) {
    if (node.isSection && node.sectionKey) {
      out.push({ key: node.sectionKey, title: node.title || node.label || node.sectionKey })
    }
  }
  return out
}

function subtreeContains(node: TreeNodeLike, key: string): boolean {
  if (node.sectionKey === key) return true
  return (node.children || []).some((c) => subtreeContains(c, key))
}

/** Map any clicked section to the chapter that should load + the sub-scope to scroll to. */
export function resolveChapterForScope(
  chapters: CourseChapter[],
  tree: TreeNodeLike[],
  scope: string | null,
): { chapterKey: string | null; sub: string | null } {
  if (!scope) return { chapterKey: chapters[0]?.key ?? null, sub: null }
  if (chapters.some((c) => c.key === scope)) return { chapterKey: scope, sub: null }
  for (const node of tree || []) {
    if (node.sectionKey && subtreeContains(node, scope)) return { chapterKey: node.sectionKey, sub: scope }
  }
  const num = numberKeyOf(scope)
  if (num) {
    const ch = "toc:" + num.split(".")[0]
    if (chapters.some((c) => c.key === ch)) return { chapterKey: ch, sub: scope }
  }
  return { chapterKey: chapters[0]?.key ?? null, sub: scope }
}

type OutlineLike = { sectionKey: string; title: string; listDepth: number }

/** Chapters = the top-level (listDepth 0) outline entries — the document's real chapters/parts,
 *  which the TOC tree misses for slug-keyed (unnumbered) books. */
export function chaptersFromOutline(outline: OutlineLike[]): CourseChapter[] {
  const seen = new Set<string>()
  const out: CourseChapter[] = []
  for (const e of outline || []) {
    if (e.listDepth === 0 && e.sectionKey && !seen.has(e.sectionKey)) {
      seen.add(e.sectionKey)
      out.push({ key: e.sectionKey, title: e.title || e.sectionKey })
    }
  }
  return out
}

/** Build a nested TOC tree from the flat outline (nesting by listDepth) for the reader sidebar —
 *  the full chapter/section hierarchy even for slug-keyed books the has_subsection tree misses. */
export function outlineToTree(outline: OutlineEntry[]): LearnTreeNode[] {
  const roots: LearnTreeNode[] = []
  const stack: { depth: number; node: LearnTreeNode }[] = []
  let i = 0
  for (const e of outline || []) {
    if (!e.sectionKey) continue
    const node: LearnTreeNode = {
      id: `${e.sectionKey}#${i++}`,
      label: e.title || e.sectionKey,
      title: e.title ?? null,
      sectionKey: e.sectionKey,
      isSection: true,
      children: [],
    }
    const depth = e.listDepth ?? 0
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].node.children.push(node)
    stack.push({ depth, node })
  }
  return roots
}

/** Map a clicked section to its chapter using the flat outline: walk back to the nearest
 *  preceding listDepth-0 entry. */
export function resolveChapterFromOutline(
  chapters: CourseChapter[],
  outline: OutlineLike[],
  scope: string | null,
): { chapterKey: string | null; sub: string | null } {
  if (!scope) return { chapterKey: chapters[0]?.key ?? null, sub: null }
  if (chapters.some((c) => c.key === scope)) return { chapterKey: scope, sub: null }
  const list = outline || []
  const idx = list.findIndex((e) => e.sectionKey === scope)
  if (idx >= 0) {
    for (let i = idx; i >= 0; i--) {
      if (list[i].listDepth === 0 && chapters.some((c) => c.key === list[i].sectionKey)) {
        return { chapterKey: list[i].sectionKey, sub: scope }
      }
    }
  }
  return { chapterKey: chapters[0]?.key ?? null, sub: scope }
}
