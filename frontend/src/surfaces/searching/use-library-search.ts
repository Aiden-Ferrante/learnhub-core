"use client"

/** The reads behind library search.
 *
 *  `useSearchIndex` loads every ready course's concepts and memory states ONCE (three books
 *  at a time — parallel reads exhausted the API's pool before, v0.31.1) and keeps them under
 *  the concept-mastery root, so a review grade refreshes the Due/New/Learned labels.
 *  `usePassages` is the server's keyword search, debounced by the caller's `q`. */

import { useEffect, useMemo, useState } from "react"
import { fetchDocumentConcepts } from "@/gateways/api/concepts"
import { fetchConceptMastery } from "@/gateways/api/progress"
import { fetchPassages } from "@/gateways/api/search"
import { qk, useApi } from "@/kit/data"
import { courseFromDocument, type Course } from "@/surfaces/library"
import { useDocuments } from "@/surfaces/processing"
import { statusOf, terms, type IndexedConcept } from "@/surfaces/searching/search-model"

export function useSearchCourses() {
  const { documents, isInitialized } = useDocuments()
  const courses = useMemo(() => documents.map(courseFromDocument), [documents])
  const ready = useMemo(() => courses.filter((c) => c.status === "ready" && c.learnDocId), [courses])
  const byDoc = useMemo(() => new Map(ready.map((c) => [c.learnDocId as string, c])), [ready])
  return { courses, ready, byDoc, isInitialized }
}

async function loadIndex(courses: Course[], signal: AbortSignal): Promise<IndexedConcept[]> {
  const now = Date.now() / 1000
  const out: IndexedConcept[][] = new Array(courses.length)
  let next = 0
  const worker = async () => {
    while (next < courses.length) {
      const i = next++
      const c = courses[i]
      const doc = c.learnDocId as string
      const [concepts, mastery] = await Promise.all([
        fetchDocumentConcepts(doc, signal).catch(() => ({ concepts: [] })),
        fetchConceptMastery(doc, signal).catch(() => ({ byConcept: {} as Record<string, never> })),
      ])
      out[i] = (concepts.concepts ?? [])
        .filter((k) => k.conceptKey)
        .map((k) => {
          const m = mastery.byConcept?.[k.conceptKey as string]
          return {
            key: k.conceptKey as string,
            docId: doc,
            courseId: c.id,
            courseTitle: c.title,
            name: k.name,
            kind: k.kind,
            signal: k.signal ?? "",
            source: k.source,
            sectionKey: k.sectionKey ?? "",
            pageStart: k.pageStart,
            status: statusOf(m, now),
            retention: m?.retention ?? null,
          }
        })
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out.flat()
}

/** Every concept in the library, with its book and status. `enabled` lets the Library wait
 *  until someone starts typing. */
export function useSearchIndex(enabled = true) {
  const { ready } = useSearchCourses()
  const ids = ready.map((c) => c.learnDocId).sort().join(",")
  const q = useApi(qk.searchIndex(ids), (signal) => loadIndex(ready, signal), { enabled: enabled && ids.length > 0, staleMs: 5 * 60_000 })
  return { ...q, index: q.data ?? EMPTY }
}
const EMPTY: IndexedConcept[] = []

/** Keyword passages for `q` (≥ 2 characters), in one book or the whole library. */
export function usePassages(q: string, doc?: string | null, limit = 8) {
  // Only the content words: the server's locate tool counts every word, so "how do" would
  // rank passages that merely say "how".
  const query = terms(q).join(" ")
  return useApi(qk.passageSearch(query, doc, limit), (signal) => fetchPassages(query, doc, limit, signal), {
    enabled: query.length >= 2,
    keepPrevious: true,
    staleMs: 5 * 60_000,
  })
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
