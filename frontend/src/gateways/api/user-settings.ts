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

/** courseId → the sectionKey to continue reading at. Throws ApiError (unlike the reading
 *  surface's best-effort `fetchReadingProgress`). */
export async function fetchReadingPositions(signal?: AbortSignal): Promise<Record<string, string>> {
  const settings = await fetchUserSettings(signal)
  const progress = settings.readingProgress
  return progress && typeof progress === 'object' && !Array.isArray(progress)
    ? (progress as Record<string, string>)
    : {}
}

/** Save one course's reading position (read-merge-write of the whole map, since the PUT
 *  merges top-level keys only). Throws ApiError. */
export async function saveReadingPositionStrict(
  courseId: string,
  sectionKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const current = await fetchReadingPositions(signal)
  if (current[courseId] === sectionKey) return
  await saveUserSettings({ readingProgress: { ...current, [courseId]: sectionKey } }, signal)
}
