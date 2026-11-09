/** Shared response parsing for the learn API client modules.
 *
 *  Every gateway function ends in `parseJsonResponse(res)`. A non-2xx response throws an
 *  `ApiError` carrying the HTTP status, a readable message and the raw `detail`, so callers
 *  (and `kit/data`'s AsyncView / ErrorNotice) can tell 401, 404, 422 and 503 apart. A 401
 *  anywhere sends the browser to /login (see `onUnauthorized`). */

import { ApiError, formatValidationDetail, type ValidationIssue } from '@/kit/data/api-error'

// The error type lives in kit/data so the kit can name it without importing up; re-exported
// here so every gateway caller keeps one import path.
export { ApiError, isApiError, toApiError, formatValidationDetail, type ValidationIssue } from '@/kit/data/api-error'

function messageFor(res: Response, body: Record<string, unknown>): string {
  const detail = body.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) return formatValidationDetail(detail as ValidationIssue[])
  if (typeof body.error === 'string' && body.error) return body.error
  return res.statusText || 'Learn service request failed'
}

let redirecting = false

/** Send the browser to /login once, keeping where the user was in `from` (the login page
 *  honours a same-origin `from`). No-op on the server and on /login itself. */
export function onUnauthorized(): void {
  if (typeof window === 'undefined' || redirecting) return
  const { pathname, search } = window.location
  if (pathname.startsWith('/login')) return
  redirecting = true
  window.location.assign(`/login?from=${encodeURIComponent(pathname + search)}`)
}

/** Parse a learn API response: the JSON body on 2xx, otherwise throw `ApiError`. A 401
 *  also triggers the global redirect to /login before throwing. */
export async function parseJsonResponse<T>(res: Response): Promise<T & { error?: string }> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: unknown }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized()
    const raw = (body ?? {}) as Record<string, unknown>
    throw new ApiError(res.status, messageFor(res, raw), raw.detail ?? raw.error)
  }
  return body
}
