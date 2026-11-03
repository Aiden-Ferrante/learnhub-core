/** Per-course "continue reading" position, persisted in user_settings.readingProgress.
 *
 *  Shape: { [courseId]: sectionKey }. The requests live in the gateway
 *  (`fetchReadingProgressMap` / `saveReadingProgressEntry` in @/gateways/api/progress),
 *  which throw an ApiError on failure. New code reads through
 *  `useApi(qk.readingProgress(), fetchReadingProgressMap)`.
 *
 *  The two functions below are the old promise API the library surface still calls
 *  (use-course-data, course-shelf) with no rejection handler. They keep its contract
 *  (never reject) until those callers move to the query cache; that move belongs to the
 *  library surface, so the fallback stays here rather than turning into unhandled
 *  rejections there. */

import {
  fetchReadingProgressMap,
  saveReadingProgressEntry,
  type ReadingProgressMap,
} from "@/gateways/api/progress"

export type ReadingProgress = ReadingProgressMap

/** @deprecated Use `useApi(qk.readingProgress(), fetchReadingProgressMap)`. Resolves {}
 *  on failure (the old contract; its callers have no error path yet). */
export function fetchReadingProgress(): Promise<ReadingProgress> {
  return fetchReadingProgressMap().catch((err: unknown) => {
    console.warn("Couldn't load reading positions", err)
    return {}
  })
}

/** @deprecated Use `useApiMutation(({ courseId, key }) => saveReadingProgressEntry(courseId, key),
 *  { invalidates: [qk.readingProgress()] })`. Logs and resolves on failure (old contract). */
export function saveReadingPosition(courseId: string, sectionKey: string): Promise<void> {
  return saveReadingProgressEntry(courseId, sectionKey).then(
    () => undefined,
    (err: unknown) => {
      console.warn("Couldn't save the reading position", err)
    },
  )
}
