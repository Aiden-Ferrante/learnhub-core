"use client"

import { qk, useApi, type ApiQuery } from "@/kit/data"
import { fetchOutline, type OutlineEntry, type OutlineResponse } from "@/gateways/api/outline"

/** The chapter list comes from library's useChapterList (one qk.chapters entry for the
 *  whole app); it is re-exported here so reading code imports it from one place. */
export { useChapterList } from "@/surfaces/library"

/** The reads every reading surface shares, keyed through the query cache so the guided
 *  reader, the book reader and the pop-out reader reuse one response per course. */

/** The document outline (no docId = the service's current document, as fetchOutline
 *  does). An `error` envelope (no outline for this doc) reads as an empty list; a failed
 *  request is `q.error`. */
export function useOutline(docId: string | undefined): ApiQuery<OutlineResponse> {
  return useApi(qk.outline(docId), (signal) => fetchOutline(docId, signal))
}

const NO_ENTRIES: OutlineEntry[] = []

/** The outline entries, or one stable [] while loading / when the doc has none (stable so
 *  memos keyed on it don't re-run every render). */
export function outlineEntries(q: ApiQuery<OutlineResponse>): OutlineEntry[] {
  return q.data && !q.data.error ? q.data.outline || NO_ENTRIES : NO_ENTRIES
}
