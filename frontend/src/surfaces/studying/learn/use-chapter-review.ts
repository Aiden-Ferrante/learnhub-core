"use client"

/** What the chapter hub's Review card and the Learn page read (v0.32.0): the chapter's review
 *  queue split into due concepts and not-yet-learned concepts per section, plus the chapter's
 *  concept pool (wrong options for the pick step).
 *
 *  "Learned" = the concept has a review card (seeded by its first self-grade). A section is
 *  ready to learn once read (guided reading marks it) and still has unlearned concepts. */

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
  /** Unlearned concepts per reading section (keyed by the section's sectionKey). */
  unlearned: Map<string, LearnConcept[]>
  /** The first read section with unlearned concepts, in path order. */
  nextLearn: { node: LearnTreeNode; concepts: LearnConcept[] } | null
  /** Concepts learned and scheduled for later. */
  later: number
  /** Every concept in the chapter with a definition: the source of wrong options. */
  pool: LearnConcept[]
}

export function useChapterReview(
  docId: string | undefined | null,
  chapter: LearnTreeNode | undefined,
  sections: LearnTreeNode[],
  read: Set<string>,
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
    const unlearned = new Map<string, LearnConcept[]>()
    for (const s of sections) {
      const mine = fresh.filter((c) => within(s, c.sectionKey))
      if (mine.length) unlearned.set(s.sectionKey!, mine)
    }
    const first = sections.find((s) => read.has(s.sectionKey!) && unlearned.has(s.sectionKey!))
    const pool = chapter
      ? (concepts.data?.concepts ?? [])
          .filter((c) => c.conceptKey && c.signal && within(chapter, c.sectionKey))
          .map((c) => ({ key: c.conceptKey!, name: c.name, kind: c.kind, signal: c.signal, source: c.source, sectionKey: c.sectionKey! }))
      : []
    return {
      loading: queue.status === "loading" || concepts.status === "loading",
      error: queue.error?.message ?? null,
      due,
      unlearned,
      nextLearn: first ? { node: first, concepts: unlearned.get(first.sectionKey!)! } : null,
      later: queue.data?.counts.later ?? 0,
      pool,
    }
  }, [queue.data, queue.status, queue.error, concepts.data, concepts.status, sections, read, chapter])
}
