"use client"

import { useMemo } from "react"
import { fetchCourseChapters, type CourseChapter } from "@/gateways/api/chapter"
import { qk, useApi, type ApiQuery } from "@/kit/data"

type ChaptersResponse = Awaited<ReturnType<typeof fetchCourseChapters>>

/** THE chapter list for a course: the canonical /api/chapters derivation, the same one the
 *  dashboard tree and the Today plan use, so no surface can disagree with them. One
 *  `qk.chapters` entry serves every caller (library, guided reading, the book and pop-out
 *  readers), so there is exactly one query function for it.
 *
 *  `fallback` (caller-memoized, usually outline/tree rules) bridges the moment before the
 *  read lands and stands in when the backend has no list (an `{error}` envelope); a failed
 *  request also returns the fallback, and `query.error` says so. */
export function useChapterList(
  docId: string | undefined,
  fallback: CourseChapter[],
): { chapters: CourseChapter[]; query: ApiQuery<ChaptersResponse> } {
  const query = useApi(qk.chapters(docId ?? ""), (signal) => fetchCourseChapters(docId as string, signal), {
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

/** `useChapterList` for callers that only need the list. */
export function useCourseChapters(docId: string | undefined, fallback: CourseChapter[]): CourseChapter[] {
  return useChapterList(docId, fallback).chapters
}
