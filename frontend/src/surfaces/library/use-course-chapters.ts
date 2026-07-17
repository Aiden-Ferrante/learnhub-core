"use client"

import { useMemo } from "react"
import { useAsyncData } from "@/kit/hooks/use-async-data"
import { fetchCourseChapters, type CourseChapter } from "@/gateways/api/chapter"

/** THE chapter list for a course — the canonical /api/chapters derivation, the same one the
 *  dashboard tree and the Today plan use, so no reading surface can disagree with them.
 *  `fallback` (caller-memoized, usually outline/tree rules) only bridges the moment before
 *  the fetch lands or a backend error. Every chapter list must come from here. */
export function useCourseChapters(docId: string | undefined, fallback: CourseChapter[]): CourseChapter[] {
  const { data } = useAsyncData(() => (docId ? fetchCourseChapters(docId) : null), [docId])
  return useMemo(
    () =>
      data && !data.error && data.chapters?.length
        ? data.chapters.map((c) => ({ key: c.key, title: c.title }))
        : fallback,
    [data, fallback],
  )
}
