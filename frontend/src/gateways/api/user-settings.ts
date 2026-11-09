/** The signed-in user's settings document (the Next route /api/user-settings, not the
 *  learn service): course groups, reading positions, prompts. The PUT merges TOP-LEVEL
 *  keys only, so a write of one nested map must carry the whole map. */
import { parseJsonResponse } from './http'

export type UserSettings = Record<string, unknown>

/** GET /api/user-settings → the settings object ({} when none saved). Throws ApiError. */
export async function fetchUserSettings(signal?: AbortSignal): Promise<UserSettings> {
  const res = await fetch('/api/user-settings', { signal, cache: 'no-store' })
  const body = await parseJsonResponse<{ settings?: UserSettings }>(res)
  const settings = body.settings
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
}

/** PUT /api/user-settings: merge `patch`'s top-level keys into the settings. Throws ApiError. */
export async function saveUserSettings(patch: UserSettings, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/user-settings', {
    signal,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  await parseJsonResponse<unknown>(res)
}

/** courseId → the sectionKey to continue reading at (qk.readingProgress()). The one
 *  reading-position client; a missing map is {}. Throws ApiError. */
export async function fetchReadingPositions(signal?: AbortSignal): Promise<Record<string, string>> {
  const settings = await fetchUserSettings(signal)
  const progress = settings.readingProgress
  return progress && typeof progress === 'object' && !Array.isArray(progress)
    ? (progress as Record<string, string>)
    : {}
}

/** The map key for one VERSION's position. A book's versions have their own outlines, so a
 *  position belongs to the version it was read in; the bare courseId key is the card's
 *  "Continue", which always means the course's main version. */
export const versionPositionKey = (docId: string) => `v:${docId}`

/** Save a reading position in the version being read, and as the card's Continue
 *  (read-merge-write of the whole map, since the PUT merges top-level keys only). */
export async function saveReadingPositionStrict(
  courseId: string,
  docId: string,
  sectionKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const current = await fetchReadingPositions(signal)
  const vk = versionPositionKey(docId)
  if (current[courseId] === sectionKey && current[vk] === sectionKey) return
  await saveUserSettings({ readingProgress: { ...current, [courseId]: sectionKey, [vk]: sectionKey } }, signal)
}

/** After the main version changes, point the card's Continue at the new main's own
 *  position, or clear it: a section key from another version's outline is not a place
 *  in this one. */
export async function followMainVersion(courseId: string, docId: string, signal?: AbortSignal): Promise<void> {
  const current = await fetchReadingPositions(signal)
  const next = { ...current }
  const own = current[versionPositionKey(docId)]
  if (own) next[courseId] = own
  else delete next[courseId]
  if (next[courseId] === current[courseId]) return
  await saveUserSettings({ readingProgress: next }, signal)
}
