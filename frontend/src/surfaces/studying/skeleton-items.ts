"use client"

import { useMemo } from "react"
import { qk, useApi, type ApiQuery, unwrap } from "@/kit/data"
import { fetchSkeleton } from "@/gateways/api/chapter"
import { fetchSectionConcepts } from "@/gateways/api/concepts"
import type { LearnTreeNode } from "@/gateways/api/outline"

/** Reserved scope for "the whole book". Real section keys are always `toc:*`
 *  (build_tree_from_outline enforces it), so this can never collide with one. */
export const BOOK_SCOPE = "book"

export type Level = "chapters" | "sections" | "concepts"
export type Mode = "recall" | "sort"

export type PracticeItem = {
  key: string
  /** What the learner should produce — the numbered outline title, or the concept name. */
  label: string
  /** Supporting line revealed with the answer (section essence / concept signal). */
  detail?: string
}

export const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: "chapters", label: "Chapters", hint: "Rebuild the book's chapter list" },
  { id: "sections", label: "Sections", hint: "Rebuild a chapter's sections" },
  { id: "concepts", label: "Concepts", hint: "Recall a section's concepts" },
]

/** Sections that can be drilled at each level: chapters = top-level nodes; sections =
 *  any node WITH section children; concepts = any node (its own concepts). */
export function pickable(tree: LearnTreeNode[], level: Level): LearnTreeNode[] {
  const sections = (n: LearnTreeNode) => n.children.filter((c) => c.isSection && c.sectionKey)
  const out: LearnTreeNode[] = []
  const visit = (n: LearnTreeNode) => {
    if (!n.isSection || !n.sectionKey) return
    if (level === "sections" ? sections(n).length > 0 : true) out.push(n)
    n.children.forEach(visit)
  }
  if (level === "chapters") return []
  tree.forEach(visit)
  return out
}

/** A fresh shuffle per round (no seeding needed). */
export function shuffled<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  // A one-item list can't be misordered; anything longer should actually move.
  if (a.length > 1 && a.every((x, i) => x === items[i])) return shuffled(items)
  return a
}

const ready = <T,>(data: T): ApiQuery<T> => ({
  data,
  status: "success",
  refreshing: false,
  error: null,
  retry: () => {},
})

/** The items for one drill, as a query AsyncView can render.
 *
 *  chapters → the tree's top level, no request. sections → the scope's children from the
 *  tree, with essences from the skeleton cache layered on when they arrive (`essences` is
 *  that read, for its own inline error). concepts → the section's extracted concepts.
 *  Each scope is its own cache key and the request is aborted on a switch, so a slow
 *  answer about the previous scope can never land on the current one. */
export function useSkeletonItems({
  level,
  scope,
  scopeNode,
  tree,
  docId,
  label,
}: {
  level: Level
  scope: string | null
  scopeNode: LearnTreeNode | null
  tree: LearnTreeNode[]
  docId?: string
  label: (n: LearnTreeNode) => string
}): { items: ApiQuery<PracticeItem[]>; essences: ApiQuery<unknown> | null } {
  const essences = useApi(
    qk.skeleton(docId, scope),
    (signal) => unwrap(fetchSkeleton(scope, docId, false, signal)),
    { enabled: level === "sections" && Boolean(scope && docId) },
  )
  const concepts = useApi(
    qk.sectionConcepts(docId, scope ?? ""),
    (signal) => unwrap(fetchSectionConcepts(scope ?? "", docId, signal)),
    { enabled: level === "concepts" && Boolean(scope) },
  )

  const chapterItems = useMemo(
    () => tree.filter((n) => n.isSection && n.sectionKey).map((n) => ({ key: n.sectionKey!, label: label(n) })),
    [tree, label],
  )
  const sectionItems = useMemo(() => {
    if (!scopeNode) return []
    const essence = new Map((essences.data?.sections ?? []).map((s) => [s.sectionKey, s.essence]))
    return scopeNode.children
      .filter((c) => c.isSection && c.sectionKey)
      .map((n) => ({ key: n.sectionKey!, label: label(n), detail: essence.get(n.sectionKey!) || undefined }))
  }, [scopeNode, essences.data, label])
  const conceptItems = useMemo(
    () =>
      concepts.data
        ? (concepts.data.concepts ?? []).map((c) => ({
            key: c.conceptKey ?? c.name,
            label: c.name,
            detail: c.signal || undefined,
          }))
        : undefined,
    [concepts.data],
  )

  if (level === "chapters") return { items: ready(chapterItems), essences: null }
  // Essences are a bonus: the structure shows at once, from the tree.
  if (level === "sections") return { items: ready(sectionItems), essences: docId && scope ? essences : null }
  if (!scope) return { items: ready([]), essences: null }
  return { items: { ...concepts, data: conceptItems }, essences: null }
}
