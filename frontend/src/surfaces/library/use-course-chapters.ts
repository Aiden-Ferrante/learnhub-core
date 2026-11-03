"use client"

import { useMemo } from "react"
import { fetchCourseChapters, type CourseChapter } from "@/gateways/api/chapter"
import { qk, useApi } from "@/kit/data"
import { orThrow } from "@/surfaces/library/envelope"

/** THE chapter list for a course — the canonical /api/chapters derivation, the same one the
 *  dashboard tree and the Today plan use, so no reading surface can disagree with them.
 *  `fallback` (caller-memoized, usually outline/tree rules) only bridges the moment before
 *  the read lands or while it is failing (the cache retries it). Every chapter list must
 *  come from here. */
export function useCourseChapters(docId: string | undefined, fallback: CourseChapter[]): CourseChapter[] {
  const q = useApi(qk.chapters(docId ?? ""), (signal) => fetchCourseChapters(docId as string, signal).then(orThrow), {
    enabled: !!docId,
  })
  return useMemo(
    () => (q.data?.chapters?.length ? q.data.chapters.map((c) => ({ key: c.key, title: c.title })) : fallback),
    [q.data, fallback],
  )
}
