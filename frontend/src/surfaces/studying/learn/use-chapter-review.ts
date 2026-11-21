"use client"

/** What the chapter hub's Review card and the Learn page read (v0.32.0): the chapter's review
 *  queue split into due concepts and not-yet-learned concepts per section, plus the chapter's
 *  concept pool (wrong options for the pick step).
 *
 *  "Learned" = the concept has a review card (seeded by its first self-grade). */

import { useMemo } from "react"
import { fetchDocumentConcepts } from "@/gateways/api/concepts"
import type { LearnTreeNode } from "@/gateways/api/outline"
import { fetchReviewQueue } from "@/gateways/api/review"
import { qk, unwrap, useApi } from "@/kit/data"
import type { LearnConcept } from "@/surfaces/studying/learn/learn-model"

const LIMIT = 200

function within(node: LearnTreeNode, key: string | undefined | null): boolean {
  if (!key) return false
  return node.sectionKey === key || node.children.some((c) => within(c, key))
}

export type ChapterReview = {
  loading: boolean
  error: string | null
  /** Concept cards due now in this chapter: what "Review now" serves, in that order. */
  due: LearnConcept[]
  /** Concepts learned and scheduled for later. */
  later: number
  /** Every concept in the chapter with a definition: the source of wrong options. */
  pool: LearnConcept[]
  /** The comprehensive chapter review (human, 2026-11-21: always available, the whole chapter):
   *  due concepts first, then every other concept in book order. */
  chapterSet: LearnConcept[]
  /** Concepts never reviewed. */
  newCount: number
  /** Every chapter concept in book order (the review page's master list). */
  bookOrder: LearnConcept[]
  /** due · new (never reviewed) · learned (has a card, not due). */
  status: (key: string) => "due" | "new" | "learned"
}

export function useChapterReview(
  docId: string | undefined | null,
  chapter: LearnTreeNode | undefined,
): ChapterReview {
  const scope = chapter?.sectionKey ?? ""
  const queue = useApi(
    qk.reviewQueue(docId, scope, LIMIT),
    (signal) => unwrap(fetchReviewQueue(docId ?? undefined, scope, LIMIT, signal)),
    { enabled: Boolean(docId && scope) },
  )
  const concepts = useApi(qk.concepts(docId), (signal) => unwrap(fetchDocumentConcepts(docId ?? undefined, signal)), {
    enabled: Boolean(docId),
  })

  return useMemo(() => {
    const cards = (queue.data?.cards ?? []).filter((c) => !c.itemType || c.itemType === "concept")
    const toConcept = (c: { conceptKey: string; name: string; kind: string; signal: string; source?: string | null; sectionKey: string }): LearnConcept => ({
      key: c.conceptKey,
      name: c.name,
      kind: c.kind,
      signal: c.signal,
      source: c.source,
      sectionKey: c.sectionKey,
    })
    const due = cards.filter((c) => c.state !== "new").map(toConcept)
    const fresh = cards.filter((c) => c.state === "new").map(toConcept)
    // One entry per concept name: extraction can list the same concept twice under two keys.
    const names = new Set<string>()
    const pool = chapter
      ? (concepts.data?.concepts ?? [])
          .filter((c) => c.conceptKey && c.signal && within(chapter, c.sectionKey))
          .filter((c) => {
            const n = c.name.trim().toLowerCase()
            if (names.has(n)) return false
            names.add(n)
            return true
          })
          .map((c) => ({ key: c.conceptKey!, name: c.name, kind: c.kind, signal: c.signal, source: c.source, sectionKey: c.sectionKey! }))
      : []
    const dueKeys = new Set(due.map((c) => c.key))
    const rest = pool.filter((c) => !dueKeys.has(c.key))
    const inPool = new Set(pool.map((c) => c.key))
    const freshKeys = new Set(fresh.map((c) => c.key))
    return {
      bookOrder: [...pool, ...[...due, ...fresh].filter((c) => !inPool.has(c.key) && !names.has(c.name.trim().toLowerCase()))],
      status: (k: string) => (dueKeys.has(k) ? "due" : freshKeys.has(k) ? "new" : "learned"),
      chapterSet: [...due, ...rest, ...fresh.filter((c) => !inPool.has(c.key) && !dueKeys.has(c.key) && !names.has(c.name.trim().toLowerCase()))],
      newCount: fresh.length,
      loading: queue.status === "loading" || concepts.status === "loading",
      error: queue.error?.message ?? null,
      due,
      later: queue.data?.counts.later ?? 0,
      pool,
    }
  }, [queue.data, queue.status, queue.error, concepts.data, concepts.status, chapter])
}
