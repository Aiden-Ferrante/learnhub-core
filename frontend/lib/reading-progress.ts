/** Per-course "continue reading" position, persisted in user_settings.readingProgress.
 *
 * Shape: { [courseId]: sectionKey }. The PUT API merges top-level keys only, so
 * writes read-merge-write the whole map to avoid clobbering other courses.
 */

export type ReadingProgress = Record<string, string>

export async function fetchReadingProgress(): Promise<ReadingProgress> {
  try {
    const res = await fetch('/api/user-settings', { cache: 'no-store' })
    if (!res.ok) return {}
    const data = await res.json()
    const progress = data?.settings?.readingProgress
    return progress && typeof progress === 'object' ? progress : {}
  } catch {
    return {}
  }
}

export async function saveReadingPosition(courseId: string, sectionKey: string): Promise<void> {
  try {
    const current = await fetchReadingProgress()
    if (current[courseId] === sectionKey) return
    await fetch('/api/user-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readingProgress: { ...current, [courseId]: sectionKey } }),
    })
  } catch {
    // progress is supplementary — losing a write must not break the reader
  }
}
