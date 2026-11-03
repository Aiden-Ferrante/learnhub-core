"use client"

import { useMemo } from "react"
import { qk, useApi, type ApiQuery } from "@/kit/data"
import { fetchCourseChapters, type CourseChapter } from "@/gateways/api/chapter"
import { fetchOutline, type OutlineEntry, type OutlineResponse } from "@/gateways/api/outline"

/** The reads every reading surface shares, keyed through the query cache so the guided
 *  reader, the book reader and the pop-out reader reuse one response per course. */

/** The document outline (no docId = the service's current document, as fetchOutline
 *  does). An `error` envelope (no outline for this doc) reads as an empty list; a failed
 *  request is `q.error`. */
export function useOutline(docId: string | undefined): ApiQuery<OutlineResponse> {
  return useApi(qk.outline(docId), (signal) => fetchOutline(docId, signal))
}

/** THE chapter list for a course: the canonical /api/chapters derivation (the same one
 *  the dashboard tree and the Today plan use), read through `qk.chapters`. `fallback`
 *  (caller-memoized, usually the outline/tree rules) bridges the moment before the fetch
 *  lands, and stands in when the backend has no list; a failed request also returns the
 *  fallback, and `query.error` says so. Mirrors library's useCourseChapters, which still
 *  reads outside the cache. */
export function useChapterList(
  docId: string | undefined,
  fallback: CourseChapter[],
): { chapters: CourseChapter[]; query: ApiQuery<{ chapters: CourseChapter[]; error?: string }> } {
  const query = useApi(qk.chapters(docId ?? ""), (signal) => fetchCourseChapters(docId ?? "", signal), {
    enabled: Boolean(docId),
  })
  const { data } = query
  const chapters = useMemo(
    () =>
      data && !data.error && data.chapters?.length
        ? data.chapters.map((c) => ({ key: c.key, title: c.title }))
        : fallback,
    [data, fallback],
  )
  return { chapters, query }
}

const NO_ENTRIES: OutlineEntry[] = []

/** The outline entries, or one stable [] while loading / when the doc has none (stable so
 *  memos keyed on it don't re-run every render). */
export function outlineEntries(q: ApiQuery<OutlineResponse>): OutlineEntry[] {
  return q.data && !q.data.error ? q.data.outline || NO_ENTRIES : NO_ENTRIES
}
